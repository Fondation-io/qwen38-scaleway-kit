import { Parser } from "node-sql-parser";

// Gate SQL basée sur l'AST (node-sql-parser). Plus subtile que le filtrage
// par mots-clés : on lit le vrai type d'instruction et la liste des
// tables/vues réellement référencées, avec leur autorité (select vs write).
//
// Dialecte = sqlite, car c'est le moteur qui exécute (un dialecte différent
// mis-parserait nos requêtes). Si le parser échoue, on NE fait PAS confiance :
// on retombe sur des gardes regex strictes (fail-closed), jamais sur un passage
// libre.

const parser = new Parser();
const OPT = { database: "sqlite" } as const;

// Seules ces vues/tables sont interrogeables par l'agent (comparaison
// insensible à la casse — SQLite l'est). Les tables CERT brutes
// (cert_logon/device/email/file/http) sont hors périmètre : l'agent passe par
// les vues Db2 for i (schéma SECAUDIT).
const ALLOWED_TABLES = new Set([
  "qaudjrn_signon",
  "qaudjrn_transfer",
  "qaudjrn_object",
  "qaudjrn_mail",
  "qaudjrn_profile_swap",
  "user_profiles",
  "daily_baseline",
  "cert_insiders",
  "data_profile",
  "guide_evidence",
]);

const FORBIDDEN =
  /\b(ATTACH|DETACH|PRAGMA|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|VACUUM|REINDEX|TRIGGER)\b/i;
const BLOCKED_IDENTIFIERS =
  /\b(sqlite_[a-z_]+|cert_http|cert_logon|cert_device|cert_email|cert_file)\b/i;

export interface GuardVerdict {
  ok: boolean;
  reason?: string;
  parsed: boolean; // true = validé par l'AST ; false = validé par le repli regex
}

// Repli quand le parser échoue : gardes conservatrices et restrictives.
function conservativeFallback(sql: string): GuardVerdict {
  const text = sql.trim().replace(/;\s*$/, "");
  if (text.includes(";"))
    return { ok: false, parsed: false, reason: "Une seule instruction SQL autorisée." };
  if (!/^(SELECT|WITH)\b/i.test(text))
    return { ok: false, parsed: false, reason: "Lecture seule (SELECT ou WITH)." };
  if (FORBIDDEN.test(text))
    return { ok: false, parsed: false, reason: "Mot-clé interdit (écriture/PRAGMA/ATTACH…)." };
  if (BLOCKED_IDENTIFIERS.test(text))
    return { ok: false, parsed: false, reason: "Table hors périmètre ou introspection SQLite." };
  return { ok: true, parsed: false };
}

export function guardSql(sql: string): GuardVerdict {
  let tableList: string[];
  let cteNames: Set<string>;
  try {
    const ast = parser.astify(sql, OPT);
    const statements = Array.isArray(ast) ? ast : [ast];
    if (statements.length !== 1)
      return { ok: false, parsed: true, reason: "Une seule instruction SQL autorisée." };
    const stmt = statements[0] as {
      type?: string;
      with?: Array<{ name?: { value?: string } }> | null;
    };
    if (stmt.type !== "select")
      return {
        ok: false,
        parsed: true,
        reason: `Opération '${stmt.type ?? "inconnue"}' interdite : base en lecture seule (SELECT).`,
      };
    // Les noms de CTE (WITH x AS …) apparaissent dans tableList comme des
    // tables : ce sont des alias internes, pas des objets réels.
    cteNames = new Set(
      (stmt.with ?? [])
        .map((c) => c.name?.value)
        .filter((v): v is string => typeof v === "string"),
    );
    tableList = parser.tableList(sql, OPT);
  } catch {
    return conservativeFallback(sql);
  }

  for (const entry of tableList) {
    const parts = entry.split("::");
    const authority = parts[0];
    const table = parts[2];
    if (authority !== "select")
      return {
        ok: false,
        parsed: true,
        reason: `Accès '${authority}' sur ${table} interdit (lecture seule).`,
      };
    if (cteNames.has(table)) continue;
    if (!ALLOWED_TABLES.has(table.toLowerCase()))
      return {
        ok: false,
        parsed: true,
        reason: `Table/vue hors périmètre : ${table}.`,
      };
  }
  return { ok: true, parsed: true };
}
