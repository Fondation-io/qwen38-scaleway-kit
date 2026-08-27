"use client";

import { makeAssistantTool, useToolArgsStatus } from "@assistant-ui/react";
import {
  CheckIcon,
  XIcon,
  ShieldAlertIcon,
  Loader2Icon,
  BanIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ToolErrorBoundary } from "@/components/tool-uis/tool-error-boundary";
import { getActiveProfileId } from "@/app/runtime/profile-context";

type SqlResult =
  | { columns: string[]; rows: unknown[][]; rowCount: number }
  | { error: string }
  | { rejected: true }
  // Refus dur imposé par le profil actif (contentAccess "none") : non exécuté,
  // non approuvable. Le modèle est invité à proposer un agrégat.
  | { blocked: true; reason?: string };

// En-têtes des appels /api/sql : content-type + profil actif (cloisonnement +
// gating par profil, D6).
function sqlHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-demo-profile": getActiveProfileId(),
  };
}

const MAX_ROWS = 20;
// Plafond du résultat RENVOYÉ AU MODÈLE (indépendant de l'affichage). Garde-fou
// contre le débordement de contexte sur une investigation profonde. On borne par
// NOMBRE de lignes (200, = plafond serveur) ET par TAILLE sérialisée : les lignes
// de détail larges (pot de miel : IP, ports, messages) remplissent vite le
// contexte ; les agrégats étroits gardent leurs 200 lignes. rowCount reste vrai.
const MAX_MODEL_ROWS = 200;
const MAX_MODEL_CHARS = 6000;

function capForModel(r: SqlResult): SqlResult {
  if (!("rows" in r) || !Array.isArray(r.rows)) return r;
  let rows = r.rows.slice(0, MAX_MODEL_ROWS);
  // Réduit tant que la sérialisation dépasse le budget (garde ≥ 5 lignes).
  while (rows.length > 5 && JSON.stringify(rows).length > MAX_MODEL_CHARS) {
    rows = rows.slice(0, Math.ceil(rows.length * 0.7));
  }
  return rows.length === r.rows.length ? r : { ...r, rows };
}

const formatCell = (v: unknown): string =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);

