import { Request, Response, NextFunction } from 'express';
import { ayanamiUserQueries, vaultProfileQueries } from '../db/database';

// Attach user + vault profile to res.locals on every request
export function attachUser(req: Request, res: Response, next: NextFunction): void {
  res.locals.user = null;
  if (req.session?.userId) {
    const user    = ayanamiUserQueries.findById.get(req.session.userId);
    const profile = vaultProfileQueries.find.get(req.session.userId);
    if (user) {
      // Merge ayanami user + vault profile — strip sensitive fields
      const { passwordHash: _pw, ...safeUser } = user as typeof user & { passwordHash?: string };
      res.locals.user = { ...safeUser, ...profile };
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

export function requireVaultOpen(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  }
  if (!req.session?.vaultUnlocked) {
    return res.redirect('/vault/unlock');
  }
  next();
}
