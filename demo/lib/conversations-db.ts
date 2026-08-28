// Persistance des conversations (threads + messages) sur une base SQLite
// WRITABLE, distincte de la base d'audit read-only (`security-events.sqlite`).
// Cloisonnement par `profile_id` : un thread d'un profil n'est JAMAIS lisible
// par un autre profil (filtre systématique dans chaque requête). Contrat de
// stockage assistant-ui par message = 4 colonnes : id, parent_id, format, content.

import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PROFILE_ID } from "@/lib/profiles";

const DEFAULT_CONV_DB_PATH = "/data/conversations.sqlite";

// Scope profil d'une requête (RBAC simulé de démo, pas d'auth ni de 401).
export function getScope(req: Request): string {
  return req.headers.get("x-demo-profile") || DEFAULT_PROFILE_ID;
}

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) {
    const path = process.env.CONV_DB_PATH ?? DEFAULT_CONV_DB_PATH;
    const handle = new DatabaseSync(path);
    handle.exec("PRAGMA journal_mode=WAL");
    handle.exec("PRAGMA busy_timeout = 5000");
    handle.exec(`
      CREATE TABLE IF NOT EXISTS threads(
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'regular',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    handle.exec(`
      CREATE TABLE IF NOT EXISTS messages(
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        parent_id TEXT,
        format TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    handle.exec("CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)");
    handle.exec("CREATE INDEX IF NOT EXISTS idx_threads_profile ON threads(profile_id)");
    db = handle;
  }
  return db;
}

export interface ThreadRow {
  id: string;
  title: string | null;
  status: string;
}

export interface MessageRow {
  id: string;
  parent_id: string | null;
  format: string;
  content: unknown;
}

export interface MessageInput {
  id: string;
  parent_id: string | null;
  format: string;
  content: unknown;
}

// Liste les threads d'un profil, plus récents d'abord.
export function listThreads(profileId: string): ThreadRow[] {
  const stmt = getDb().prepare(
    "SELECT id, title, status FROM threads WHERE profile_id = ? ORDER BY updated_at DESC",
  );
  return stmt.all(profileId) as unknown as ThreadRow[];
}

// Crée un thread vide pour le profil ; retourne son id généré.
export function createThread(profileId: string): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      "INSERT INTO threads(id, profile_id, title, status, created_at, updated_at) VALUES(?, ?, NULL, 'regular', ?, ?)",
    )
    .run(id, profileId, now, now);
  return id;
}

// Récupère un thread scopé au profil (null si absent ou autre profil).
export function getThread(profileId: string, id: string): ThreadRow | null {
  const stmt = getDb().prepare(
    "SELECT id, title, status FROM threads WHERE id = ? AND profile_id = ?",
  );
  const row = stmt.get(id, profileId) as unknown as ThreadRow | undefined;
  return row ?? null;
}

// Met à jour titre et/ou statut (scopé profil). Retourne false si rien modifié.
export function patchThread(
  profileId: string,
  id: string,
  patch: { title?: string; status?: string },
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  sets.push("updated_at = ?");
  values.push(Date.now());
  values.push(id, profileId);
  const result = getDb()
    .prepare(`UPDATE threads SET ${sets.join(", ")} WHERE id = ? AND profile_id = ?`)
    .run(...(values as never[]));
  return result.changes > 0;
}

// Supprime un thread et ses messages (scopé profil). Retourne false si absent.
export function deleteThread(profileId: string, id: string): boolean {
  const database = getDb();
  const result = database
    .prepare("DELETE FROM threads WHERE id = ? AND profile_id = ?")
    .run(id, profileId);
  if (result.changes > 0) {
    database.prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
    return true;
  }
  return false;
}

// Liste les messages d'un thread après vérification d'appartenance au profil.
// Retourne null si le thread n'appartient pas au profil (ou n'existe pas).
export function listMessages(profileId: string, threadId: string): MessageRow[] | null {
  if (!getThread(profileId, threadId)) return null;
  const rows = getDb()
    .prepare(
      "SELECT id, parent_id, format, content FROM messages WHERE thread_id = ? ORDER BY created_at ASC",
    )
    .all(threadId) as unknown as {
    id: string;
    parent_id: string | null;
    format: string;
    content: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    parent_id: r.parent_id,
    format: r.format,
    content: JSON.parse(r.content),
  }));
}

// Ajoute un message à un thread (scopé profil). Retourne false si le thread
// n'appartient pas au profil. `content` est stocké en JSON (TEXT).
export function appendMessage(
  profileId: string,
  threadId: string,
  message: MessageInput,
): boolean {
  if (!getThread(profileId, threadId)) return false;
  const database = getDb();

  // Collapse des snapshots cumulatifs. assistant-ui persiste CHAQUE continuation
  // d'outil (sql_query passe par la gate client → auto-send) comme un NOUVEAU
  // message assistant, cumulatif (il contient tout le contenu des précédents),
  // chaîné au snapshot précédent. Sans collapse : 1 tour = 7-11 lignes qui se
  // recouvrent → au rechargement/replay le modèle revoit le même contenu ×N
  // (contexte qui explose, écran qui semble boucler). Règle : si le message
  // entrant est un ASSISTANT dont le parent est LUI AUSSI un message assistant
  // (donc un snapshot du même tour, que le nouveau superset), on supprime ce
  // parent et on re-pointe sur le grand-parent. Un vrai nouveau tour a pour
  // parent un message user → il n'est jamais supprimé.
  let parentId = message.parent_id;
  const role = (message.content as { role?: string } | null)?.role;
  if (role === "assistant" && parentId) {
    const parent = database
      .prepare("SELECT parent_id, content FROM messages WHERE id = ? AND thread_id = ?")
      .get(parentId, threadId) as { parent_id: string | null; content: string } | undefined;
    if (parent) {
      let parentRole: string | undefined;
      try {
        parentRole = (JSON.parse(parent.content) as { role?: string }).role;
      } catch {
        parentRole = undefined;
      }
      if (parentRole === "assistant") {
        database
          .prepare("DELETE FROM messages WHERE id = ? AND thread_id = ?")
          .run(parentId, threadId);
        parentId = parent.parent_id; // re-pointe sur le grand-parent (in fine, le message user)
      }
    }
  }

  database
    .prepare(
      "INSERT OR REPLACE INTO messages(id, thread_id, parent_id, format, content, created_at) VALUES(?, ?, ?, ?, ?, ?)",
    )
    .run(
      message.id,
      threadId,
      parentId,
      message.format,
      JSON.stringify(message.content),
      Date.now(),
    );
  // Un nouveau message rend le thread « plus récent ».
  database
    .prepare("UPDATE threads SET updated_at = ? WHERE id = ? AND profile_id = ?")
    .run(Date.now(), threadId, profileId);
  return true;
}
