import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { ayanamiUserQueries, vaultProfileQueries } from '../db/database';
import { validateCsrf } from '../middleware/csrf';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// ─── GET /auth/login ──────────────────────────────────────────────────────────
router.get('/login', (req: Request, res: Response) => {
  if (req.session?.userId) return res.redirect('/vault');
  res.render('auth/login', {
    error: req.query.error || null,
    info:  req.query.info  || null,
    next:  req.query.next  || '/vault',
    user:  null,
  });
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', loginLimiter, validateCsrf, async (req: Request, res: Response) => {
  const { identifier, password, next: nextUrl } = req.body as {
    identifier: string;
    password: string;
    next?: string;
  };

  const redirect = (nextUrl && nextUrl.startsWith('/')) ? nextUrl : '/vault';

  if (!identifier || !password) {
    return res.render('auth/login', {
      error: 'Username/email and password are required.',
      info: null, next: redirect, user: null,
    });
  }

  const id   = identifier.trim();
  const user = ayanamiUserQueries.findByIdentifier.get(id, id);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.render('auth/login', {
      error: 'Invalid username/email or password.',
      info: null, next: redirect, user: null,
    });
  }

  if (user.banned) {
    return res.render('auth/login', {
      error: 'Your ayanami.app account has been banned.',
      info: null, next: redirect, user: null,
    });
  }

  // Ensure a vault profile row exists for this user
  vaultProfileQueries.upsert.run(user.id);

  req.session.userId        = user.id;
  req.session.vaultUnlocked = false;

  res.redirect(redirect);
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', validateCsrf, (req: Request, res: Response) => {
  req.session.destroy(() => res.redirect('/'));
});

export default router;
