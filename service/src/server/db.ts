import { Database } from "bun:sqlite"
import { mkdirSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { createHmac, randomBytes } from "node:crypto"
import { config } from "./config"

const dbPath = process.env.SHARE_DB_PATH ?? "/data/shares.db"
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath, { create: true })

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA secure_delete = ON;

  CREATE TABLE IF NOT EXISTS shares (
    id               TEXT PRIMARY KEY,
    session_key      TEXT,
    key_id           TEXT NOT NULL,
    title            TEXT,
    payload          BLOB,
    payload_encoding TEXT,
    payload_hash     TEXT,
    sync_secret_hash TEXT,
    size_bytes       INTEGER NOT NULL DEFAULT 0,
    stored_bytes     INTEGER NOT NULL DEFAULT 0,
    version          INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    last_sync_at     INTEGER,
    expires_at       INTEGER NOT NULL,
    revoked_at       INTEGER
  );

  CREATE UNIQUE INDEX IF NOT EXISTS shares_active_session
    ON shares(session_key)
    WHERE revoked_at IS NULL AND session_key IS NOT NULL;

  CREATE INDEX IF NOT EXISTS shares_expires
    ON shares(expires_at)
    WHERE revoked_at IS NULL AND payload IS NOT NULL;

  CREATE TABLE IF NOT EXISTS purge_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    url        TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    next_at    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS purge_queue_next ON purge_queue(next_at);
`)

export type ShareRow = {
  id: string
  session_key: string | null
  key_id: string
  title: string | null
  payload: Uint8Array | null
  payload_encoding: string | null
  payload_hash: string | null
  sync_secret_hash: string | null
  size_bytes: number
  stored_bytes: number
  version: number
  created_at: number
  updated_at: number
  last_sync_at: number | null
  expires_at: number
  revoked_at: number | null
}

export function sessionKey(sessionID: string) {
  return createHmac("sha256", config.sessionSalt).update(sessionID).digest("hex")
}

export function randomShareId() {
  return randomBytes(16).toString("base64url")
}

export function randomSyncSecret() {
  return randomBytes(24).toString("base64url")
}

export function findById(id: string) {
  return db
    .query("SELECT * FROM shares WHERE id = ?")
    .get(id) as ShareRow | null
}

export function findActiveBySessionKey(key: string) {
  return db
    .query(
      "SELECT * FROM shares WHERE session_key = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(key, Date.now()) as ShareRow | null
}

export function findAnyActiveBySessionKey(key: string) {
  return db
    .query("SELECT * FROM shares WHERE session_key = ? AND revoked_at IS NULL LIMIT 1")
    .get(key) as ShareRow | null
}

export function expireShare(id: string, now = Date.now()) {
  db.run(
    `UPDATE shares
        SET payload = NULL,
            payload_encoding = NULL,
            payload_hash = NULL,
            title = NULL,
            session_key = NULL,
            sync_secret_hash = NULL,
            size_bytes = 0,
            stored_bytes = 0,
            revoked_at = ?,
            updated_at = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [now, now, id],
  )
}

export function deleteOldTombstones(olderThan: number) {
  db.run("DELETE FROM shares WHERE revoked_at IS NOT NULL AND revoked_at < ?", [olderThan])
}

export function dbSize() {
  let size = 0
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      size += statSync(file).size
    } catch {}
  }
  return size
}

export function checkpoint() {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } catch (error) {
    console.warn("wal checkpoint failed", error)
  }
}

export function vacuum() {
  try {
    db.exec("VACUUM")
  } catch (error) {
    console.warn("vacuum failed", error)
  }
}
