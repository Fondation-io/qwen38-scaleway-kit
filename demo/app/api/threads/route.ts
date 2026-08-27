import { createThread, getScope, listThreads } from "@/lib/conversations-db";

export const runtime = "nodejs";

// Liste des threads du profil (tri updated_at desc via la couche DB).
export async function GET(req: Request) {
  try {
    const profileId = getScope(req);
    const rows = listThreads(profileId).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    }));
    return Response.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Crée un thread vide pour le profil courant.
export async function POST(req: Request) {
  try {
    const profileId = getScope(req);
    const id = createThread(profileId);
    return Response.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
