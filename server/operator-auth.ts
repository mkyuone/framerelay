import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

// OWASP scrypt fallback: N=2^15, r=8, p=3, with a unique 128-bit salt.
export function hashOperatorPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(passcode, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return `scrypt:32768:8:3:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function checkOperatorPasscode(passcode: string, encoded: string | undefined): boolean {
  if (!encoded) return false;
  const [algorithm, n, r, p, salt, expected] = encoded.split(':');
  if (
    algorithm !== 'scrypt' ||
    n !== '32768' ||
    r !== '8' ||
    p !== '3' ||
    !/^[0-9a-f]{32}$/.test(salt ?? '') ||
    !/^[0-9a-f]{64}$/.test(expected ?? '')
  )
    return false;
  const actual = scryptSync(passcode, Buffer.from(salt, 'hex'), 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function operatorHash(sql: Database.Database): string | undefined {
  return (
    sql.prepare('SELECT passcode_hash FROM operator_auth WHERE id = 1').get() as
      { passcode_hash: string } | undefined
  )?.passcode_hash;
}

export function setOperatorHash(sql: Database.Database, hash: string): void {
  sql.transaction(() => {
    sql
      .prepare(
        'INSERT INTO operator_auth (id, passcode_hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET passcode_hash = excluded.passcode_hash',
      )
      .run(hash);
    sql.prepare("DELETE FROM auth WHERE kind = 'operator'").run();
  })();
}
