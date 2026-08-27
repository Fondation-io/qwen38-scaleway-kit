import { runQuery } from "@/lib/db";
import { assessRisk } from "@/lib/sql-guard";
import { getProfile } from "@/lib/profiles";
import { audit, newTraceId } from "@/lib/audit";

export const runtime = "nodejs";

// Exécution d'une requête SQL avec gate d'approbation PARAMÉTRÉE PAR PROFIL :
// - la gate AST re-tourne côté serveur (défense en profondeur) ;
// - le profil actif (header `x-demo-profile`) détermine la décision de risque :
//   `blocked` (refus dur, non exécuté), `approval_required` (carte), ou passage.
//   Les profils habilités (allowed/unrestricted) court-circuitent la friction.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sql?: string;
    approved?: boolean;
    traceId?: string;
  };
  const traceId = body.traceId ?? newTraceId();
  const sql = typeof body.sql === "string" ? body.sql : "";
  const approved = body.approved === true;

  // Profil actif (RBAC simulé) : résout la politique de gating par colonne.
  const profile = getProfile(req.headers.get("x-demo-profile"));

  const risk = assessRisk(sql, profile.policy);

  // Refus dur : le profil n'est pas autorisé à lire ce contenu — non exécuté.
  if (risk.blocked) {
    await audit(traceId, "sql_approval", {
      decision: "blocked",
      profile: profile.id,
      reason: risk.reason,
      sql,
    });
    return Response.json({ status: "blocked", reason: risk.reason });
  }

  if (risk.risky && !approved) {
    await audit(traceId, "sql_approval", {
      decision: "requested",
      profile: profile.id,
      reason: risk.reason,
      sql,
    });
    return Response.json({ status: "approval_required", reason: risk.reason });
  }

  await audit(traceId, "tool_call", {
    tool: "sql_query",
    profile: profile.id,
    approved: risk.risky ? true : undefined,
    autoApproved: risk.risky ? undefined : true,
    args: { sql },
  });
  const started = Date.now();
  try {
    const result = runQuery(sql);
    await audit(traceId, "tool_result", {
      tool: "sql_query",
      profile: profile.id,
      ok: true,
      durationMs: Date.now() - started,
      rowCount: result.rowCount,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit(traceId, "tool_error", {
      tool: "sql_query",
      profile: profile.id,
      ok: false,
      durationMs: Date.now() - started,
      error: message,
    });
    return Response.json({ error: message });
  }
}
