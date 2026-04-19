import { Router, Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { widgetQueries, WidgetRow, vaultProfileQueries } from '../db/database';
import { validateCsrf } from '../middleware/csrf';

const router = Router();

// ─── Auth guard — returns JSON instead of redirecting ─────────────────────────
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

// ─── Rate limiters ────────────────────────────────────────────────────────────
const widgetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  keyGenerator: (req) => String((req.session as any)?.userId ?? req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const iconLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String((req.session as any)?.userId ?? req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many icon uploads. Try again later.' },
});

const imageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => String((req.session as any)?.userId ?? req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many image uploads. Try again later.' },
});

// ─── Upload setup (icons + images) ───────────────────────────────────────────
const DATA_BASE      = process.env.DATA_DIR || './data';
const ICONS_DIR      = path.resolve(DATA_BASE, 'icons');
const IMAGES_DIR     = path.resolve(DATA_BASE, 'images');
const MAX_ICONS      = 30;                            // per user
const MAX_IMAGES     = 100;                           // per user
const MAX_ENC_BYTES  = 64 * 1024;                    // 64 KB max per encrypted blob
const ALLOWED_MIMES  = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

fs.mkdirSync(ICONS_DIR,  { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

function makeUpload(maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
      else cb(new Error('Only PNG, JPEG, GIF and WebP images are allowed.') as any, false);
    },
  });
}

const iconUpload  = makeUpload(2 * 1024 * 1024);   // 2 MB for icons
const imageUpload = makeUpload(10 * 1024 * 1024);  // 10 MB for content images

/** Verify file magic bytes — client-supplied MIME type is untrusted */
function hasValidMagic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP (RIFF....WEBP)
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  return false;
}

const WIDGET_TYPES = ['note', 'reminder', 'bookmark', 'account', 'birthday', 'inspiration'] as const;
type WidgetType = typeof WIDGET_TYPES[number];

// ─── GET /api/widgets ─────────────────────────────────────────────────────────
router.get('/widgets', widgetLimiter, (req: Request, res: Response) => {
  const user    = res.locals.user;
  const widgets = widgetQueries.listByUser.all(user.id);
  res.json({ widgets });
});

// ─── POST /api/widgets ────────────────────────────────────────────────────────
router.post('/widgets', widgetLimiter, (req: Request, res: Response) => {
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
  if (data_enc.length > MAX_ENC_BYTES) {
    return res.status(400).json({ error: 'Payload too large.' });
  }

  const id        = nanoid(12);
  const tagStr    = JSON.stringify(Array.isArray(tags) ? tags : []);
  const safeTitle = (title || '').toString().slice(0, 200);

  widgetQueries.insert.run(id, user.id, type, safeTitle, data_enc, data_iv, tagStr);

  const widget = widgetQueries.findById.get(id, user.id);
  res.status(201).json({ widget });
});

// ─── PUT /api/widgets/:id ─────────────────────────────────────────────────────
router.put('/widgets/:id', widgetLimiter, (req: Request, res: Response) => {
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
  if (data_enc.length > MAX_ENC_BYTES) {
    return res.status(400).json({ error: 'Payload too large.' });
  }

  const safeTitle = (title !== undefined ? title : existing.title).toString().slice(0, 200);
  const tagStr    = JSON.stringify(Array.isArray(tags) ? tags : JSON.parse(existing.tags));
  const pinnedVal = pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned;

  widgetQueries.update.run(safeTitle, data_enc, data_iv, tagStr, pinnedVal, id, user.id);

  const widget = widgetQueries.findById.get(id, user.id);
  res.json({ widget });
});

// ─── DELETE /api/widgets/:id ──────────────────────────────────────────────────
router.delete('/widgets/:id', widgetLimiter, (req: Request, res: Response) => {
  const user = res.locals.user;
  const { id } = req.params;

  const existing = widgetQueries.findById.get(id, user.id) as WidgetRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Widget not found.' });

  widgetQueries.delete.run(id, user.id);
  res.json({ ok: true });
});

