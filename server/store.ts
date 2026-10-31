import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EventConfig, Photo, Ticket } from '../shared/types.ts';

const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  config: text('config').notNull(),
  staffHash: text('staff_hash').notNull(),
});
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function demand(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new Problem(status, message);
}
type SessionRow = {
  id: string;
  event_id: string;
  code: string;
  identification_token: string;
  delivery_token: string | null;
  status: Ticket['status'];
  created_at: string;
  submitted_at: string | null;
  revision: number;
  claim_owner: string | null;
  claim_until: number | null;
};
type PhotoRow = {
  id: string;
  session_id: string;
  number: number;
  filename: string;
  source_name: string;
  width: number;
  height: number;
  hash: string;
  excluded_photography: number;
  excluded_selection: number;
  chosen: number;
  recipe: string | null;
  final_filename: string | null;
  final_signature: string | null;
  final_width: number | null;
  final_height: number | null;
  render_status: Photo['renderStatus'];
  render_error: string | null;
  printed: number;
  print_revision: number;
};
export type Store = ReturnType<typeof createStore>;

function readEventConfig(serialized: string): EventConfig {
  const stored = JSON.parse(serialized) as Record<string, unknown>;
  const fields = [
    'id',
    'eventName',
    'primaryColor',
    'accentColor',
    'footerText',
    'selectionLimit',
    'printEnabled',
    'digitalEnabled',
    'printWidth',
    'printHeight',
    'copies',
    'downloadsEnabled',
    'status',
  ] as const satisfies readonly (keyof EventConfig)[];
  // Project older event records onto the current interface without changing their photos or history.
  return {
    ...Object.fromEntries(fields.map((key) => [key, stored[key]])),
    eventName: typeof stored.eventName === 'string' ? stored.eventName : '',
  } as unknown as EventConfig;
}

