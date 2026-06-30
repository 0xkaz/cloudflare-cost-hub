import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { D1Database } from '@cloudflare/workers-types';

// `node:sqlite` is newer than Vite's builtin-externalization list, so importing
// it directly makes Vite try to resolve a bare "sqlite". Load it at runtime via
// createRequire to bypass Vite's resolver while keeping the type-only import.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

// A real-SQLite-backed D1 stand-in for DB-layer tests, built on Node's built-in
// `node:sqlite` (no external dependency). It implements the slice of the D1 API
// our code uses: prepare(sql).bind(...).run()/first()/all(), plus bind-less
// run()/first()/all().
export interface TestD1 {
  db: D1Database;
  close(): void;
}

function wrap(database: DatabaseSync): D1Database {
  const api = {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      const make = (params: unknown[]) => ({
        bind: (...p: unknown[]) => make(p),
        run: async () => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
        first: async () => {
          const row = stmt.get(...params);
          return row === undefined ? null : row;
        },
        all: async () => ({ results: stmt.all(...params), success: true }),
      });
      return make([]);
    },
  };
  return api as unknown as D1Database;
}

// Create an in-memory D1 with the full migration set applied (which also
// validates that the migrations parse and run end to end).
export function createTestD1(): TestD1 {
  const database = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return { db: wrap(database), close: () => database.close() };
}
