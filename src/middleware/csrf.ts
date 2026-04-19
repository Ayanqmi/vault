import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    userId?: number;
    vaultUnlocked?: boolean;
  }
}

function ensureToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function attachCsrf(req: Request, res: Response, next: NextFunction): void {
  if (req.session) {
    res.locals.csrfToken = ensureToken(req);
  } else {
    res.locals.csrfToken = '';
  }
  next();
}

export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const sessionToken = req.session?.csrfToken;
  const bodyToken    = (req.body as Record<string, string>)?._csrf;
  const headerToken  = req.headers['x-csrf-token'] as string | undefined;
  const provided     = bodyToken || headerToken;

  if (!sessionToken || !provided || sessionToken !== provided) {
    res.status(403).json({ error: 'Invalid CSRF token.' });
    return;
  }

  next();
}
