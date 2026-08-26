import { audit, newTraceId, readAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 200, 1000);
  return Response.json(await readAudit(limit));
}

const CLIENT_TYPES = new Set(["client_error", "sql_approval"]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    traceId?: string;
    type?: string;
    message?: string;
    stack?: string;
    url?: string;
    decision?: string;
    sql?: string;
  };
  const type = CLIENT_TYPES.has(body.type ?? "") ? body.type! : "client_error";
  if (type === "sql_approval") {
    await audit(body.traceId ?? newTraceId(), "sql_approval", {
      decision: body.decision,
      sql: body.sql,
    });
  } else {
    await audit(body.traceId ?? newTraceId(), "client_error", {
      error: body.message ?? "unknown client error",
      stack: body.stack,
      url: body.url,
    });
  }
  return Response.json({ ok: true });
}
