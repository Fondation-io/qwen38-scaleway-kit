"use client";

// Jauge de contexte dans le prompt input : approximation du nombre de tokens qui
// seront envoyés au modèle (historique du fil + résultats d'outils + prompt
// système), en valeur absolue et en % de la fenêtre du modèle sélectionné.
//
// Estimation VOLONTAIREMENT approximative (chars/4) — pas d'appel au tokenizer
// (on évite tout couplage réseau). Le but est de VOIR la dérive : une enquête qui
// enchaîne 50 requêtes SQL fait exploser le contexte et finit par dépasser la
// limite (surtout le modèle souverain 64K), ce qui casse le dialogue.

import { useAuiState } from "@assistant-ui/react";
import { useModel } from "@/app/runtime/model-context";

// Prompt système + bloc profil + date + web : ordre de grandeur constant.
const SYSTEM_BASELINE_TOKENS = 2500;
const CHARS_PER_TOKEN = 4;

function estimateTokens(messages: readonly unknown[]): number {
  let chars = 0;
  for (const m of messages) {
    const content = (m as { content?: unknown }).content ?? m;
    chars += JSON.stringify(content)?.length ?? 0;
  }
  return Math.round(chars / CHARS_PER_TOKEN) + SYSTEM_BASELINE_TOKENS;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

export function ContextMeter() {
  const messages = useAuiState((s) => s.thread.messages);
  const { model } = useModel();

  const tokens = estimateTokens(messages ?? []);
  const pct = Math.round((tokens / model.contextTokens) * 100);

  // Palette : discret sous 70 %, ambre 70-89 %, rouge ≥ 90 % (proche de la coupe).
  const tone =
    pct >= 90
      ? "text-red-600 dark:text-red-500"
      : pct >= 70
        ? "text-amber-600 dark:text-amber-500"
        : "text-muted-foreground";

  return (
    <span
      className={`text-xs tabular-nums ${tone}`}
      title={`Contexte estimé ≈ ${tokens.toLocaleString("fr-FR")} tokens sur ${model.contextTokens.toLocaleString("fr-FR")} (${model.label}). Approximation (chars/4).`}
    >
      ≈ {fmt(tokens)} / {model.contextLabel} · {pct}%
    </span>
  );
}
