"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Loader2Icon } from "lucide-react";
import type { FC, ReactNode } from "react";

type ChartResult = {
  chartUrl: string;
};

type UserTimelineResult = ChartResult & {
  user: string;
  days?: unknown;
  insider?: boolean;
  window?: { start?: string; end?: string; scenario?: string | null };
};

type TransferSessionsResult = ChartResult & {
  mean: number;
  threshold_3sigma: number;
  anomalous_days: string[];
};

type AfterHoursResult = ChartResult & {
  top: { user: string; n: number }[];
  insiders_in_top: string[];
};

type OutliersResult = ChartResult & {
  anomalous_user_days: number;
  distinct_users: number;
  confirmed_insiders_flagged: string[];
};

const Badge: FC<{ children: ReactNode; variant?: "default" | "destructive" }> = ({
  children,
  variant = "default",
}) => (
  <span
    className={
      variant === "destructive"
        ? "bg-destructive/10 text-destructive inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
        : "bg-muted text-foreground/80 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
    }
  >
    {children}
  </span>
);

const MetaItem: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
  <span className="text-muted-foreground text-xs">
    {label} : <span className="text-foreground font-medium">{value}</span>
  </span>
);

const makeChartToolUI = <TResult extends ChartResult>(options: {
  toolName: string;
  runningLabel: string;
  alt: string;
  renderMeta?: (result: TResult) => ReactNode;
}) =>
  makeAssistantToolUI<Record<string, unknown>, TResult>({
    toolName: options.toolName,
    render: ({ result, status }) => {
      if (status.type === "running") {
        return (
          <div className="text-muted-foreground my-2 flex items-center gap-2 rounded-lg border p-3 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {options.runningLabel}
          </div>
        );
      }

      if (status.type === "incomplete") {
        return (
          <div className="border-destructive/50 text-destructive my-2 rounded-lg border p-3 text-sm">
            La génération du graphique a échoué.
          </div>
        );
      }

      if (!result?.chartUrl) return null;

      return (
        <div className="my-2 flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.chartUrl}
            alt={options.alt}
            className="w-full rounded-lg border"
          />
          {options.renderMeta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {options.renderMeta(result)}
            </div>
          )}
        </div>
      );
    },
  });

const dayCount = (days: unknown): number | undefined => {
  if (typeof days === "number") return days;
  if (Array.isArray(days)) return days.length;
  return undefined;
};

export const UserTimelineToolUI = makeChartToolUI<UserTimelineResult>({
  toolName: "user_timeline",
  runningLabel: "Génération du graphique d'activité…",
  alt: "Chronologie d'activité de l'utilisateur",
  renderMeta: (result) => {
    const days = dayCount(result.days);
    return (
      <>
        <MetaItem label="Utilisateur" value={result.user} />
        {result.window?.start && result.window?.end && (
          <MetaItem
            label="Période"
            value={`${result.window.start} → ${result.window.end}`}
          />
        )}
        {days !== undefined && <MetaItem label="Jours" value={days} />}
        {result.window?.scenario != null && (
          <MetaItem label="Scénario" value={result.window.scenario} />
        )}
        {result.insider && <Badge variant="destructive">Insider confirmé</Badge>}
      </>
    );
  },
});

export const TransferSessionsToolUI = makeChartToolUI<TransferSessionsResult>({
  toolName: "transfer_sessions",
  runningLabel: "Génération du graphique des sessions de transfert…",
  alt: "Sessions de transfert réseau du profil",
  renderMeta: (result) => (
    <>
      <MetaItem label="Moyenne" value={result.mean.toFixed(2)} />
      <MetaItem label="Seuil 3σ" value={result.threshold_3sigma.toFixed(2)} />
      {result.anomalous_days.length > 0 ? (
        <MetaItem
          label="Jours anormaux"
          value={result.anomalous_days.join(", ")}
        />
      ) : (
        <span className="text-muted-foreground text-xs">
          Aucun jour anormal détecté
        </span>
      )}
    </>
  ),
});

export const AfterHoursToolUI = makeChartToolUI<AfterHoursResult>({
  toolName: "after_hours",
  runningLabel: "Génération du graphique des connexions hors horaires…",
  alt: "Connexions hors horaires de bureau",
  renderMeta: (result) => (
    <>
      <MetaItem label="Top utilisateurs" value={result.top.length} />
      {result.insiders_in_top.length > 0 && (
        <Badge variant="destructive">
          Insiders dans le top : {result.insiders_in_top.join(", ")}
        </Badge>
      )}
    </>
  ),
});

export const OutliersToolUI = makeChartToolUI<OutliersResult>({
  toolName: "outliers",
  runningLabel: "Détection des anomalies en cours…",
  alt: "Utilisateurs anormaux détectés",
  renderMeta: (result) => (
    <>
      <MetaItem label="Utilisateurs distincts" value={result.distinct_users} />
      <MetaItem
        label="Jours-utilisateur anormaux"
        value={result.anomalous_user_days}
      />
      {result.confirmed_insiders_flagged.length > 0 && (
        <Badge variant="destructive">
          Insiders confirmés : {result.confirmed_insiders_flagged.join(", ")}
        </Badge>
      )}
    </>
  ),
});
