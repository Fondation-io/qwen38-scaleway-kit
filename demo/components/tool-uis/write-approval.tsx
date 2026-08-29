"use client";

// Carte d'approbation d'une ÉCRITURE encadrée (workspace gestion). Le tool
// serveur (set_order_status / record_payment) a renvoyé approval_required :
// le modèle rappelle request_write_approval avec les mêmes arguments, cette
// carte demande la décision de l'opérateur, puis exécute via /api/db2-write
// (procédure stockée whitelistée, compte Db2 du profil).

import { makeAssistantTool } from "@assistant-ui/react";
import {
  CheckIcon,
  XIcon,
  PenLineIcon,
  Loader2Icon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ToolErrorBoundary } from "@/components/tool-uis/tool-error-boundary";
import { getActiveProfileId } from "@/app/runtime/profile-context";

type WriteResult =
  | { ok: true }
  | { error: string }
  | { rejected: true }
  | { blocked: true; reason?: string };

const PROC_LABELS: Record<string, string> = {
  SET_ORDER_STATUS: "Changement de statut de commande",
  RECORD_PAYMENT: "Enregistrement d'un paiement",
};

function WriteApprovalRender(props: {
  args: { proc?: unknown; args?: unknown };
  result?: unknown;
  addResult: (result: unknown) => void;
}) {
  const proc = typeof props.args?.proc === "string" ? props.args.proc : "";
  const args = (props.args?.args ?? {}) as Record<string, unknown>;
  const result = props.result as WriteResult | undefined;
  const [busy, setBusy] = useState(false);

  const detail = (
    <div className="bg-muted/50 rounded-md p-2.5 font-mono text-xs">
      <div className="text-foreground/90 font-medium">
        {PROC_LABELS[proc] ?? proc}
      </div>
      {Object.entries(args).map(([k, v]) => (
        <div key={k}>
          <span className="text-muted-foreground">{k} :</span> {String(v)}
        </div>
      ))}
    </div>
  );

  if (result !== undefined) {
    return (
      <ToolErrorBoundary toolName="request_write_approval">
        <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
          <span className="text-muted-foreground text-xs font-medium">
            Écriture encadrée
          </span>
          {detail}
          {"ok" in result && result.ok ? (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-600 dark:text-emerald-500">
              Écriture exécutée via la procédure stockée (tracée au journal).
            </p>
          ) : "rejected" in result ? (
            <p className="text-muted-foreground text-xs">
              Écriture refusée par l&apos;opérateur — non exécutée.
            </p>
          ) : "blocked" in result ? (
            <p className="text-muted-foreground rounded-md border p-2 text-xs">
              Écriture bloquée{"reason" in result && result.reason ? ` : ${result.reason}` : ""}.
            </p>
          ) : (
            <p className="border-destructive/50 text-destructive rounded-md border p-2 text-xs">
              Erreur : {(result as { error: string }).error}
            </p>
          )}
        </div>
      </ToolErrorBoundary>
    );
  }

  const approve = async () => {
    if (busy || !proc) return;
    setBusy(true);
    try {
      const res = await fetch("/api/db2-write", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-profile": getActiveProfileId(),
        },
        body: JSON.stringify({ proc, args }),
      });
      props.addResult((await res.json()) as WriteResult);
    } catch (e) {
      props.addResult({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const reject = () => {
    if (busy) return;
    props.addResult({ rejected: true });
  };

  return (
    <div className="border-amber-500/40 bg-amber-500/5 my-2 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-500">
        <PenLineIcon className="size-4" />
        Écriture en base — validation requise
      </div>
      <p className="text-muted-foreground text-xs">
        Cette opération modifie la base de gestion via une procédure stockée
        paramétrée. Approuvez pour l&apos;exécuter, refusez pour la bloquer.
      </p>
      {detail}
      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={busy || !proc}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          Approuver
        </button>
        <button
          onClick={reject}
          disabled={busy}
          className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          <XIcon className="size-3.5" />
          Refuser
        </button>
      </div>
    </div>
  );
}

export const WriteApprovalTool = makeAssistantTool({
  toolName: "request_write_approval",
  description:
    "Demande la validation HUMAINE d'une écriture encadrée sur la base de gestion. À n'utiliser QUE lorsque set_order_status ou record_payment a renvoyé {status:\"approval_required\"} : rappelle ici la MÊME procédure avec les MÊMES arguments. Affiche une carte d'approbation, puis exécute si accordé.",
  parameters: z.object({
    proc: z
      .enum(["SET_ORDER_STATUS", "RECORD_PAYMENT"])
      .describe("Procédure à valider (reprendre celle du refus approval_required)"),
    args: z
      .record(z.string(), z.unknown())
      .describe("Arguments de la procédure, identiques à l'appel initial"),
  }),
  render: WriteApprovalRender,
});
