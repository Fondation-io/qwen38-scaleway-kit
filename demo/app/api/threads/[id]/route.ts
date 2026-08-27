import {
  deleteThread,
  getScope,
  getThread,
  patchThread,
} from "@/lib/conversations-db";

export const runtime = "nodejs";

// Métadonnées d'un thread scopé profil (404 si absent ou autre profil).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const profileId = getScope(req);
    const thread = getThread(profileId, id);
    if (!thread) return new Response(null, { status: 404 });
    return Response.json({
      id: thread.id,
      title: thread.title,
      status: thread.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Renommage / archivage (scopé profil) → 204.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const profileId = getScope(req);
    const patch = (await req.json().catch(() => ({}))) as {
      title?: string;
      status?: string;
    };
    patchThread(profileId, id, patch);
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Suppression (scopé profil) → 204.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const profileId = getScope(req);
    deleteThread(profileId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
