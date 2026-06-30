// Minimal ambient declaration for Node's built-in SQLite (Node >=22). The
// pinned @types/node (v20) predates it, so declare just what the test helper
// uses. No external dependency is added — this is the standard library module.
declare module 'node:sqlite' {
  interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
