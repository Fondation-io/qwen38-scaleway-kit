import { audit, newTraceId, readAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 200, 1000);
  return Response.json(await readAudit(limit));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    traceId?: string;
    message?: string;
    stack?: string;
    url?: string;
  };
  await audit(body.traceId ?? newTraceId(), "client_error", {
    error: body.message ?? "unknown client error",
    stack: body.stack,
    url: body.url,
  });
  return Response.json({ ok: true });
}
