import { appendFile, readFile } from "node:fs/promises";

// Journal d'audit structuré (JSON lines). Écrit sur stdout (capté par
// `docker logs`) ET dans un fichier persistant sous le volume /data, pour
// survivre aux redémarrages de conteneur. Sert à la fois au diagnostic
// (erreurs) et à la démo (traçabilité des actions de l'agent).

const AUDIT_LOG = process.env.AUDIT_LOG ?? "/data/audit.jsonl";

export type AuditType =
  | "startup"
  | "request"
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "stream_error"
  | "client_error"
  | "sql_approval"
  | "injection_detected"
  | "injection_ack"
  | "process_error";

export interface AuditEvent {
  ts: string;
  traceId: string;
  type: AuditType;
  [key: string]: unknown;
}

export function newTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function audit(
  traceId: string,
  type: AuditType,
  data: Record<string, unknown> = {},
): Promise<void> {
  const event: AuditEvent = {
    ts: new Date().toISOString(),
    traceId,
    type,
    ...data,
  };
  const line = JSON.stringify(event);
  // stdout -> docker logs
  console.log(`[audit] ${line}`);
  try {
    await appendFile(AUDIT_LOG, `${line}\n`);
  } catch (err) {
    console.error(
      "[audit] write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Version synchrone-safe pour les contextes qui ne peuvent pas await
// (handlers de process). Ne bloque pas sur l'écriture fichier.
export function auditFireAndForget(
  traceId: string,
  type: AuditType,
  data: Record<string, unknown> = {},
): void {
  void audit(traceId, type, data);
}

export async function readAudit(limit = 200): Promise<AuditEvent[]> {
  try {
    const text = await readFile(AUDIT_LOG, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEvent => e !== null)
      .reverse();
  } catch {
    return [];
  }
}
