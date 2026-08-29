"use client";

// Rendu des outils SERVEUR d'écriture encadrée (workspace gestion) :
// set_order_status / record_payment. Quatre issues possibles : exécuté (admin),
// approval_required (l'opérateur verra la carte request_write_approval),
// blocked (profil sans écriture), ou erreur Db2 (procédure qui refuse).

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Loader2Icon } from "lucide-react";
import { ToolErrorBoundary } from "@/components/tool-uis/tool-error-boundary";

type WriteToolOutput =
  | { ok: true }
  | { status: "approval_required"; proc?: string }
  | { blocked: true; reason?: string }
  | { error: string };

const makeWriteToolUI = (toolName: string, label: string) =>
  makeAssistantToolUI<Record<string, unknown>, WriteToolOutput>({
    toolName,
    render: ({ args, result, status }) => {
      const detail = (
        <div className="bg-muted/50 rounded-md p-2.5 font-mono text-xs">
          {Object.entries(args ?? {}).map(([k, v]) => (
            <div key={k}>
              <span className="text-muted-foreground">{k} :</span> {String(v)}
            </div>
          ))}
        </div>
      );

      if (status.type === "running") {
        return (
          <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {label}…
            </div>
            {detail}
          </div>
        );
      }
      if (!result) return null;

      return (
        <ToolErrorBoundary toolName={toolName}>
          <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
            <span className="text-muted-foreground text-xs font-medium">{label}</span>
            {detail}
            {"ok" in result && result.ok ? (
              <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-600 dark:text-emerald-500">
                Écriture exécutée directement (profil sur-privilégié — aucun garde-fou).
              </p>
            ) : "status" in result ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-500">
                Écriture encadrée — validation de l&apos;opérateur demandée.
              </p>
            ) : "blocked" in result ? (
              <p className="text-muted-foreground rounded-md border p-2 text-xs">
                Écriture refusée{result.reason ? ` : ${result.reason}` : ""}.
              </p>
            ) : (
              <p className="border-destructive/50 text-destructive rounded-md border p-2 text-xs">
                Erreur : {(result as { error: string }).error}
              </p>
            )}
          </div>
        </ToolErrorBoundary>
      );
    },
  });

export const SetOrderStatusToolUI = makeWriteToolUI(
  "set_order_status",
  "Changement de statut de commande",
);
export const RecordPaymentToolUI = makeWriteToolUI(
  "record_payment",
  "Enregistrement d'un paiement",
);
