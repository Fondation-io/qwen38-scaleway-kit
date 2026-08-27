import { Parser } from "node-sql-parser";
import { SENSITIVE_COLUMNS as MASTER_SENSITIVE_COLUMNS } from "@/lib/profiles";
import type { ProfilePolicy } from "@/lib/profiles";

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
  // Base pot de miel IBM i (schéma HONEYPOT) — journal QAUDJRN brut.
  "qaudjrn_pw",
  "qaudjrn_sk",
  "qaudjrn_im",
]);

// Aide renvoyée dans les erreurs « hors périmètre » : sans catalogue interrogeable,
// un agent qui tente QSYS2.SYSTABLES ou sqlite_master boucle. On lui donne
// directement la liste des objets à interroger.
const AVAILABLE_OBJECTS =
  "Il n'y a PAS de catalogue système interrogeable (ni QSYS2.SYSTABLES ni sqlite_master). " +
  "Interroge directement ces objets : SECAUDIT.QAUDJRN_SIGNON, SECAUDIT.QAUDJRN_TRANSFER, " +
  "SECAUDIT.QAUDJRN_OBJECT, SECAUDIT.QAUDJRN_MAIL, SECAUDIT.QAUDJRN_PROFILE_SWAP, " +
  "SECAUDIT.USER_PROFILES, SECAUDIT.DAILY_BASELINE, HONEYPOT.qaudjrn_pw, HONEYPOT.qaudjrn_sk, " +
  "HONEYPOT.qaudjrn_im, guide_evidence, cert_insiders, data_profile.";

// Normalise les quelques constructs Db2 for i qui divergent de SQLite, AVANT
// le parsing/exécution. L'agent écrit du Db2 authentique (ex. FETCH FIRST) ;
// le moteur reste SQLite. 95 % du SQL est commun ; on ne traite que le delta.
export function normalizeDb2(sql: string): string {
  return sql
    .replace(/\bFETCH\s+FIRST\s+(\d+)\s+ROWS?\s+ONLY\b/gi, "LIMIT $1")
    .replace(/\bFETCH\s+FIRST\s+ROW\s+ONLY\b/gi, "LIMIT 1");
}

const FORBIDDEN =
  /\b(ATTACH|DETACH|PRAGMA|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|VACUUM|REINDEX|TRIGGER)\b/i;
const BLOCKED_IDENTIFIERS =
  /\b(sqlite_[a-z_]+|cert_http|cert_logon|cert_device|cert_email|cert_file)\b/i;

export interface GuardVerdict {
  ok: boolean;
  reason?: string;
  parsed: boolean; // true = validé par l'AST ; false = validé par le repli regex
}

// Colonnes à contenu sensible (charge utile / PII exfiltrable). Repli
// rétrocompat pour le chemin SANS politique (comportement historique — ne
// couvre que le contenu de mail/objet, pas les PII employee_name/email).
const SENSITIVE_COLUMNS =
  /\b(content|object_preview|recipients|sender|attachments)\b/i;
