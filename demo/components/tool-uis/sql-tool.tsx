"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Loader2Icon } from "lucide-react";
import type { FC } from "react";
import { ToolErrorBoundary } from "@/components/tool-uis/tool-error-boundary";

type SqlToolArgs = {
  sql?: string;
  table?: string;
};

type SqlToolResult = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
};

type SqlToolError = { error: string };
// sql_query (tool serveur) peut renvoyer, au lieu de lignes : une demande
// d'approbation (requête sensible) ou un refus dur (profil).
type SqlToolApproval = { status: "approval_required"; reason?: string };
type SqlToolBlocked = { blocked: true; reason?: string };

type SqlToolOutput =
  | SqlToolResult
  | SqlToolError
  | SqlToolApproval
  | SqlToolBlocked;

const isError = (r: SqlToolOutput): r is SqlToolError =>
  r != null && "error" in r;
const isApproval = (r: SqlToolOutput): r is SqlToolApproval =>
  r != null && (r as SqlToolApproval).status === "approval_required";
const isBlocked = (r: SqlToolOutput): r is SqlToolBlocked =>
  r != null && (r as SqlToolBlocked).blocked === true;

const MAX_DISPLAYED_ROWS = 20;

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const SqlText: FC<{ sql: string }> = ({ sql }) => (
  <pre className="bg-muted/50 text-foreground/90 overflow-x-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap">
    {sql}
  </pre>
);

const ResultTable: FC<{ result: SqlToolResult }> = ({ result }) => {
  const rows = result.rows.slice(0, MAX_DISPLAYED_ROWS);

  if (result.rowCount === 0) {
    return <p className="text-muted-foreground text-sm">Aucune ligne renvoyée.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b">
              {result.columns.map((column) => (
                <th
                  key={column}
                  className="text-muted-foreground px-2.5 py-1.5 text-start font-medium whitespace-nowrap"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2.5 py-1.5 whitespace-nowrap">
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rowCount > rows.length && (
        <p className="text-muted-foreground text-xs">
          … {result.rowCount} lignes au total
        </p>
      )}
    </>
  );
};

const makeSqlToolUI = (options: {
  toolName: string;
  runningLabel: string;
  summaryLabel: string;
  collapsedSql?: boolean;
}) =>
  makeAssistantToolUI<SqlToolArgs, SqlToolOutput>({
    toolName: options.toolName,
    render: ({ args, result, status }) => {
      const sqlText =
        args.sql ??
        (args.table ? `Table : ${args.table}` : "Toutes les tables");

      if (status.type === "running") {
        return (
          <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {options.runningLabel}
            </div>
            <SqlText sql={sqlText} />
          </div>
        );
      }

      if (status.type === "incomplete") {
        return (
          <div className="border-destructive/50 text-destructive my-2 rounded-lg border p-3 text-sm">
            La requête a échoué.
          </div>
        );
      }

      if (!result) return null;

      return (
        <ToolErrorBoundary toolName={options.toolName}>
        <div className="my-2 flex flex-col gap-2 rounded-lg border p-3">
          {options.collapsedSql ? (
            <details>
              <summary className="text-muted-foreground cursor-pointer text-xs font-medium select-none">
                {options.summaryLabel}
              </summary>
              <div className="mt-2">
                <SqlText sql={sqlText} />
              </div>
            </details>
          ) : (
            <>
              <span className="text-muted-foreground text-xs font-medium">
                {options.summaryLabel}
              </span>
              <SqlText sql={sqlText} />
            </>
          )}
          {isError(result) ? (
            <p className="border-destructive/50 text-destructive rounded-md border p-2 text-xs">
              Erreur : {result.error}
            </p>
          ) : isApproval(result) ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-500">
              Requête sensible — validation de l&apos;analyste demandée
              {result.reason ? ` (${result.reason})` : ""}.
            </p>
          ) : isBlocked(result) ? (
            <p className="text-muted-foreground rounded-md border p-2 text-xs">
              Requête refusée par la gate
              {result.reason ? ` : ${result.reason}` : ""}.
            </p>
          ) : (
            <ResultTable result={result} />
          )}
        </div>
        </ToolErrorBoundary>
      );
    },
  });

export const SqlQueryToolUI = makeSqlToolUI({
  toolName: "sql_query",
  runningLabel: "Requête SQL en cours…",
  summaryLabel: "Requête SQL",
});

export const DescribeDataToolUI = makeSqlToolUI({
  toolName: "describe_data",
  runningLabel: "Lecture du schéma des données…",
  summaryLabel: "Description des données",
  collapsedSql: true,
});
