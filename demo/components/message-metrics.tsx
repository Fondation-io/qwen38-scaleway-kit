"use client";

// Pied de métriques tokens sous chaque message assistant terminé : tokens de
// réflexion, tokens de réponse, débit moyen. L'usage serveur (AI SDK
// messageMetadata) ne remonte pas jusqu'à la metadata client via le transport
// assistant-ui — on tokenise donc le texte côté client (`/api/tokenize`, qui
// tape le /tokenize de vLLM = le vrai tokenizer du modèle). Une seule passe par
// message (mémorisation par id + longueurs de texte).

import { useEffect, useRef, useState } from "react";
import { LockIcon } from "lucide-react";
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
      // Échoue vite si le tokenizer vLLM est indisponible (ex. L40S éteinte) :
      // les métriques token disparaissent alors, mais le reste du pied (dont la
      // signature TEE) doit continuer de s'afficher.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { count?: number };
    return data.count ?? 0;
  } catch {
    return 0;
  }
}

// Usage RÉEL du provider, émis par /api/chat en part `data-usage` (même canal que
// le TEE). C'est la SOURCE des stats token/prix : aucun re-tokenize → aucun
// couplage au tokenizer vLLM (marche pour NEAR/Baseten sans la L40S).
type Usage = {
  input: number | null;
  output: number | null;
  reasoning: number | null;
  costUsd: number | null;
};

function extractUsage(
  content: readonly { type: string }[],
): Usage | undefined {
  let found: Usage | undefined;
  for (const part of content) {
    const p = part as { type: string; name?: string; data?: unknown };
    const isUsage =
      (p.type === "data" && p.name === "usage") || p.type === "data-usage";
    if (isUsage && p.data && typeof p.data === "object") {
      found = p.data as Usage;
    }
  }
  return found;
}

function formatCost(usd: number): string {
  // Montants souvent minuscules (fraction de cent) : plus de décimales sous 1 cent.
  return `$${usd < 0.01 ? usd.toFixed(5) : usd.toFixed(4)}`;
}

// TEE : /api/chat émet une part `data-tee` (part de contenu `{type:"data",
// name:"tee", data:{chatId, modelId}}`) car la messageMetadata AI SDK n'atteint
// pas la metadata client via le transport assistant-ui.
function extractTee(
  content: readonly { type: string }[],
): { chatId: string; modelId: string } | undefined {
  // Une part data-tee est émise par requête /api/chat : on garde la DERNIÈRE
  // (le chatId de la génération finale, le plus récent). Forme assistant-ui
  // convertie ({type:"data", name:"tee"}) OU brute AI SDK ({type:"data-tee"}).
  let found: { chatId: string; modelId: string } | undefined;
  for (const part of content) {
    const p = part as { type: string; name?: string; data?: unknown };
    const isTee =
      (p.type === "data" && p.name === "tee") || p.type === "data-tee";
    if (isTee) {
      const d = p.data as { chatId?: unknown; modelId?: unknown } | undefined;
      if (typeof d?.chatId === "string" && typeof d?.modelId === "string") {
        found = { chatId: d.chatId, modelId: d.modelId };
      }
    }
  }
  return found;
}

interface Signature {
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
}

function short(s: string | undefined, n = 10): string {
  if (!s) return "";
  return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s;
}