const SELECT_STAR = /select\s+\*/i;
// Vues dont un SELECT * expose ce contenu.
const SENSITIVE_VIEWS = /\b(qaudjrn_mail|qaudjrn_object)\b/i;
const AGGREGATE = /\b(count|sum|avg|min|max)\s*\(|\bgroup\s+by\b/i;

// Colonnes sensibles exposées par un SELECT * sur chaque vue à contenu. Sert à
// traiter l'étoile comme touchant explicitement ces colonnes (le parser ne
// développe pas `*` en liste de colonnes réelles).
const SENSITIVE_VIEW_COLUMNS: Record<string, string[]> = {
  qaudjrn_mail: ["recipients", "sender", "attachments", "content"],
  qaudjrn_object: ["object_preview"],
};

export interface RiskVerdict {
  risky: boolean;
  blocked?: boolean; // true = refus dur (profil contentAccess "none")
  reason?: string;
}

// Retourne, parmi `deniedColumns`, celles que la requête touche réellement.
// Détection en trois temps :
//  (a) AST : `parser.columnList` renvoie `type::table::column` ; on croise le
//      nom de colonne (dernier segment) avec la liste interdite. `null`/`(.*)`
//      sont ignorés ici (l'étoile est gérée en (b)) ;
//  (b) SELECT * sur une vue sensible (qaudjrn_mail/qaudjrn_object) = touche les
//      colonnes sensibles de cette vue ;
//  (c) repli regex `\bcol\b` (insensible casse) si le parser échoue — fail-closed.
export function referencedSensitiveColumns(
  sql: string,
  deniedColumns: string[],
): string[] {
  if (deniedColumns.length === 0) return [];
  const denied = new Set(deniedColumns.map((c) => c.toLowerCase()));
  const hits = new Set<string>();

  // (b) SELECT * sur une vue sensible : ajoute les colonnes sensibles de la vue
  // (indépendant du parsing, marche aussi sur le chemin repli).
  if (SELECT_STAR.test(sql)) {
    for (const [view, cols] of Object.entries(SENSITIVE_VIEW_COLUMNS)) {
      if (new RegExp(`\\b${view}\\b`, "i").test(sql)) {
        for (const c of cols) if (denied.has(c)) hits.add(c);
      }
    }
  }

  try {
    // (a) colonnes réellement listées dans l'AST.
    const cols = parser.columnList(sql, OPT);
    for (const entry of cols) {
      const col = entry.split("::").pop() ?? "";
      const name = col.toLowerCase();
      if (name === "(.*)" || name === "*" || name === "null" || name === "")
        continue;
      if (denied.has(name)) hits.add(name);
    }
  } catch {
    // (c) repli fail-closed : test regex mot-entier de chaque colonne interdite.
    for (const c of denied) {
      if (new RegExp(`\\b${c}\\b`, "i").test(sql)) hits.add(c);
    }
  }

  return [...hits];
}

// Heuristique appliquée APRÈS parsing. La détection de sensibilité de base
// reste « lit du contenu sensible en clair SANS agrégation » (agrégats et
// comptages passent sans friction) ; c'est la DÉCISION (refus / carte /
// passage) qui dépend du profil :
//  - sans `policy` → comportement historique (rétrocompat) ;
//  - `contentAccess: "none"`        → refus dur (blocked) si une colonne
//    interdite du profil est lue en clair ;
//  - `contentAccess: "self-approve"`→ carte d'approbation (comme avant) ;
//  - `contentAccess: "allowed" | "unrestricted"` → jamais bloqué, jamais de carte.
export function assessRisk(sql: string, policy?: ProfilePolicy): RiskVerdict {
  // Chemin rétrocompat : aucune politique → heuristique historique inchangée.
  if (!policy) {
    const readsContent =
      SENSITIVE_COLUMNS.test(sql) ||
      (SELECT_STAR.test(sql) && SENSITIVE_VIEWS.test(sql));
    if (readsContent && !AGGREGATE.test(sql)) {
      return {
        risky: true,
        reason:
          "Lecture de contenu sensible en clair (corps de mail, objets, destinataires, pièces jointes) sans agrégation.",
      };
    }
    return { risky: false };
  }

  // Profils habilités : aucune friction, quelle que soit la requête.
  if (policy.contentAccess === "allowed" || policy.contentAccess === "unrestricted") {
    return { risky: false };
  }

  const aggregated = AGGREGATE.test(sql);

  if (policy.contentAccess === "none") {
    // Refus dur si une colonne INTERDITE DU PROFIL est lue en clair.
    const touched = referencedSensitiveColumns(sql, policy.deniedColumns);
    if (touched.length > 0 && !aggregated) {
      return {
        risky: true,
        blocked: true,
        reason: `Le profil actif n'est pas autorisé à lire ce contenu sensible (${touched.join(
          ", ",
        )}). Reformule en agrégat.`,
      };
    }
    return { risky: false };
  }

  // contentAccess === "self-approve" : carte si lecture de contenu sensible
  // (liste maîtresse) en clair — `deniedColumns` est vide pour ce profil, on
  // s'appuie donc sur les colonnes réellement détectées côté liste maîtresse.
  const sensitive = referencedSensitiveColumns(sql, MASTER_SENSITIVE_COLUMNS);
  if (sensitive.length > 0 && !aggregated) {
    return {
      risky: true,
      reason: `Lecture de contenu sensible en clair (${sensitive.join(
        ", ",
      )}) sans agrégation.`,
    };
  }
  return { risky: false };
}

// Repli quand le parser échoue : gardes conservatrices et restrictives.
// Neutralise le contenu des littéraux chaîne ('...' avec échappement '', "...")
// avant les vérifications regex : sinon un point-virgule ou un mot-clé DANS une
// chaîne (ex. STRING_AGG(x, '; ')) déclenche un faux positif « multi-instruction ».
function stripStringLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

function conservativeFallback(sql: string): GuardVerdict {
  const text = sql.trim().replace(/;\s*$/, "");
  // Les gardes structurelles s'appliquent au SQL SANS le contenu des chaînes.
  const bare = stripStringLiterals(text);
  if (bare.includes(";"))
    return { ok: false, parsed: false, reason: "Une seule instruction SQL autorisée." };
  if (!/^(SELECT|WITH)\b/i.test(text))
    return { ok: false, parsed: false, reason: "Lecture seule (SELECT ou WITH)." };
  if (FORBIDDEN.test(bare))
    return { ok: false, parsed: false, reason: "Mot-clé interdit (écriture/PRAGMA/ATTACH…)." };
  if (BLOCKED_IDENTIFIERS.test(bare))
    return { ok: false, parsed: false, reason: `Table hors périmètre ou introspection. ${AVAILABLE_OBJECTS}` };
  return { ok: true, parsed: false };
}

// Garde STRUCTURELLE (lecture seule + allowlist de vues + CTE + repli
// fail-closed). Le paramètre `policy` est accepté pour compatibilité de
// signature (D4) mais volontairement IGNORÉ ici : le blocage colonne-level vit
// dans `assessRisk`, pas dans la garde read-only. Cela garde une seule source
// de vérité pour le gating par profil et laisse `guardSql` indépendant du profil.
export function guardSql(sql: string, _policy?: ProfilePolicy): GuardVerdict {
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
        reason: `Table/vue hors périmètre : ${table}. ${AVAILABLE_OBJECTS}`,
      };
  }
  return { ok: true, parsed: true };
}
