import { runQuery } from "@/lib/db";
import { assessRisk } from "@/lib/sql-guard";
import { audit, newTraceId } from "@/lib/audit";

export const runtime = "nodejs";

// Exécution d'une requête SQL avec gate d'approbation CONDITIONNELLE :
// - la gate AST re-tourne côté serveur (défense en profondeur) ;
// - une heuristique classe le risque après parsing ; si la requête est jugée
//   risquée et n'a PAS été explicitement approuvée, on renvoie
//   { status: "approval_required" } sans exécuter — le front affiche la carte
//   d'approbation. Sinon (faible risque, ou approuvée) on exécute.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sql?: string;
    approved?: boolean;
    traceId?: string;
  };
  const traceId = body.traceId ?? newTraceId();
  const sql = typeof body.sql === "string" ? body.sql : "";
  const approved = body.approved === true;

  const risk = assessRisk(sql);
  if (risk.risky && !approved) {
    await audit(traceId, "sql_approval", {
      decision: "requested",
      reason: risk.reason,
      sql,
    });
    return Response.json({ status: "approval_required", reason: risk.reason });
  }

  await audit(traceId, "tool_call", {
    tool: "sql_query",
    approved: risk.risky ? true : undefined,
    autoApproved: risk.risky ? undefined : true,
    args: { sql },
  });
  const started = Date.now();
  try {
    const result = runQuery(sql);
    await audit(traceId, "tool_result", {
      tool: "sql_query",
      ok: true,
      durationMs: Date.now() - started,
      rowCount: result.rowCount,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit(traceId, "tool_error", {
      tool: "sql_query",
      ok: false,
      durationMs: Date.now() - started,
      error: message,
    });
    return Response.json({ error: message });
  }
}
