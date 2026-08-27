import { getModel } from "@/lib/models";

export const runtime = "nodejs";

// Récupère la signature d'attestation TEE d'une complétion (preuve cryptographique
// que la réponse a été produite dans l'enclave attestée). Proxy vers le provider
// TEE (NEAR AI : GET /v1/signature/{chatId}?model=&signing_algo=ecdsa), clé côté
// serveur. Réponse : { text, signature, signing_address, signing_algo, signature_kind }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    chatId?: string;
    modelId?: string; // id interne du registre (ex. "near-qwen")
    algo?: string;
  };
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const entry = getModel(body.modelId);
  const algo = body.algo === "ed25519" ? "ed25519" : "ecdsa";

  if (!chatId || !entry.tee || entry.provider !== "near_ai") {
    return Response.json({ error: "signature indisponible" }, { status: 400 });
  }
  const baseURL = (entry.baseUrl ?? "").replace(/\/$/, "");
  const apiKey = process.env[entry.apiKeyEnv];
  try {
    const res = await fetch(
      `${baseURL}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(entry.model)}&signing_algo=${algo}`,
      { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || (data as { error?: unknown }).error) {
      return Response.json(
        { error: "signature introuvable (cache 5 min expiré ?)" },
        { status: 404 },
      );
    }
    return Response.json({
      text: data.text,
      signature: data.signature,
      signing_address: data.signing_address,
      signing_algo: data.signing_algo,
      signature_kind: data.signature_kind,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