// ─── POST /api/widgets/reorder ────────────────────────────────────────────────
router.post('/widgets/reorder', widgetLimiter, (req: Request, res: Response) => {
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
router.get('/vault-info', (req: Request, res: Response) => {
  const profile = vaultProfileQueries.find.get(res.locals.user.id);
  res.json({
    vault_salt:    profile?.vault_salt    || null,
    vault_test:    profile?.vault_test    || null,
    vault_test_iv: profile?.vault_test_iv || null,
  });
});

/** Save an uploaded buffer to a per-user subdirectory; returns the public URL */
function saveUpload(buf: Buffer, mime: string, baseDir: string, urlPrefix: string, userId: number): string {
  const userDir = path.join(baseDir, String(userId));
  fs.mkdirSync(userDir, { recursive: true });
  const ext      = MIME_EXT[mime] || 'png';
  const filename = `${nanoid(16)}.${ext}`;
  fs.writeFileSync(path.join(userDir, filename), buf);
  return `${urlPrefix}/${userId}/${filename}`;
}

/** Delete a user-owned uploaded file; validates the URL pattern */
function deleteUpload(url: string, baseDir: string, urlPrefix: string, userId: number): boolean {
  const escaped = urlPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}/(\\d+)/([a-zA-Z0-9_-]+\\.(png|jpg|gif|webp))$`);
  const match = (url || '').match(re);
  if (!match || parseInt(match[1], 10) !== userId) return false;
  const filepath = path.join(baseDir, String(userId), match[2]);
  try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { /* best-effort */ }
  return true;
}

// ─── POST /api/widgets/icon ───────────────────────────────────────────────────
router.post('/widgets/icon', iconLimiter, iconUpload.single('icon'), (req: Request, res: Response) => {
  const user = res.locals.user;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!hasValidMagic(req.file.buffer)) return res.status(400).json({ error: 'Invalid image file.' });

  const userDir = path.join(ICONS_DIR, String(user.id));
  fs.mkdirSync(userDir, { recursive: true });
  if (fs.readdirSync(userDir).length >= MAX_ICONS) {
    return res.status(400).json({ error: `Icon limit reached (max ${MAX_ICONS}).` });
  }

  res.json({ url: saveUpload(req.file.buffer, req.file.mimetype, ICONS_DIR, '/icons', user.id) });
});

// ─── DELETE /api/widgets/icon ─────────────────────────────────────────────────
router.delete('/widgets/icon', (req: Request, res: Response) => {
  const user = res.locals.user;
  const { url } = req.body as { url?: string };
  if (!deleteUpload(url || '', ICONS_DIR, '/icons', user.id)) {
    return res.status(400).json({ error: 'Invalid icon URL.' });
  }
  res.json({ ok: true });
});

// ─── POST /api/widgets/image ──────────────────────────────────────────────────
router.post('/widgets/image', imageLimiter, imageUpload.single('image'), (req: Request, res: Response) => {
  const user = res.locals.user;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!hasValidMagic(req.file.buffer)) return res.status(400).json({ error: 'Invalid image file.' });

  const userDir = path.join(IMAGES_DIR, String(user.id));
  fs.mkdirSync(userDir, { recursive: true });
  if (fs.readdirSync(userDir).length >= MAX_IMAGES) {
    return res.status(400).json({ error: `Image limit reached (max ${MAX_IMAGES}).` });
  }

  res.json({ url: saveUpload(req.file.buffer, req.file.mimetype, IMAGES_DIR, '/images', user.id) });
});

// ─── DELETE /api/widgets/image ────────────────────────────────────────────────
router.delete('/widgets/image', (req: Request, res: Response) => {
  const user = res.locals.user;
  const { url } = req.body as { url?: string };
  if (!deleteUpload(url || '', IMAGES_DIR, '/images', user.id)) {
    return res.status(400).json({ error: 'Invalid image URL.' });
  }
  res.json({ ok: true });
});

// ─── JSON error handler ───────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Internal error.' });
});

export default router;
