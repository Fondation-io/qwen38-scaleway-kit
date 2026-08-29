"use client";

// Sélecteur de workspace : deux environnements étanches (enquête sécurité /
// gestion commerciale). Le changement force le profil sur le défaut du
// workspace cible ; le remontage du runtime est géré par la `key` dans
// assistant.tsx (les threads et profils basculent avec).

import { ShieldIcon, Building2Icon } from "lucide-react";
import type { Workspace } from "@/lib/profiles";
import { defaultProfileId } from "@/lib/profiles";
import { useWorkspace } from "@/app/runtime/workspace-context";
import { useProfile } from "@/app/runtime/profile-context";

const OPTIONS: {
  id: Workspace;
  label: string;
  icon: typeof ShieldIcon;
}[] = [
  { id: "security", label: "Sécurité", icon: ShieldIcon },
  { id: "gestion", label: "Gestion", icon: Building2Icon },
];

export function WorkspaceSelector() {
  const { workspace, setWorkspace } = useWorkspace();
  const { setProfile } = useProfile();

  const select = (ws: Workspace) => {
    if (ws === workspace) return;
    setWorkspace(ws);
    setProfile(defaultProfileId(ws));
  };

  return (
    <div className="bg-muted flex items-center gap-0.5 rounded-md p-0.5">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => select(id)}
          title={`Workspace ${label}`}
          className={
            id === workspace
              ? "bg-background text-foreground flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors"
          }
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
