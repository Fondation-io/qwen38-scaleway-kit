import { DatabaseSync } from "node:sqlite";
import { guardSql, normalizeDb2 } from "@/lib/sql-guard";

const MAX_ROWS = 200;
const MAX_SQL_LENGTH = 5000;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) {
    const path = process.env.DB_PATH;
    if (!path) throw new Error("DB_PATH is not set");
    const handle = new DatabaseSync(path, { readOnly: true });
    // Attend au lieu d'échouer si la base est momentanément verrouillée.
    try {
      handle.exec("PRAGMA busy_timeout = 5000");
    } catch {
      // best-effort
    }
    // Attache la même base sous l'alias SECAUDIT (lecture seule) : les vues
    // sont alors adressables en Db2 for i qualifié, ex. SECAUDIT.QAUDJRN_TRANSFER.
    try {
      handle.exec(
        `ATTACH DATABASE 'file:${path}?mode=ro' AS SECAUDIT`,
      );
    } catch {
      // best-effort : les noms non qualifiés restent disponibles
    }
    // Base pot de miel IBM i (réelle) attachée en plus, sous le schéma HONEYPOT :
    // tables qaudjrn_pw / qaudjrn_sk / qaudjrn_im interrogeables en HONEYPOT.*.
    const honeypot = process.env.HONEYPOT_DB_PATH;
    if (honeypot) {
      try {
        handle.exec(
          `ATTACH DATABASE 'file:${honeypot}?mode=ro' AS HONEYPOT`,
        );
      } catch {
        // best-effort : la base pot de miel est optionnelle
      }
    }
    db = handle;
  }
  return db;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

export function runQuery(sql: string): QueryResult {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new Error("Requête SQL vide.");
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw new Error(`Requête trop longue (max ${MAX_SQL_LENGTH} caractères).`);
  }

  // Normalise les Db2-ismes (FETCH FIRST → LIMIT) avant gate et exécution.
  const normalized = normalizeDb2(sql);

  const verdict = guardSql(normalized);
  if (!verdict.ok) {
    throw new Error(`Requête refusée par la gate : ${verdict.reason}`);
  }
  if (!verdict.parsed) {
    // Le parser AST a échoué ; on est passé par le repli regex strict.
    console.warn("[sql-guard] fallback regex utilisé (parse AST en échec)");
  }

  let text = normalized.trim().replace(/;\s*$/, "");
  if (!/\bLIMIT\s+\d+/i.test(text)) {
    text = `${text} LIMIT ${MAX_ROWS}`;
  }

  let raw: Record<string, unknown>[];
  try {
    const stmt = getDb().prepare(text);
    raw = stmt.all() as Record<string, unknown>[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SQL invalide : ${message}`);
  }

  const capped = raw.slice(0, MAX_ROWS);
  const columns = capped.length > 0 ? Object.keys(capped[0]) : [];
  const rows = capped.map((r) => columns.map((c) => r[c]));
  return { columns, rows, rowCount: rows.length };
}
