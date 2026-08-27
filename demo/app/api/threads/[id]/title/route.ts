import { getScope, patchThread } from "@/lib/conversations-db";

export const runtime = "nodejs";

const TITLE_SYSTEM =
  "Génère un titre court (max 6 mots), en français, sans guillemets, pour cette conversation d'analyse de sécurité";

// Extrait le texte concaténé du 1er message utilisateur d'un tableau de
// ThreadMessage assistant-ui (content = tableau de parts, parts texte { type:'text', text }).
function firstUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const msg = messages.find(
    (m) => m && typeof m === "object" && (m as { role?: string }).role === "user",
  ) as { content?: unknown } | undefined;
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (p) =>
        p && typeof p === "object" && (p as { type?: string }).type === "text",
    )
    .map((p) => (p as { text?: string }).text ?? "")
    .join(" ")
    .trim();
}

// Nettoyage : retire guillemets englobants et point final, tronque ~60 car.
function cleanTitle(raw: string): string {
  let t = raw.trim().replace(/^["'«»\s]+|["'«»\s]+$/g, "");
  t = t.replace(/\.\s*$/, "");
  if (t.length > 60) t = t.slice(0, 60).trim();
  return t;
}

// Repli hors-ligne : 6 premiers mots du message utilisateur.
function fallbackTitle(userText: string): string {
  return cleanTitle(userText.split(/\s+/).filter(Boolean).slice(0, 6).join(" "));
}

// Génère un titre court via vLLM (non-stream). Persiste et renvoie { title }.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const profileId = getScope(req);
    const body = (await req.json().catch(() => ({}))) as { messages?: unknown };
    const userText = firstUserText(body.messages);

    let title = fallbackTitle(userText);
    try {
      const res = await fetch(
        `${process.env.VLLM_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.VLLM_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.VLLM_MODEL,
            messages: [
              { role: "system", content: TITLE_SYSTEM },
              { role: "user", content: userText },
            ],
            max_tokens: 24,
            temperature: 0.3,
            chat_template_kwargs: { enable_thinking: false },
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const generated = data.choices?.[0]?.message?.content;
        if (generated && generated.trim()) title = cleanTitle(generated);
      }
    } catch {
      // Échec réseau vLLM : on garde le titre de repli.
    }

    patchThread(profileId, id, { title });
    return Response.json({ title });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
