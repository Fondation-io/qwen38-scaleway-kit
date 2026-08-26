import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  type JSONSchema7,
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { makeTools } from "@/lib/tools";
import { audit, newTraceId } from "@/lib/audit";

export const maxDuration = 300;
export const runtime = "nodejs";

const SYSTEM_PROMPT = `Tu es un analyste sécurité IBM i (AS/400) assistant un SOC. Tu explores une base SQLite en lecture seule qui expose une activité d'audit dans le vocabulaire du journal QAUDJRN. Les données sous-jacentes viennent du jeu CERT Insider Threat r4.2 (~1000 profils utilisateur), retranscrites en événements IBM i.

VUES IBM i (à utiliser en priorité) :
- v_qaudjrn_signon(id, timestamp, user_profile, system, entry_type='JS', action) : signons interactifs 5250 / démarrages de job (Logon/Logoff).
- v_qaudjrn_transfer(id, timestamp, user_profile, system, job_name='QZDASOINIT', entry_type='SO', channel='ACS/FTP', action) : ouverture/fermeture de session de transfert réseau (Data Transfer ACS, FTP). C'est le canal d'exfiltration principal sur IBM i.
- v_qaudjrn_object(id, timestamp, user_profile, system, entry_type='ZR', object_name, object_preview) : objet Db2/IFS transféré hors du système via une session.
- v_qaudjrn_mail(id, timestamp, user_profile, system, entry_type='ML', recipients, sender, size, attachments, content) : distribution SMTP sortante.
- v_qaudjrn_profile_swap(timestamp, entry_type='PS', from_profile, to_profile, action) : usurpation de profil (set_profile_handle QWTSETP) — un profil qui prend l'identité d'un autre.
- v_profiles(user_profile, employee_name, email, role, business_unit, functional_unit, department, team, supervisor, special_authorities) : annuaire des profils. special_authorities liste les autorités spéciales (*ALLOBJ, *SECADM…) — un profil *ALLOBJ contourne toute autorité objet.
- v_daily_baseline(user_profile, day, stream, n_events, mean_events, std_events) : agrégat quotidien par profil et flux (stream ∈ signon, transfer_session, mail, object_transfer), day ISO YYYY-MM-DD, avec moyenne et écart-type PROPRES au profil.
- cert_insiders(dataset, scenario, user, start, end) : vérité terrain — filtrer dataset='4.2' (70 insiders confirmés, scénarios 1/2/3).

Autre jeu (incidents SOC génériques) :
- guide_evidence : 45 colonnes Microsoft, 13,7 M lignes. Toujours filtrer sur les colonnes indexées (IncidentId, Category, IncidentGrade, EntityType). Éviter les agrégations pleine table.
- data_profile(table_name, column_name, n_rows, n_distinct, n_null, min_value, max_value, top_values) : profil de chaque colonne.

Contexte sécurité IBM i à appliquer :
- POINT AVEUGLE MAJEUR : sur IBM i, la LECTURE d'un objet (un download, un SELECT) n'est journalisée en 'ZR' que si l'audit objet est activé sur cet objet — ce qui est rarement le cas. L'exfiltration principale est donc souvent INVISIBLE. Détecte-la via les signaux périphériques : sessions de transfert (v_qaudjrn_transfer), volumes anormaux vs la baseline du profil, horaires, autorités spéciales, usurpation de profil.
- Un profil qui monte en volume de sessions de transfert au-delà de sa propre normale, ouvre des sessions hors horaires, porte *ALLOBJ, ou usurpe un autre profil (PS) est suspect.

Règles :
- Les timestamps des vues v_qaudjrn_* sont du texte au format MM/DD/YYYY HH:MM:SS — pour les analyses temporelles, préférer v_daily_baseline (dates ISO).
- Pour toute question sur la nature/volumétrie des données, utiliser describe_data avant d'écrire du SQL.
- Quand une visualisation aide, préférer les tools graphiques (user_timeline, transfer_sessions, after_hours, outliers) à sql_query. Dates de ces tools au format YYYY-MM-DD.
- Les résultats SQL sont plafonnés à 200 lignes : agréger plutôt que lister.
- Réponds en français, de façon concise et factuelle, dans le vocabulaire IBM i (profil, session de transfert, objet, autorité spéciale). Cite les chiffres exacts retournés par les tools.`;

const vllm = createOpenAICompatible({
  name: "vllm",
  baseURL: process.env.VLLM_BASE_URL ?? "",
  apiKey: process.env.VLLM_API_KEY,
});

export async function POST(req: Request) {
  const traceId = newTraceId();
  try {
    const {
      messages,
      tools: clientTools,
    }: {
      messages: UIMessage[];
      system?: string;
      tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    } = await req.json();

    await audit(traceId, "request", {
      model: process.env.VLLM_MODEL,
      messageCount: Array.isArray(messages) ? messages.length : 0,
    });

    const result = streamText({
      model: vllm(process.env.VLLM_MODEL ?? ""),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: {
        ...frontendTools(clientTools ?? {}),
        ...makeTools({ traceId }),
      },
      stopWhen: stepCountIs(8),
      onError: ({ error }) => {
        void audit(traceId, "stream_error", {
          phase: "generation",
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      },
      providerOptions: {
        // Passé tel quel dans le body de la requête OpenAI-compatible :
        // désactive le raisonnement Qwen3 (template chat vLLM).
        vllm: {
          chat_template_kwargs: { enable_thinking: false },
        },
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        void audit(traceId, "stream_error", { phase: "stream", error: message });
        return message;
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit(traceId, "stream_error", {
      phase: "request",
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
