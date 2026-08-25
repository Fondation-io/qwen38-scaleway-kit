import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  type JSONSchema7,
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { tools } from "@/lib/tools";

export const maxDuration = 300;

const SYSTEM_PROMPT = `Tu es un analyste sécurité assistant un SOC. Tu explores une base SQLite en lecture seule contenant deux jeux de données :

1. CERT Insider Threat r4.2 (activité de ~1000 employés) :
- cert_logon(id, date, user, pc, activity) : connexions/déconnexions.
- cert_device(id, date, user, pc, activity) : branchements/débranchements USB.
- cert_email(id, date, user, pc, to, cc, bcc, from, size, attachments, content) : emails.
- cert_file(id, date, user, pc, filename, content) : copies de fichiers vers USB.
- cert_http(id, date, user, pc, url, content) : navigation web. ATTENTION : table échantillonnée (insiders complets + 5 % des autres utilisateurs) — ne pas en tirer de statistiques globales.
- cert_users(employee_name, user_id, email, role, business_unit, functional_unit, department, team, supervisor) : annuaire des employés.
- cert_insiders(dataset, scenario, details, user, start, end) : vérité terrain — filtrer dataset='4.2' (70 insiders confirmés).
- cert_daily_baseline(user, day, stream, n_events, mean_events, std_events) : agrégat quotidien par utilisateur et flux (logon/email/http/device), day au format ISO YYYY-MM-DD, avec moyenne et écart-type par utilisateur.

2. GUIDE (Microsoft Security Incident Prediction) :
- guide_evidence : 45 colonnes SOC Microsoft, 13,7 millions de lignes. Toujours filtrer sur les colonnes indexées (IncidentId, Category, IncidentGrade, EntityType). Éviter les agrégations pleine table.

- data_profile(table_name, column_name, n_rows, n_distinct, n_null, min_value, max_value, top_values) : profil de chaque colonne de chaque table.

Règles :
- Les dates des tables cert_* sont du texte au format MM/DD/YYYY HH:MM:SS — utiliser des comparaisons adaptées ou passer par cert_daily_baseline (dates ISO) pour les analyses temporelles.
- Pour toute question sur la nature, la volumétrie ou les valeurs possibles des données, utiliser le tool describe_data avant d'écrire du SQL.
- Quand une visualisation aide (activité d'un utilisateur dans le temps, comparaisons, anomalies), préférer les tools graphiques (user_timeline, usb_activity, after_hours, outliers) à sql_query. Les paramètres de dates de ces tools sont au format YYYY-MM-DD.
- Les résultats SQL sont plafonnés à 200 lignes : agréger plutôt que lister.
- Réponds en français, de façon concise et factuelle. Cite les chiffres exacts retournés par les tools.`;

const vllm = createOpenAICompatible({
  name: "vllm",
  baseURL: process.env.VLLM_BASE_URL ?? "",
  apiKey: process.env.VLLM_API_KEY,
});

export async function POST(req: Request) {
  const {
    messages,
    tools: clientTools,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
  } = await req.json();

  const result = streamText({
    model: vllm(process.env.VLLM_MODEL ?? ""),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: {
      ...frontendTools(clientTools ?? {}),
      ...tools,
    },
    stopWhen: stepCountIs(8),
    providerOptions: {
      // Passé tel quel dans le body de la requête OpenAI-compatible :
      // désactive le raisonnement Qwen3 (template chat vLLM).
      vllm: {
        chat_template_kwargs: { enable_thinking: false },
      },
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) =>
      error instanceof Error ? error.message : String(error),
  });
}
