import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hashOperatorPasscode, setOperatorHash } from '../server/operator-auth.ts';

// Read from stdin so passcodes never appear in command arguments or shell history.
const passcode = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (passcode.length < 12 || passcode.length > 128) {
  throw new Error('The operator passcode must be 12–128 characters.');
}
const path = join(resolve(process.env.DATA_DIR ?? './data'), 'framerelay.sqlite');
if (!existsSync(path)) throw new Error('Database not found. Check DATA_DIR.');
const sql = new Database(path, { fileMustExist: true });
try {
  sql.pragma('busy_timeout = 5000');
  sql.exec(
    'CREATE TABLE IF NOT EXISTS operator_auth (id INTEGER PRIMARY KEY CHECK (id = 1), passcode_hash TEXT NOT NULL)',
  );
  setOperatorHash(sql, hashOperatorPasscode(passcode));
  console.log('Operator passcode reset. Existing operator sessions have been signed out.');
} finally {
  sql.close();
}
