"use client";

// Pied de métriques tokens sous chaque message assistant terminé : tokens de
// réflexion, tokens de réponse, débit moyen. L'usage serveur (AI SDK
// messageMetadata) ne remonte pas jusqu'à la metadata client via le transport
// assistant-ui — on tokenise donc le texte côté client (`/api/tokenize`, qui
// tape le /tokenize de vLLM = le vrai tokenizer du modèle). Une seule passe par
// message (mémorisation par id + longueurs de texte).

import { useEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";

// Concatène le texte des parts d'un type donné du message assistant courant.
function textOfType(
  content: readonly { type: string }[],
  type: "reasoning" | "text",
): string {
  return content
    .filter(
      (part): part is { type: string; text: string } =>
        part.type === type && typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("");
}

async function tokenize(text: string): Promise<number> {
  if (text === "") return 0;
  try {
    const res = await fetch("/api/tokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { count?: number };
    return data.count ?? 0;
  } catch {
    return 0;
  }
}

type Counts = { reasoning: number; answer: number };

export function MessageMetrics() {
  const message = useAuiState((s) => s.message);

  const complete =
    message.role === "assistant" && message.status?.type === "complete";

  const timing = message.role === "assistant" ? message.metadata.timing : undefined;
  const reasoningText = complete ? textOfType(message.content, "reasoning") : "";
  const answerText = complete ? textOfType(message.content, "text") : "";

  const [counts, setCounts] = useState<Counts | null>(null);
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!complete) return;

    // Clé de mémorisation stable une fois le message terminé.
    const key = `${message.id}:${reasoningText.length}:${answerText.length}`;
    if (fetchedForRef.current === key) return;
    fetchedForRef.current = key;

    let cancelled = false;
    void Promise.all([tokenize(reasoningText), tokenize(answerText)]).then(
      ([reasoning, answer]) => {
        if (!cancelled) setCounts({ reasoning, answer });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [complete, message.id, reasoningText, answerText]);

  if (!complete || counts === null) return null;

  const total = counts.reasoning + counts.answer;
  if (total === 0) return null;

  // Débit : tokens totaux générés / durée de stream. Repli sur l'estimation
  // client de timing si la durée n'est pas disponible.
  const perSecond =
    timing?.totalStreamTime && timing.totalStreamTime > 0
      ? total / (timing.totalStreamTime / 1000)
      : timing?.tokensPerSecond;

  const segments: string[] = [];
  if (counts.reasoning > 0) segments.push(`Réflexion ${counts.reasoning} tok`);
  segments.push(`Réponse ${counts.answer} tok`);
  if (perSecond !== undefined) segments.push(`${Math.round(perSecond)} tok/s`);

  return (
    <div
      data-slot="aui_message-metrics"
      className="text-muted-foreground ms-2 mt-0.5 text-xs tabular-nums"
    >
      {segments.join(" · ")}
    </div>
  );
}