export function createStore(root: string) {
  for (const name of ['', 'originals', 'previews', 'thumbnails', 'finals', 'assets', 'incoming'])
    mkdirSync(join(root, name), { recursive: true });
  const sql = new Database(join(root, 'framerelay.sqlite'));
  sql.pragma('journal_mode = WAL');
  sql.pragma('foreign_keys = ON');
  sql.pragma('busy_timeout = 5000');
  sql.exec(`
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, config TEXT NOT NULL, staff_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operator_auth (id INTEGER PRIMARY KEY CHECK (id = 1), passcode_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, event_id TEXT, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), code TEXT NOT NULL UNIQUE,
      identification_token TEXT NOT NULL UNIQUE, delivery_token TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'registered',
      created_at TEXT NOT NULL, submitted_at TEXT, revision INTEGER NOT NULL DEFAULT 0,
      registration_key TEXT NOT NULL, claim_owner TEXT, claim_until INTEGER,
      UNIQUE(event_id, registration_key)
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), number INTEGER NOT NULL,
      filename TEXT NOT NULL, source_name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, hash TEXT NOT NULL,
      excluded_photography INTEGER NOT NULL DEFAULT 0, excluded_selection INTEGER NOT NULL DEFAULT 0,
      chosen INTEGER NOT NULL DEFAULT 0, recipe TEXT, final_filename TEXT, final_signature TEXT, final_width INTEGER, final_height INTEGER,
      render_status TEXT NOT NULL DEFAULT 'none', render_error TEXT, printed INTEGER NOT NULL DEFAULT 0,
      print_revision INTEGER NOT NULL DEFAULT 0, UNIQUE(session_id, hash), UNIQUE(session_id, number)
    );
    CREATE INDEX IF NOT EXISTS sessions_event ON sessions(event_id, status);
  `);
  const photoColumns = sql.prepare('PRAGMA table_info(photos)').all() as { name: string }[];
  if (!photoColumns.some((column) => column.name === 'final_signature'))
    sql.exec('ALTER TABLE photos ADD COLUMN final_signature TEXT');
  sql.pragma('user_version = 2');
  // A render interrupted by a restart is retried from its durable recipe.
  sql
    .prepare("UPDATE photos SET render_status = 'pending' WHERE render_status = 'processing'")
    .run();
  const orm = drizzle(sql);
  const config = (id: string) => {
    const row = orm.select().from(events).where(eq(events.id, id)).get();
    return row ? readEventConfig(row.config) : null;
  };
  const listEvents = () =>
    orm
      .select()
      .from(events)
      .all()
      .map((row) => readEventConfig(row.config));
  const active = () => listEvents().find((event) => event.status === 'active') ?? null;
  const rawSession = (id: string) =>
    sql.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  const rawPhoto = (id: string) =>
    sql.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined;
  function photo(row: PhotoRow): Photo {
    return {
      id: row.id,
      sessionId: row.session_id,
      number: row.number,
      filename: row.filename,
      sourceName: row.source_name,
      width: row.width,
      height: row.height,
      excludedPhotography: !!row.excluded_photography,
      excludedSelection: !!row.excluded_selection,
      chosen: !!row.chosen,
      recipe: row.recipe ? JSON.parse(row.recipe) : null,
      finalFilename: row.final_filename,
      finalWidth: row.final_width,
      finalHeight: row.final_height,
      renderStatus: row.render_status,
      renderError: row.render_error,
      printed: !!row.printed,
      printRevision: row.print_revision,
    };
  }
  function ticket(id: string): Ticket {
    const row = rawSession(id);
    demand(row, 'Ticket not found.', 404);
    return {
      id: row.id,
      eventId: row.event_id,
      code: row.code,
      identificationToken: row.identification_token,
      deliveryPath: row.delivery_token ? `/d/${row.delivery_token}` : null,
      status: row.status,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      revision: row.revision,
      photos: (
        sql
          .prepare('SELECT * FROM photos WHERE session_id = ? ORDER BY number')
          .all(id) as PhotoRow[]
      ).map(photo),
    };
  }
  function resolveTicket(identifier: string, eventId: string) {
    const clean = identifier.trim().split('/').filter(Boolean).at(-1) ?? '';
    const row = sql
      .prepare(
        'SELECT id FROM sessions WHERE event_id = ? AND (code = ? COLLATE NOCASE OR identification_token = ? OR id = ?)',
      )
      .get(eventId, clean, clean, clean) as { id: string } | undefined;
    demand(row, 'No ticket found for this event.', 404);
    return ticket(row.id);
  }
  const bump = (id: string) =>
    sql.prepare('UPDATE sessions SET revision = revision + 1 WHERE id = ?').run(id);
  function ownPhoto(id: string, eventId: string) {
    const p = rawPhoto(id);
    demand(p && rawSession(p.session_id)?.event_id === eventId, 'Photo not found.', 404);
    return p;
  }
  function claim(id: string, owner: string) {
    const row = rawSession(id);
    demand(row, 'Ticket not found.', 404);
    if (row.status === 'submitted') return;
    demand(
      !row.claim_owner || row.claim_owner === owner || (row.claim_until ?? 0) < Date.now(),
      'This customer is open at another selection station.',
      423,
    );
    sql
      .prepare('UPDATE sessions SET claim_owner = ?, claim_until = ? WHERE id = ?')
      .run(owner, Date.now() + 90_000, id);
  }
  function requireClaim(id: string, owner: string) {
    const row = rawSession(id);
    demand(
      row?.claim_owner === owner && (row.claim_until ?? 0) > Date.now(),
      'Selection access expired. Reopen this ticket to continue.',
      423,
    );
  }
  return {
    root,
    sql,
    config,
    listEvents,
    active,
    ticket,
    resolveTicket,
    rawPhoto,
    rawSession,
    ownPhoto,
    bump,
    claim,
    requireClaim,
    close: () => sql.close(),
    saveSettings(event: EventConfig, staffHash: string) {
      orm
        .insert(events)
        .values({ id: event.id, config: JSON.stringify(event), staffHash })
        .onConflictDoUpdate({
          target: events.id,
          set: { config: JSON.stringify(event), staffHash },
        })
        .run();
      return event;
    },
    resetData() {
      const current = active();
      demand(current, 'Configure the stations first.');
      demand(
        !sql
          .prepare("SELECT 1 FROM photos WHERE render_status IN ('pending', 'processing') LIMIT 1")
          .get(),
        'Wait for pending photo exports to finish before clearing data.',
      );
      const next = { ...current, id: randomUUID() };
      const hash = orm.select().from(events).where(eq(events.id, current.id)).get()!.staffHash;
      sql.transaction(() => {
        sql.prepare('DELETE FROM photos').run();
        sql.prepare('DELETE FROM sessions').run();
        sql.prepare("DELETE FROM auth WHERE kind = 'staff'").run();
        sql.prepare('DELETE FROM events').run();
        orm
          .insert(events)
          .values({ id: next.id, config: JSON.stringify(next), staffHash: hash })
          .run();
      })();
      for (const name of ['originals', 'previews', 'thumbnails', 'finals', 'assets', 'incoming'])
        for (const entry of readdirSync(join(root, name)))
          rmSync(join(root, name, entry), { recursive: true, force: true });
      return next;
    },
    staffHash(id: string) {
      return orm.select().from(events).where(eq(events.id, id)).get()?.staffHash;
    },
    authenticate(token: string | undefined, kind: string, eventId?: string) {
      if (!token) return false;
      const row = sql
        .prepare('SELECT * FROM auth WHERE hash = ? AND kind = ? AND expires > ?')
        .get(digest(token), kind, Date.now()) as { event_id: string | null } | undefined;
      return !!row && (!eventId || row.event_id === eventId);
    },
    login(kind: string, eventId: string | null) {
      const token = randomBytes(32).toString('base64url');
      sql.prepare('DELETE FROM auth WHERE expires < ?').run(Date.now());
      sql
        .prepare('INSERT INTO auth VALUES (?, ?, ?, ?)')
        .run(digest(token), kind, eventId, Date.now() + 7 * 86400_000);
      return token;
    },
    logout(token: string | undefined) {
      if (token) sql.prepare('DELETE FROM auth WHERE hash = ?').run(digest(token));
    },
    createTicket: sql.transaction((eventId: string, key: string) => {
      const existing = sql
        .prepare('SELECT id FROM sessions WHERE event_id = ? AND registration_key = ?')
        .get(eventId, key) as { id: string } | undefined;
      if (existing) return ticket(existing.id);
      const id = randomUUID(),
        token = randomBytes(24).toString('base64url');
      const count =
        (sql.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n + 1;
      const code = `T${String(count).padStart(4, '0')}`;
      sql
        .prepare(
          'INSERT INTO sessions (id,event_id,code,identification_token,created_at,registration_key) VALUES (?,?,?,?,?,?)',
        )
        .run(id, eventId, code, token, new Date().toISOString(), key);
      return ticket(id);
    }),
    recentTickets(eventId: string) {
      return (
        sql
          .prepare('SELECT id FROM sessions WHERE event_id = ? ORDER BY created_at DESC LIMIT 10')
          .all(eventId) as { id: string }[]
      ).map((row) => ticket(row.id));
    },
    beginPhotography(id: string) {
      const t = ticket(id);
      demand(
        t.status === 'registered' || t.status === 'photographing',
        'Photography is already complete.',
      );
      sql
        .prepare(
          "UPDATE sessions SET status = 'photographing', revision = revision + 1 WHERE id = ?",
        )
        .run(id);
      return ticket(id);
    },
    finishPhotography(id: string) {
      const t = ticket(id);
      if (t.status === 'ready') return t;
      demand(t.status === 'photographing', 'Photography is not active.');
      demand(
        t.photos.some((p) => !p.excludedPhotography),
        'Include at least one ready photo.',
      );
      sql
        .prepare("UPDATE sessions SET status = 'ready', revision = revision + 1 WHERE id = ?")
        .run(id);
      return ticket(id);
    },
    addPhoto: sql.transaction(
      (id: string, hash: string, sourceName: string, width: number, height: number) => {
        const duplicate = sql
          .prepare('SELECT * FROM photos WHERE session_id = ? AND hash = ?')
          .get(id, hash) as PhotoRow | undefined;
        if (duplicate) return { photo: photo(duplicate), duplicate: true };
        const t = ticket(id);
        demand(t.status === 'photographing', 'Start photography before uploading.');
        const number = (
          sql
            .prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM photos WHERE session_id = ?')
            .get(id) as { n: number }
        ).n;
        const photoId = randomUUID(),
          filename = `${t.code}_${String(number).padStart(2, '0')}_${new Date().toISOString().replace(/[-:.]/g, '')}.jpg`;
        sql
          .prepare(
            'INSERT INTO photos (id,session_id,number,filename,source_name,width,height,hash) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(photoId, id, number, filename, sourceName, width, height, hash);
        bump(id);
        return { photo: photo(rawPhoto(photoId)!), duplicate: false };
      },
    ),
    patchPhoto: sql.transaction(
      (
        id: string,
        eventId: string,
        owner: string,
        patch: {
          excludedPhotography?: boolean;
          excludedSelection?: boolean;
          chosen?: boolean;
          recipe?: unknown;
        },
      ) => {
        const p = ownPhoto(id, eventId),
          t = ticket(p.session_id);
        demand(t.status !== 'submitted', 'Submitted photos are read-only.');
        if (patch.excludedPhotography !== undefined) {
          demand(t.status === 'photographing', 'Photography is complete.');
          sql
            .prepare('UPDATE photos SET excluded_photography = ? WHERE id = ?')
            .run(+patch.excludedPhotography, id);
        }
        if (
          patch.excludedSelection !== undefined ||
          patch.chosen !== undefined ||
          patch.recipe !== undefined
        ) {
          demand(t.status === 'ready', 'Wait for photography to finish.');
          requireClaim(t.id, owner);
          if (patch.excludedSelection !== undefined)
            sql
              .prepare(
                'UPDATE photos SET excluded_selection = ?, chosen = CASE WHEN ? THEN 0 ELSE chosen END, excluded_photography = CASE WHEN ? THEN excluded_photography ELSE 0 END WHERE id = ?',
              )
              .run(
                +patch.excludedSelection,
                +patch.excludedSelection,
                +patch.excludedSelection,
                id,
              );
          if (patch.chosen !== undefined) {
            if (patch.chosen && !p.chosen) {
              demand(
                !p.excluded_photography && !p.excluded_selection,
                'Restore this photo before choosing it.',
              );
              const limit = config(eventId)!.selectionLimit;
              if (limit === 1)
                sql
                  .prepare(
                    'UPDATE photos SET chosen = 0 WHERE session_id = ? AND id != ? AND chosen = 1',
                  )
                  .run(t.id, id);
              else
                demand(
                  t.photos.filter((p) => p.chosen).length < limit,
                  'The event selection limit has been reached.',
                );
            }
            sql.prepare('UPDATE photos SET chosen = ? WHERE id = ?').run(+patch.chosen, id);
          }
          if (patch.recipe !== undefined)
            sql
              .prepare("UPDATE photos SET recipe = ?, render_status = 'none' WHERE id = ?")
              .run(JSON.stringify(patch.recipe), id);
        }
        bump(t.id);
        return ticket(t.id);
      },
    ),
    submit: sql.transaction((id: string, owner: string) => {
      const t = ticket(id);
      if (t.status === 'submitted') return t;
      requireClaim(id, owner);
      demand(t.status === 'ready', 'Photography is not complete.');
      const chosen = t.photos.filter(
          (p) => p.chosen && !p.excludedSelection && !p.excludedPhotography,
        ),
        event = config(t.eventId)!;
      demand(
        chosen.length > 0 && chosen.length <= event.selectionLimit,
        'Choose between one photo and the event limit.',
      );
      demand(
        chosen.every((p) => p.finalFilename && p.renderStatus === 'ready'),
        'Wait until every included final is saved.',
      );
      const token = randomBytes(32).toString('base64url');
      sql
        .prepare(
          "UPDATE sessions SET status = 'submitted', delivery_token = ?, submitted_at = ?, revision = revision + 1, claim_owner = NULL, claim_until = NULL WHERE id = ?",
        )
        .run(token, new Date().toISOString(), id);
      return ticket(id);
    }),
    queue(eventId: string) {
      return (
        sql
          .prepare(
            "SELECT id FROM sessions WHERE event_id = ? AND status = 'submitted' ORDER BY submitted_at",
          )
          .all(eventId) as { id: string }[]
      ).map((row) => ticket(row.id));
    },
    print(id: string, eventId: string, printed: boolean, revision: number) {
      const p = ownPhoto(id, eventId),
        t = ticket(p.session_id);
      demand(
        config(eventId)?.printEnabled && t.status === 'submitted' && p.chosen,
        'This photo is not in the print queue.',
      );
      const result = sql
        .prepare(
          'UPDATE photos SET printed = ?, print_revision = print_revision + 1 WHERE id = ? AND print_revision = ?',
        )
        .run(+printed, id, revision);
      demand(result.changes, 'Print status changed elsewhere. Refresh and try again.');
      bump(t.id);
      return ticket(t.id);
    },
    publicTicket(token: string) {
      const row = sql
        .prepare("SELECT id FROM sessions WHERE delivery_token = ? AND status = 'submitted'")
        .get(token) as { id: string } | undefined;
      demand(row, 'This download is unavailable.', 404);
      const t = ticket(row.id),
        event = config(t.eventId)!;
      demand(
        event.digitalEnabled && event.downloadsEnabled,
        'Downloads are no longer available for this event.',
        410,
      );
      return { event, ticket: t, photos: t.photos.filter((p) => p.chosen && p.finalFilename) };
    },
    renderJob() {
      return sql
        .prepare("SELECT * FROM photos WHERE render_status = 'pending' ORDER BY rowid LIMIT 1")
        .get() as PhotoRow | undefined;
    },
    setRenderStatus(id: string, status: Photo['renderStatus'], error: string | null = null) {
      sql
        .prepare('UPDATE photos SET render_status = ?, render_error = ? WHERE id = ?')
        .run(status, error, id);
    },
    finishRender(
      id: string,
      filename: string,
      width: number,
      height: number,
      signature: string | null = null,
    ) {
      sql
        .prepare(
          "UPDATE photos SET final_filename = ?, final_width = ?, final_height = ?, final_signature = ?, render_status = 'ready', render_error = NULL WHERE id = ?",
        )
        .run(filename, width, height, signature, id);
      const p = rawPhoto(id)!;
      bump(p.session_id);
    },
  };
}
