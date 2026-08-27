// Registre multi-provider des modèles. Données PURES (pas de secret, pas de
// process.env) — importable côté client (sélecteur) comme serveur (résolution).
// La résolution baseURL/clé API se fait côté serveur dans /api/chat à partir de
// `provider`/`baseUrlEnv`/`apiKeyEnv`.
//
// vLLM est traité comme un provider parmi d'autres (endpoint souverain auto-hébergé).
// `tee: true` = le endpoint exécute le modèle dans un Trusted Execution Environment
// (confidentialité matérielle + attestation vérifiable).

export interface ModelEntry {
  id: string; // clé interne (header x-demo-model)
  provider: string; // "vllm" | "near_ai" | "baseten" …
  providerLabel: string;
  label: string; // nom du modèle affiché
  model: string; // id du modèle CÔTÉ provider
  baseUrlEnv?: string; // var d'env pour la baseURL (sinon `baseUrl` littéral)
  baseUrl?: string;
  apiKeyEnv: string; // var d'env pour la clé
  tee: boolean;
  contextLabel: string; // ex. "64K", "262K"
  // Prix indicatif par million de tokens (USD). null = auto-hébergé (coût GPU).
  priceInPerM: number | null;
  priceOutPerM: number | null;
  attestation?: boolean; // le provider expose un rapport d'attestation TEE
  // Le modèle accepte le contrôle de réflexion à la Qwen (chat_template_kwargs
  // enable_thinking + reasoning_effort). Sinon on n'envoie pas ces params.
  qwenThinking?: boolean;
}

export const MODELS: ModelEntry[] = [
  {
    id: "vllm-l40s",
    provider: "vllm",
    providerLabel: "vLLM souverain",
    label: "Qwen 3.8-27B FP8",
    model: "Qwen/Qwen3.8-27B-FP8",
    baseUrlEnv: "VLLM_BASE_URL",
    apiKeyEnv: "VLLM_API_KEY",
    tee: false,
    contextLabel: "64K",
    priceInPerM: null,
    priceOutPerM: null,
    qwenThinking: true,
  },
  {
    id: "near-qwen",
    provider: "near_ai",
    providerLabel: "NEAR AI",
    label: "Qwen 3.8-27B",
    model: "Qwen/Qwen3.8-27B",
    baseUrl: "https://cloud-api.near.ai/v1",
    apiKeyEnv: "NEAR_AI_API_KEY",
    tee: true,
    contextLabel: "262K",
    priceInPerM: 0.44,
    priceOutPerM: 3.3,
    attestation: true,
    qwenThinking: true,
  },
  {
    id: "near-deepseek",
    provider: "near_ai",
    providerLabel: "NEAR AI",
    label: "DeepSeek V4 Flash",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    baseUrl: "https://cloud-api.near.ai/v1",
    apiKeyEnv: "NEAR_AI_API_KEY",
    tee: true,
    contextLabel: "1M",
    priceInPerM: 0.17,
    priceOutPerM: 0.35,
    attestation: true,
  },
  {
    id: "baseten-deepseek",
    provider: "baseten",
    providerLabel: "Baseten",
    label: "DeepSeek V4 Flash",
    model: "deepseek-ai/DeepSeek-V4-Flash-0731",
    baseUrl: "https://inference.baseten.co/v1",
    apiKeyEnv: "BASETEN_API_KEY",
    tee: false,
    contextLabel: "1M",
    priceInPerM: 0.13,
    priceOutPerM: 0.26,
  },
  {
    id: "baseten-glm",
    provider: "baseten",
    providerLabel: "Baseten",
    label: "GLM 5.3 Flash",
    model: "zai-org/GLM-5.3-Flash",
    baseUrl: "https://inference.baseten.co/v1",
    apiKeyEnv: "BASETEN_API_KEY",
    tee: false,
    contextLabel: "1M",
    priceInPerM: 0.15,
    priceOutPerM: 0.5,
  },
];

export const DEFAULT_MODEL_ID = "vllm-l40s";

export function getModel(id: string | null | undefined): ModelEntry {
  return (
    MODELS.find((m) => m.id === id) ??
    MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!
  );
}
