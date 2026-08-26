"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollTextIcon, XIcon, RefreshCwIcon } from "lucide-react";

interface AuditEvent {
  ts: string;
  traceId: string;
  type: string;
  tool?: string;
  error?: string;
  durationMs?: number;
  rowCount?: number;
  chartUrl?: string;
  [key: string]: unknown;
}

const TYPE_STYLE: Record<string, string> = {
  request: "text-sky-500",
  tool_call: "text-foreground",
  tool_result: "text-emerald-500",
  tool_error: "text-destructive",
  stream_error: "text-destructive",
  client_error: "text-destructive",
  process_error: "text-destructive",
  startup: "text-muted-foreground",
};

function summary(e: AuditEvent): string {
  if (e.error) return String(e.error);
  if (e.type === "tool_result")
    return [
      e.tool,
      e.rowCount != null ? `${e.rowCount} lignes` : undefined,
      e.chartUrl ? "graphique" : undefined,
      e.durationMs != null ? `${e.durationMs} ms` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  if (e.type === "tool_call") return `${e.tool} — ${JSON.stringify(e.args ?? {})}`;
  if (e.type === "request") return `question (${e.messageCount ?? "?"} messages)`;
  if (e.type === "startup") return "démarrage serveur";
  return "";
}

export function AuditLog() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit?limit=150", { cache: "no-store" });
      setEvents((await res.json()) as AuditEvent[]);
    } catch {
      // silencieux : le panneau reste utilisable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [open, load]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground hover:bg-muted ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors"
        title="Journal d'audit"
      >
        <ScrollTextIcon className="size-4" />
        Traçabilité
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="bg-black/30 absolute inset-0"
            onClick={() => setOpen(false)}
          />
          <aside className="bg-background relative flex h-full w-full max-w-xl flex-col border-l shadow-xl">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <ScrollTextIcon className="size-4" />
              <span className="text-sm font-medium">Journal d&apos;audit</span>
              <span className="text-muted-foreground text-xs">
                {events.length} événements
              </span>
              <button
                onClick={load}
                className="text-muted-foreground hover:text-foreground ml-auto rounded-md p-1.5"
                title="Rafraîchir"
              >
                <RefreshCwIcon
                  className={`size-4 ${loading ? "animate-spin" : ""}`}
                />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground rounded-md p-1.5"
                title="Fermer"
              >
                <XIcon className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {events.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">
                  Aucun événement pour l&apos;instant.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5 font-mono text-xs">
                  {events.map((e, i) => (
                    <li
                      key={i}
                      className="hover:bg-muted/50 flex gap-2 rounded px-2 py-1"
                    >
                      <span className="text-muted-foreground shrink-0">
                        {e.ts.slice(11, 19)}
                      </span>
                      <span
                        className={`shrink-0 font-medium ${TYPE_STYLE[e.type] ?? "text-foreground"}`}
                      >
                        {e.type}
                      </span>
                      <span className="text-foreground/80 break-all">
                        {summary(e)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