export function MessageMetrics() {
  const message = useAuiState((s) => s.message);

  const complete =
    message.role === "assistant" && message.status?.type === "complete";

  const timing = message.role === "assistant" ? message.metadata.timing : undefined;
  const reasoningText = complete ? textOfType(message.content, "reasoning") : "";

  const usage =
    message.role === "assistant" ? extractUsage(message.content) : undefined;

  // Tokens de réflexion : de préférence l'usage API (reasoningTokens). Le vLLM ne
  // les sépare PAS (reasoning=0) → repli best-effort par tokenize du texte de
  // réflexion (vLLM = même box que le tokenizer). PUREMENT ADDITIF : son échec ne
  // masque jamais rien, il laisse seulement la ligne Réflexion absente.
  const apiReasoning = usage?.reasoning ?? 0;
  const [tokReasoning, setTokReasoning] = useState<number | null>(null);
  const tokRef = useRef<string | null>(null);

  // Signature d'attestation TEE (modèles confidentiels) : récupérée une fois par
  // message terminé, sous le pied de stats.
  const tee =
    message.role === "assistant" ? extractTee(message.content) : undefined;
  const [sig, setSig] = useState<Signature | "error" | null>(null);
  const sigRef = useRef<string | null>(null);

  // Dépendances = valeurs PRIMITIVES stables (pas l'objet `tee`, recréé à chaque
  // render, qui relancerait l'effet et annulerait le fetch en cours → pending).
  const teeChatId = tee?.chatId;
  const teeModelId = tee?.modelId;

  useEffect(() => {
    if (!complete || !teeChatId || !teeModelId) return;
    if (sigRef.current === teeChatId) return;
    sigRef.current = teeChatId;
    let cancelled = false;
    void fetch("/api/attestation/signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: teeChatId, modelId: teeModelId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Signature) => {
        if (!cancelled) setSig(d);
      })
      .catch(() => {
        if (!cancelled) setSig("error");
      });
    return () => {
      cancelled = true;
    };
  }, [complete, teeChatId, teeModelId]);

  useEffect(() => {
    if (!complete) return;
    // Repli tokenize UNIQUEMENT si l'API ne rapporte pas la réflexion (vLLM) et
    // qu'il y a du texte de réflexion. Sinon on ne touche à rien.
    if (apiReasoning > 0 || reasoningText === "") return;
    const key = `${message.id}:${reasoningText.length}`;
    if (tokRef.current === key) return;
    tokRef.current = key;
    let cancelled = false;
    void tokenize(reasoningText).then((n) => {
      if (!cancelled) setTokReasoning(n);
    });
    return () => {
      cancelled = true;
    };
  }, [complete, apiReasoning, reasoningText, message.id]);

  if (!complete) return null;

  // Débit : on prend la mesure interne d'assistant-ui (tokensPerSecond), seule
  // cohérente avec sa propre fenêtre de temps. Ne PAS diviser nos tokens
  // (réflexion cumulée sur tout le run) par timing.totalStreamTime : ça donne
  // des valeurs absurdes car les deux ne couvrent pas la même fenêtre.
  const perSecond = timing?.tokensPerSecond;

  // Stats depuis l'usage API (émis en part data-usage). Réponse = tokens de sortie
  // moins la réflexion (l'usage `output` inclut la réflexion pour les modèles qui
  // raisonnent). Aucune de ces lignes ne dépend du tokenizer vLLM.
  const reasoningTok = apiReasoning > 0 ? apiReasoning : (tokReasoning ?? 0);
  const outputTok = usage?.output ?? null;
  const answerTok =
    outputTok !== null ? Math.max(outputTok - reasoningTok, 0) : null;

  const segments: string[] = [];
  if (reasoningTok > 0) segments.push(`Réflexion ${reasoningTok} tok`);
  if (answerTok !== null) segments.push(`Réponse ${answerTok} tok`);
  if (perSecond !== undefined) segments.push(`${Math.round(perSecond)} tok/s`);
  if (usage?.costUsd != null) segments.push(formatCost(usage.costUsd));

  const teeReady = Boolean(tee && sig && sig !== "error" && sig.signature);
  const teeError = Boolean(tee && sig === "error");

  // Rien à montrer (ni métriques ni TEE) → pas de pied.
  if (segments.length === 0 && !teeReady && !teeError) return null;

  return (
    <div className="ms-2 mt-0.5 flex flex-col gap-0.5">
      {segments.length > 0 && (
        <div
          data-slot="aui_message-metrics"
          className="text-muted-foreground text-xs tabular-nums"
        >
          {segments.join(" · ")}
        </div>
      )}
      {teeReady && sig && sig !== "error" && (
        <div
          className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-500"
          title={`Signature TEE ${sig.signing_algo ?? ""}\nadresse ${sig.signing_address}\nsignature ${sig.signature}`}
        >
          <LockIcon className="size-3 shrink-0" />
          <span className="font-medium">Signature TEE</span>
          <span className="text-muted-foreground font-mono">
            {sig.signing_algo ?? "ecdsa"} · {short(sig.signing_address)} ·{" "}
            {short(sig.signature)}
          </span>
        </div>
      )}
      {tee && sig === "error" && (
        <div className="text-muted-foreground text-[11px]">
          Signature TEE indisponible (cache 5 min expiré).
        </div>
      )}
    </div>
  );
}
