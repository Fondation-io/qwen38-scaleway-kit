import { DatabaseSync } from "node:sqlite";

const MAX_ROWS = 200;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) {
    const path = process.env.DB_PATH;
    if (!path) throw new Error("DB_PATH is not set");
    db = new DatabaseSync(path, { readOnly: true });
  }
  return db;
}

const FORBIDDEN =
  /\b(ATTACH|PRAGMA|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b/i;

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

export function runQuery(sql: string): QueryResult {
  let text = sql.trim().replace(/;\s*$/, "");
  if (text.includes(";")) {
    throw new Error("Une seule instruction SQL est autorisée (pas de ';').");
  }
  if (!/^(SELECT|WITH)\b/i.test(text)) {
    throw new Error(
      "Seules les requêtes en lecture (SELECT ou WITH ... SELECT) sont autorisées.",
    );
  }
  if (FORBIDDEN.test(text)) {
    throw new Error(
      "Mot-clé interdit (ATTACH/PRAGMA/INSERT/UPDATE/DELETE/DROP/CREATE/ALTER).",
    );
  }
  if (!/\bLIMIT\s+\d+/i.test(text)) {
    text = `${text} LIMIT ${MAX_ROWS}`;
  }
  const stmt = getDb().prepare(text);
  const raw = stmt.all() as Record<string, unknown>[];
  const capped = raw.slice(0, MAX_ROWS);
  const columns = capped.length > 0 ? Object.keys(capped[0]) : [];
  const rows = capped.map((r) => columns.map((c) => r[c]));
  return { columns, rows, rowCount: rows.length };
}
