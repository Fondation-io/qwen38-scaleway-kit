import { db2Call } from "@/lib/db2";
import { getProfile } from "@/lib/profiles";
import { audit, newTraceId } from "@/lib/audit";

export const runtime = "nodejs";

// Exécution d'une écriture ENCADRÉE du workspace gestion, après approbation
// humaine (carte request_write_approval). Défense en profondeur côté serveur :
// - seul un profil gestion avec droit d'écriture passe (operateur/admin) ;
// - seules les 2 procédures stockées whitelistées sont appelables ;
// - la procédure Db2 revalide ses paramètres (statuts/types licites) ;
// - le compte Db2 du profil porte les GRANTs réels (EXECUTE, pas d'accès table).
const ALLOWED_PROCS = new Set(["SET_ORDER_STATUS", "RECORD_PAYMENT"]);

export async function POST(req: Request) {
  const traceId = newTraceId();
  const body = (await req.json().catch(() => ({}))) as {
    proc?: string;
    args?: Record<string, unknown>;
  };
  const profile = getProfile(req.headers.get("x-demo-profile"));
  const proc = body.proc ?? "";
  const args = body.args ?? {};

  if (!ALLOWED_PROCS.has(proc)) {
    return Response.json({ error: `Procédure non autorisée : ${proc}` });
  }
  if (
    profile.workspace !== "gestion" ||
    !profile.db2Role ||
    profile.writeAccess === "none" ||
    profile.writeAccess === undefined
  ) {
    await audit(traceId, "write_approval", {
      decision: "blocked",
      profile: profile.id,
      proc,
      args,
    });
    return Response.json({
      blocked: true,
      reason: "Le profil actif n'a aucun droit d'écriture.",
    });
  }

  await audit(traceId, "write_approval", {
    decision: "approved",
    profile: profile.id,
    proc,
    args,
  });
  const started = Date.now();
  const res = await db2Call(
    proc as "SET_ORDER_STATUS" | "RECORD_PAYMENT",
    args,
    profile.db2Role,
  );
  if ("error" in res) {
    await audit(traceId, "tool_error", {
      tool: proc,
      profile: profile.id,
      ok: false,
      durationMs: Date.now() - started,
      error: res.error,
    });
    return Response.json(res);
  }
  await audit(traceId, "tool_result", {
    tool: proc,
    profile: profile.id,
    ok: true,
    durationMs: Date.now() - started,
  });
  return Response.json({ ok: true, proc, args });
}