function ResultView({ result }: { result: SqlResult }) {
  if ("blocked" in result) {
    return (
      <div className="border-destructive/50 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-2.5 text-xs">
        <BanIcon className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            Accès refusé par le profil — requête bloquée.
          </span>
          {result.reason && (
            <span className="text-destructive/80">{result.reason}</span>
          )}
        </div>
      </div>
    );
  }
  if ("rejected" in result) {
    return (
      <p className="text-muted-foreground text-xs">
        Requête refusée par l&apos;analyste — non exécutée.
      </p>
    );
  }
  if ("error" in result) {
    return (
      <p className="border-destructive/50 text-destructive rounded-md border p-2 text-xs">
        Erreur : {result.error}
      </p>
    );
  }
  if (result.rowCount === 0) {
    return <p className="text-muted-foreground text-xs">Aucune ligne renvoyée.</p>;
  }
  const rows = result.rows.slice(0, MAX_ROWS);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            {result.columns.map((c) => (
              <th
                key={c}
                className="text-muted-foreground px-2.5 py-1.5 text-start font-medium whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className="px-2.5 py-1.5 whitespace-nowrap">
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function logDecision(decision: string, sql: string) {
  fetch("/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Profil actif = approbateur (trace : QUI a approuvé/refusé).
    body: JSON.stringify({
      type: "sql_approval",
      decision,
      sql,
      profile: getActiveProfileId(),
    }),
  }).catch(() => {});
}

type ApprovalResponse =
  | SqlResult
  | { status: "approval_required"; reason?: string }
  | { status: "blocked"; reason?: string };

function SqlApprovalRender(props: {
  args: { sql?: unknown };
  result?: unknown;
  addResult: (result: unknown) => void;
}) {
  const sql = typeof props.args?.sql === "string" ? props.args.sql : "";
  const result = props.result as SqlResult | undefined;
  const addResult = props.addResult as (r: SqlResult) => void;

  // Statut de streaming des arguments : tant que `sql` n'est pas COMPLET, la
  // valeur affichée/évaluée est partielle (ex. "SELECT", ou une requête sans son
  // guillemet fermant). On n'évalue la requête qu'une fois les args entièrement
  // reçus, sinon on POST du SQL tronqué → erreur de syntaxe et carte bloquée.
  const { propStatus } = useToolArgsStatus<{ sql: string }>();
  const sqlComplete = propStatus.sql === "complete";

  // "checking" = évaluation heuristique en cours ; "awaiting" = risque détecté,
  // on attend la décision de l'analyste.
  const [phase, setPhase] = useState<"checking" | "awaiting">("checking");
  const [reason, setReason] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const runSql = async (approve: boolean): Promise<SqlResult> => {
    const res = await fetch("/api/sql", {
      method: "POST",
      headers: sqlHeaders(),
      body: JSON.stringify({ sql, approved: approve }),
    });
    return (await res.json()) as SqlResult;
  };

  // Évaluation initiale : exécute directement si faible risque, sinon passe en
  // attente d'approbation. Ne tourne qu'une fois.
  useEffect(() => {
    if (startedRef.current || result !== undefined) return;
    // Attendre que les arguments soient entièrement streamés avant d'évaluer.
    if (!sqlComplete || !sql) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/sql", {
          method: "POST",
          headers: sqlHeaders(),
          body: JSON.stringify({ sql }),
        });
        const data = (await res.json()) as ApprovalResponse;
        if ("status" in data && data.status === "approval_required") {
          setReason(data.reason);
          setPhase("awaiting");
        } else if ("status" in data && data.status === "blocked") {
          // Refus dur : on rend le résultat au run pour qu'il reprenne et que
          // le modèle propose une alternative (agrégat).
          addResult({ blocked: true, reason: data.reason });
        } else {
          addResult(capForModel(data as SqlResult));
        }
      } catch (e) {
        addResult({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, sqlComplete]);

  const sqlBlock = (
    <pre className="bg-muted/50 text-foreground/90 overflow-x-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap">
      {sql || "(requête en préparation…)"}
    </pre>
  );

  // Résultat déjà fourni : afficher requête + résultat, sans boutons.
  if (result !== undefined) {
    return (
      <ToolErrorBoundary toolName="sql_query">
        <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
          <span className="text-muted-foreground text-xs font-medium">
            Requête SQL
          </span>
          {sqlBlock}
          <ResultView result={result} />
        </div>
      </ToolErrorBoundary>
    );
  }

  // Faible risque : exécution auto, on affiche juste la requête en cours.
  if (phase === "checking") {
    return (
      <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2Icon className="size-3.5 animate-spin" />
          Évaluation de la requête…
        </div>
        {sqlBlock}
      </div>
    );
  }

  const approve = async () => {
    if (busy || !sql) return;
    setBusy(true);
    logDecision("approved", sql);
    try {
      addResult(capForModel(await runSql(true)));
    } catch (e) {
      addResult({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const reject = () => {
    if (busy) return;
    logDecision("rejected", sql);
    addResult({ rejected: true });
  };

  return (
    <div className="border-amber-500/40 bg-amber-500/5 my-2 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-500">
        <ShieldAlertIcon className="size-4" />
        Validation requise — risque détecté
      </div>
      <p className="text-muted-foreground text-xs">
        {reason ??
          "Cette requête a été signalée comme sensible."}{" "}
        Approuvez pour l&apos;exécuter, refusez pour la bloquer.
      </p>
      {sqlBlock}
      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={busy || !sql}
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

export const SqlApprovalTool = makeAssistantTool({
  toolName: "sql_query",
  description:
    "Exécute une requête SQL en lecture seule (SELECT/WITH) sur la base d'audit Db2 for i. Les requêtes d'agrégation s'exécutent directement ; celles qui lisent du contenu sensible en clair peuvent demander une validation humaine. Formule une requête claire et autoportante.",
  parameters: z.object({
    sql: z.string().describe("Requête SQL (SELECT ou WITH ... SELECT)"),
  }),
  render: SqlApprovalRender,
});
