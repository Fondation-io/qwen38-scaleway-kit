"use client";

// Persistance auto-hébergée des threads/messages via `RemoteThreadListAdapter`
// (métadonnées) + `ThreadHistoryAdapter` (messages d'un thread, monté dans
// `unstable_Provider`). Calqué sur le pattern officiel `custom-persistence`,
// mais le cloisonnement passe par le header `x-demo-profile` (D6) au lieu d'une
// session authentifiée. Chaque fetch lit le profil de manière SYNCHRONE.

import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { useMemo } from "react";
import { getActiveProfileId } from "./profile-context";

// En-tête commun : profil actif + content-type pour les corps JSON.
function jsonHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-demo-profile": getActiveProfileId(),
  };
}

// Header léger (lectures GET) sans content-type.
function profileHeader(): Record<string, string> {
  return { "x-demo-profile": getActiveProfileId() };
}

interface ThreadRow {
  id: string;
  title: string | null;
  status: "regular" | "archived";
}

interface MessageRow {
  id: string;
  parent_id: string | null;
  format: string;
  // Charge utile encodée par le format actif ; opaque côté adapter.
  content: unknown;
}

export const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const rows = (await fetch("/api/threads", {
      headers: profileHeader(),
    }).then((r) => r.json())) as ThreadRow[];
    return {
      threads: rows.map((t) => ({
        status: t.status,
        remoteId: t.id,
        title: t.title ?? undefined,
      })),
    };
  },
  async initialize() {
    const { id } = (await fetch("/api/threads", {
      method: "POST",
      headers: jsonHeaders(),
    }).then((r) => r.json())) as { id: string };
    return { remoteId: id };
  },
  async rename(remoteId, title) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title }),
    });
  },
  async archive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ status: "archived" }),
    });
  },
  async unarchive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ status: "regular" }),
    });
  },
  async delete(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "DELETE",
      headers: profileHeader(),
    });
  },
  async fetch(remoteId) {
    const t = (await fetch(`/api/threads/${remoteId}`, {
      headers: profileHeader(),
    }).then((r) => r.json())) as ThreadRow;
    return { status: t.status, remoteId: t.id, title: t.title ?? undefined };
  },
  async generateTitle(remoteId, messages) {
    // Renommage auto (D8) : le titre est généré côté serveur puis streamé.
    return createAssistantStream(async (controller) => {
      const { title } = (await fetch(`/api/threads/${remoteId}/title`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ messages }),
      }).then((r) => r.json())) as { title: string };
      controller.appendText(title);
    });
  },
  unstable_Provider({ children }) {
    const aui = useAui();
    const history = useMemo<ThreadHistoryAdapter>(
      () => ({
        async load() {
          return { messages: [] };
        },
        async append() {},
        withFormat: (fmt) => ({
          async load() {
            const { remoteId } = aui.threadListItem.getState();
            if (!remoteId) return { messages: [] };
            const rows = (await fetch(`/api/threads/${remoteId}/messages`, {
              headers: profileHeader(),
            }).then((r) => r.json())) as MessageRow[];
            return {
              messages: rows.map((row) =>
                fmt.decode({
                  id: row.id,
                  parent_id: row.parent_id,
                  format: row.format,
                  // `content` est opaque ici : le format actif sait le décoder.
                  content: row.content as never,
                }),
              ),
            };
          },
          async append(item) {
            // Garantit l'existence de la ligne thread avant le 1er message.
            const { remoteId } = await aui.threadListItem.initialize();
            await fetch(`/api/threads/${remoteId}/messages`, {
              method: "POST",
              headers: jsonHeaders(),
              body: JSON.stringify({
                id: fmt.getId(item.message),
                parent_id: item.parentId,
                format: fmt.format,
                content: fmt.encode(item),
              }),
            });
          },
        }),
      }),
      [aui],
    );
    return (
      <RuntimeAdapterProvider adapters={{ history }}>
        {children}
      </RuntimeAdapterProvider>
    );
  },
};
