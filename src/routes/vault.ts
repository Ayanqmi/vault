import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { vaultProfileQueries } from '../db/database';
import { requireLogin, requireVaultOpen } from '../middleware/auth';
import { validateCsrf } from '../middleware/csrf';

const router = Router();

const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// ─── GET /vault ───────────────────────────────────────────────────────────────
router.get('/', requireLogin, requireVaultOpen, (_req: Request, res: Response) => {
  res.render('vault', { user: res.locals.user });
});

// ─── GET /vault/unlock ────────────────────────────────────────────────────────
router.get('/unlock', requireLogin, (req: Request, res: Response) => {
  if (req.session?.vaultUnlocked) return res.redirect('/vault');
  const user     = res.locals.user;
  const hasVault = !!(user?.vault_salt);
  res.render('unlock', { user, hasVault, error: null });
});

// ─── POST /vault/unlock ───────────────────────────────────────────────────────
// Client decrypts the vault_test sentinel and sends the plaintext here.
// We verify it matches the expected value — vault key never transmitted.
router.post('/unlock', requireLogin, unlockLimiter, validateCsrf, (req: Request, res: Response) => {
  const { sentinel } = req.body as { sentinel?: string };
  const user = res.locals.user;

  if (!user?.vault_salt) return res.redirect('/vault/setup');

  const expected = 'ayanami.vault.ok';
  let match = false;
  if (sentinel && sentinel.length === expected.length) {
    const a = Buffer.from(sentinel, 'utf8');
    const b = Buffer.from(expected,  'utf8');
    match = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!match) {
    return res.render('unlock', { user, hasVault: true, error: 'Incorrect vault key.' });
  }

  req.session.vaultUnlocked = true;
  res.redirect('/vault');
});

// ─── GET /vault/setup ─────────────────────────────────────────────────────────
router.get('/setup', requireLogin, (req: Request, res: Response) => {
  if (req.session?.vaultUnlocked) return res.redirect('/vault');
  res.render('setup', { user: res.locals.user, error: null });
});

// ─── POST /vault/setup ────────────────────────────────────────────────────────
// Client generates a random salt, derives the key, encrypts the sentinel,
// then sends us: salt + encrypted(sentinel) + IV. We store these, never the key.
router.post('/setup', requireLogin, validateCsrf, (req: Request, res: Response) => {
  const { vault_salt, vault_test, vault_test_iv } = req.body as {
    vault_salt?:    string;
    vault_test?:    string;
    vault_test_iv?: string;
  };

  if (!vault_salt || !vault_test || !vault_test_iv) {
    return res.render('setup', { user: res.locals.user, error: 'Invalid setup payload.' });
  }

  const user = res.locals.user;
  vaultProfileQueries.setKey.run(vault_salt, vault_test, vault_test_iv, user.id);
  req.session.vaultUnlocked = true;

  res.redirect('/vault');
});

export default router;
