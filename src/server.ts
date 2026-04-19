import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import ConnectSQLite3 from 'connect-sqlite3';
import { PORT } from './config';
import { attachCsrf } from './middleware/csrf';
import { attachUser } from './middleware/auth';

import authRouter  from './routes/auth';
import vaultRouter from './routes/vault';
import apiRouter   from './routes/api';

// ─── Startup safety checks ────────────────────────────────────────────────────
if (!process.env.SESSION_SECRET) {
  console.error('[FATAL] SESSION_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const app = express();

// ─── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
const STATIC_OPTS = {
  setHeaders: (res: Response) => { res.setHeader('X-Content-Type-Options', 'nosniff'); },
};
const DATA_BASE  = process.env.DATA_DIR || './data';
// Serve user-uploaded widget icons and content images
app.use('/icons',  express.static(path.resolve(DATA_BASE, 'icons'),  STATIC_OPTS));
app.use('/images', express.static(path.resolve(DATA_BASE, 'images'), STATIC_OPTS));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Session ──────────────────────────────────────────────────────────────────
const SQLiteStore = ConnectSQLite3(session);
const dbDir = path.dirname(path.resolve(process.env.DATABASE_PATH || './data/vault.db'));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: dbDir,
  }) as session.Store,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  name: 'vault.sid',
}));

// ─── Trust proxy (nginx) ───────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      // No unsafe-inline — all scripts are external files
      scriptSrc:   ["'self'"],
      // unsafe-inline kept only for styles (no inline <style> injection risk)
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      // Allow self (uploaded icons), data URIs, Google favicons, and any HTTPS
      // image (users may paste external icon URLs)
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      workerSrc:   ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
    },
  },
}));

// ─── CSRF + user ───────────────────────────────────────────────────────────────
app.use(attachCsrf);
app.use(attachUser);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',  authRouter);
app.use('/vault', vaultRouter);
app.use('/api',   apiRouter);

// Landing page
app.get('/', (req: Request, res: Response) => {
  if (req.session?.userId) return res.redirect('/vault');
  res.render('index', { user: res.locals.user });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).render('errors/404', { user: res.locals.user });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).render('errors/500', { user: res.locals.user, message: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[vault] ayanami.vault running on http://localhost:${PORT}`);
});

export default app;
