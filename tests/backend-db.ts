import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** Executes production SQL against real SQLite; only the D1 transport is adapted. */
export function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  class Statement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: (string | number | null)[]) { this.values = values; return this; }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.values);
      return column ? row?.[column] ?? null : row ?? null;
    }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
    execute() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async run() { return this.execute(); }
  }
  const db = {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        // D1 runs a batch serially inside one transaction, without interleaving
        // statements from other requests. Keep that boundary here as well.
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

export async function seedUser(db: D1Database, id = 'alice', credits = 0) {
  await db.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)")
    .bind(id, `${id}@example.com`, 'unused', '2026-01-01T00:00:00.000Z').run();
  if (credits) await db.prepare('INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at) VALUES (?,?,?,?,?,?)')
    .bind(`seed-${id}`, id, credits, 'test seed', `seed-${id}`, '2026-01-01T00:00:00.000Z').run();
}
