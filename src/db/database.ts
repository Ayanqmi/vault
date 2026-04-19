import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ─── Vault DB (vault-specific data only) ─────────────────────────────────────
const VAULT_DB_PATH = process.env.DATABASE_PATH || './data/vault.db';
const dir = path.dirname(path.resolve(VAULT_DB_PATH));
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.resolve(VAULT_DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Ayanami ecosystem DB (read-only, for shared auth) ────────────────────────
// Vault authenticates against the same user database as ayanami.app.
// We never write to this DB — only read for login.
const AYANAMI_DB_PATH = process.env.AYANAMI_DB_PATH || '/opt/ayanami-upload/data/ayanami.db';
const ayanamiDb = new Database(path.resolve(AYANAMI_DB_PATH), { readonly: true });

// ─── Vault schema ─────────────────────────────────────────────────────────────
// vault_profiles stores the vault key material, keyed by ayanami user ID.
// widgets stores encrypted vault items.
db.exec(`
  CREATE TABLE IF NOT EXISTS vault_profiles (
    user_id      INTEGER PRIMARY KEY,
    vault_salt   TEXT,
    vault_test   TEXT,
    vault_test_iv TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS widgets (
    id           TEXT    PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    type         TEXT    NOT NULL,
    title        TEXT    NOT NULL DEFAULT '',
    data_enc     TEXT    NOT NULL,
    data_iv      TEXT    NOT NULL,
    tags         TEXT    NOT NULL DEFAULT '[]',
    pinned       INTEGER NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now')),
    updated_at   TEXT    DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_widgets_user_id ON widgets(user_id);
  CREATE INDEX IF NOT EXISTS idx_widgets_type    ON widgets(type);
`);

// ─── Ayanami user row type ─────────────────────────────────────────────────────
export interface AyanamiUser {
  id:           number;
  email:        string;
  username:     string | null;
  passwordHash: string;
  role:         string;
  banned:       number;
  createdAt:    string;
}

// ─── Ayanami auth queries (read-only) ─────────────────────────────────────────
export const ayanamiUserQueries = {
  findById: ayanamiDb.prepare<[number], AyanamiUser>(
    'SELECT * FROM users WHERE id = ?'
  ),
  // Accept username or email (same pattern as ayanami.app)
  findByIdentifier: ayanamiDb.prepare<[string, string], AyanamiUser>(
    'SELECT * FROM users WHERE email = ? OR username = ? COLLATE NOCASE'
  ),
};

// ─── Vault profile types + queries ────────────────────────────────────────────
export interface VaultProfile {
  user_id:       number;
  vault_salt:    string | null;
  vault_test:    string | null;
  vault_test_iv: string | null;
  created_at:    string;
}

export const vaultProfileQueries = {
  find: db.prepare<[number], VaultProfile>(
    'SELECT * FROM vault_profiles WHERE user_id = ?'
  ),

  upsert: db.prepare<[number]>(
    'INSERT OR IGNORE INTO vault_profiles (user_id) VALUES (?)'
  ),

  setKey: db.prepare<[string, string, string, number]>(
    'UPDATE vault_profiles SET vault_salt = ?, vault_test = ?, vault_test_iv = ? WHERE user_id = ?'
  ),
};

// ─── Widget row type + queries ─────────────────────────────────────────────────
export interface WidgetRow {
  id:         string;
  user_id:    number;
  type:       string;
  title:      string;
  data_enc:   string;
  data_iv:    string;
  tags:       string;
  pinned:     number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const widgetQueries = {
  listByUser: db.prepare<[number], WidgetRow>(
    'SELECT * FROM widgets WHERE user_id = ? ORDER BY pinned DESC, sort_order ASC, created_at DESC'
  ),

  findById: db.prepare<[string, number], WidgetRow>(
    'SELECT * FROM widgets WHERE id = ? AND user_id = ?'
  ),

  insert: db.prepare<[string, number, string, string, string, string, string]>(
    `INSERT INTO widgets (id, user_id, type, title, data_enc, data_iv, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),

  update: db.prepare<[string, string, string, string, number, string, number]>(
    `UPDATE widgets
     SET title = ?, data_enc = ?, data_iv = ?, tags = ?, pinned = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ),

  updateOrder: db.prepare<[number, string, number]>(
    'UPDATE widgets SET sort_order = ? WHERE id = ? AND user_id = ?'
  ),

  delete: db.prepare<[string, number]>(
    'DELETE FROM widgets WHERE id = ? AND user_id = ?'
  ),
};

export default db;
