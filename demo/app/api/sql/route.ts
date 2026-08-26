import { runQuery } from "@/lib/db";
import { audit, newTraceId } from "@/lib/audit";

export const runtime = "nodejs";

// Exécution d'une requête SQL APRÈS approbation humaine (gate front). La
// requête repasse par la gate AST côté serveur (défense en profondeur : le
// client ne peut pas contourner l'allowlist).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sql?: string;
    traceId?: string;
  };
  const traceId = body.traceId ?? newTraceId();
  const sql = typeof body.sql === "string" ? body.sql : "";

  await audit(traceId, "tool_call", {
    tool: "sql_query",
    approved: true,
    args: { sql },
  });
  const started = Date.now();
  try {
    const result = runQuery(sql);
    await audit(traceId, "tool_result", {
      tool: "sql_query",
      ok: true,
      approved: true,
      durationMs: Date.now() - started,
      rowCount: result.rowCount,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit(traceId, "tool_error", {
      tool: "sql_query",
      ok: false,
      approved: true,
      durationMs: Date.now() - started,
      error: message,
    });
    return Response.json({ error: message });
  }
}
