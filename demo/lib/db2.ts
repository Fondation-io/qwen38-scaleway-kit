// Client de la passerelle db2-gw (workspace GESTION). L'app ne détient AUCUNE
// credential Db2 : elle passe le rôle, la passerelle se connecte avec le compte
// Db2 correspondant — les GRANTs réels du compte s'appliquent (2ème étage de la
// défense, après la gate applicative guardDb2).

export type Db2Role = "consult" | "analyste" | "operateur" | "admin";

export interface Db2QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  affectedRows?: number;
}

export type Db2Response =
  | Db2QueryResult
  | { error: string; sqlstate?: string | null };

function gwUrl(): string {
  const url = process.env.DB2_GW_URL;
  if (!url) throw new Error("DB2_GW_URL non configuré");
  return url.replace(/\/$/, "");
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${gwUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

// Traduit les erreurs Db2 fréquentes en message actionnable pour le modèle.
function friendlyError(error: string, sqlstate?: string | null): string {
  if (error.includes("SQL0551N") || sqlstate === "42501") {
    return (
      "Privilège insuffisant : le compte Db2 du profil actif n'a pas le droit de lire cet objet " +
      "(refus SQL0551N par la base elle-même — 2ème étage de la défense). " +
      "Reste sur les objets autorisés à ce profil (les vues OLIST.V_* pour la consultation)."
    );
  }
  if (error.includes("SQL0204N")) {
    return `Objet inexistant (SQL0204N). Vérifie le nom qualifié OLIST.<table>. ${error}`;
  }
  return error;
}

export async function db2Query(sql: string, role: Db2Role): Promise<Db2Response> {
  const data = await post("/query", { sql, role });
  if (typeof data.error === "string") {
    return {
      error: friendlyError(data.error, data.sqlstate as string | null),
      sqlstate: (data.sqlstate as string | null) ?? null,
    };
  }
  return data as unknown as Db2QueryResult;
}

export async function db2Call(
  proc: "SET_ORDER_STATUS" | "RECORD_PAYMENT",
  args: Record<string, unknown>,
  role: Db2Role,
): Promise<{ ok: true } | { error: string; sqlstate?: string | null }> {
  const data = await post("/call", { proc, args, role });
  if (typeof data.error === "string") {
    return {
      error: data.error,
      sqlstate: (data.sqlstate as string | null) ?? null,
    };
  }
  return { ok: true };
}
