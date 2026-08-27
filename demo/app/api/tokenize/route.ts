// Compte les tokens d'un texte via l'endpoint vLLM `/tokenize`. Sert au calcul
// des tokens de réflexion par message (le `usage` OpenAI ne les sépare pas).
// Toute défaillance retombe sur `{ count: 0 }` : les métriques dégradent sans
// jamais bloquer l'UI.

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const { text }: { text?: string } = await req.json().catch(() => ({}));

  if (!text) {
    return Response.json({ count: 0 });
  }

  // Le serveur vLLM expose `/tokenize` à la racine, pas sous `/v1`.
  const base = (process.env.VLLM_BASE_URL ?? "").replace(/\/v1$/, "");

  try {
    const res = await fetch(`${base}/tokenize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.VLLM_API_KEY ?? ""}`,
      },
      body: JSON.stringify({ model: process.env.VLLM_MODEL, prompt: text }),
    });

    if (!res.ok) {
      return Response.json({ count: 0 });
    }

    const data: { count?: number } = await res.json();
    return Response.json({ count: data.count ?? 0 });
  } catch {
    return Response.json({ count: 0 });
  }
}
