import { audit, newTraceId, readAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 200, 1000);
  return Response.json(await readAudit(limit));
}

const CLIENT_TYPES = new Set([
  "client_error",
  "sql_approval",
  "injection_detected",
  "injection_ack",
]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    traceId?: string;
    type?: string;
    message?: string;
    stack?: string;
    url?: string;
    decision?: string;
    sql?: string;
    profile?: string;
    source?: string;
    excerpt?: string;
    reason?: string;
  };
  const type = CLIENT_TYPES.has(body.type ?? "") ? body.type! : "client_error";
  const traceId = body.traceId ?? newTraceId();
  if (type === "sql_approval") {
    // Décision d'approbation prise dans l'UI : on trace QUI (profil actif) et QUOI.
    await audit(traceId, "sql_approval", {
      decision: body.decision,
      profile: body.profile,
      sql: body.sql,
    });
  } else if (type === "injection_detected") {
    // L'agent a signalé une tentative d'injection via l'outil report_injection.
    await audit(traceId, "injection_detected", {
      profile: body.profile,
      source: body.source,
      excerpt: body.excerpt,
      reason: body.reason,
    });
  } else if (type === "injection_ack") {
    // L'analyste a accusé réception du signalement d'injection.
    await audit(traceId, "injection_ack", {
      profile: body.profile,
      source: body.source,
    });
  } else {
    await audit(traceId, "client_error", {
      error: body.message ?? "unknown client error",
      stack: body.stack,
      url: body.url,
    });
  }
  return Response.json({ ok: true });
}
