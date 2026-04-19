import { Router, Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { widgetQueries, WidgetRow, vaultProfileQueries } from '../db/database';
import { validateCsrf } from '../middleware/csrf';

const router = Router();

// API-specific auth guard — returns JSON instead of redirecting
function requireVaultOpenJson(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }
  if (!req.session?.vaultUnlocked) {
    res.status(401).json({ error: 'Vault is locked.' });
    return;
  }
  next();
}

router.use(requireVaultOpenJson);
router.use(validateCsrf);

const ICONS_DIR = path.resolve(process.env.DATA_DIR || './data', 'icons');
fs.mkdirSync(ICONS_DIR, { recursive: true });

const iconUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ICONS_DIR),
    filename:    (_req, _file, cb) => cb(null, `${nanoid(16)}.png`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Not an image.') as any, false);
  },
});

const WIDGET_TYPES = ['note', 'reminder', 'bookmark', 'account', 'birthday'] as const;
type WidgetType = typeof WIDGET_TYPES[number];

// ─── GET /api/widgets ─────────────────────────────────────────────────────────
router.get('/widgets', (req: Request, res: Response) => {
  const user    = res.locals.user;
  const widgets = widgetQueries.listByUser.all(user.id);
  res.json({ widgets });
});

// ─── POST /api/widgets ────────────────────────────────────────────────────────
router.post('/widgets', (req: Request, res: Response) => {
  const user = res.locals.user;
  const { type, title, data_enc, data_iv, tags } = req.body as {
    type:     string;
    title:    string;
    data_enc: string;
    data_iv:  string;
    tags?:    string[];
  };

  if (!WIDGET_TYPES.includes(type as WidgetType)) {
    return res.status(400).json({ error: 'Invalid widget type.' });
  }
  if (!data_enc || !data_iv) {
    return res.status(400).json({ error: 'Encrypted payload required.' });
  }

  const id       = nanoid(12);
  const tagStr   = JSON.stringify(Array.isArray(tags) ? tags : []);
  const safeTitle = (title || '').toString().slice(0, 200);

  widgetQueries.insert.run(id, user.id, type, safeTitle, data_enc, data_iv, tagStr);

  const widget = widgetQueries.findById.get(id, user.id);
  res.status(201).json({ widget });
});

// ─── PUT /api/widgets/:id ─────────────────────────────────────────────────────
router.put('/widgets/:id', (req: Request, res: Response) => {
  const user = res.locals.user;
  const { id } = req.params;
  const { title, data_enc, data_iv, tags, pinned } = req.body as {
    title?:   string;
    data_enc: string;
    data_iv:  string;
    tags?:    string[];
    pinned?:  boolean;
  };

  const existing = widgetQueries.findById.get(id, user.id) as WidgetRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Widget not found.' });

  if (!data_enc || !data_iv) {
    return res.status(400).json({ error: 'Encrypted payload required.' });
  }

  const safeTitle = (title !== undefined ? title : existing.title).toString().slice(0, 200);
  const tagStr    = JSON.stringify(Array.isArray(tags) ? tags : JSON.parse(existing.tags));
  const pinnedVal = pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned;

  widgetQueries.update.run(safeTitle, data_enc, data_iv, tagStr, pinnedVal, id, user.id);

  const widget = widgetQueries.findById.get(id, user.id);
  res.json({ widget });
});

// ─── DELETE /api/widgets/:id ──────────────────────────────────────────────────
router.delete('/widgets/:id', (req: Request, res: Response) => {
  const user = res.locals.user;
  const { id } = req.params;

  const existing = widgetQueries.findById.get(id, user.id) as WidgetRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Widget not found.' });

  widgetQueries.delete.run(id, user.id);
  res.json({ ok: true });
});

// ─── POST /api/widgets/reorder ────────────────────────────────────────────────
router.post('/widgets/reorder', (req: Request, res: Response) => {
  const user = res.locals.user;
  const { order } = req.body as { order: string[] };

  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of widget IDs.' });

  const reorder = widgetQueries.updateOrder;
  for (let i = 0; i < order.length; i++) {
    reorder.run(i, order[i], user.id);
  }

  res.json({ ok: true });
});

// ─── GET /api/vault-info ──────────────────────────────────────────────────────
// Returns salt + encrypted test blob so the client can attempt decryption
router.get('/vault-info', (req: Request, res: Response) => {
  const profile = vaultProfileQueries.find.get(res.locals.user.id);
  res.json({
    vault_salt:    profile?.vault_salt    || null,
    vault_test:    profile?.vault_test    || null,
    vault_test_iv: profile?.vault_test_iv || null,
  });
});

// ─── POST /api/widgets/icon ───────────────────────────────────────────────────
router.post('/widgets/icon', iconUpload.single('icon'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  res.json({ url: `/icons/${req.file.filename}` });
});

// ─── JSON error handler (prevents HTML 500 pages leaking to fetch() callers) ──
// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Internal error.' });
});

export default router;
