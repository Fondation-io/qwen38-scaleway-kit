import { appendMessage, getScope, listMessages } from "@/lib/conversations-db";

export const runtime = "nodejs";

// Messages d'un thread (content désérialisé). 404 si thread hors profil.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const profileId = getScope(req);
    const rows = listMessages(profileId, id);
    if (rows === null) return new Response(null, { status: 404 });
    return Response.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Ajout d'un message au contrat assistant-ui { id, parent_id, format, content }.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const profileId = getScope(req);
    const body = (await req.json()) as {
      id: string;
      parent_id: string | null;
      format: string;
      content: unknown;
    };
    const ok = appendMessage(profileId, id, {
      id: body.id,
      parent_id: body.parent_id ?? null,
      format: body.format,
      content: body.content,
    });
    if (!ok) return new Response(null, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
