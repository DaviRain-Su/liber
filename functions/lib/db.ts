// Thin D1 helpers + id/time utilities. Raw prepared statements — no ORM.

export function id(prefix = ""): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function now(): number {
  return Date.now();
}

export async function all<T = any>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return res.results ?? [];
}

export async function first<T = any>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (
    (await db
      .prepare(sql)
      .bind(...params)
      .first<T>()) ?? null
  );
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

// Run a batch of [sql, ...params] statements atomically.
export async function batch(
  db: D1Database,
  statements: Array<[string, ...unknown[]]>,
): Promise<void> {
  await db.batch(statements.map(([sql, ...p]) => db.prepare(sql).bind(...p)));
}
