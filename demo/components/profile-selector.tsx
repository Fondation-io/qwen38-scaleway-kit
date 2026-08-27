"use client";

// Sélecteur de profil de démo (D7). Ouvre un dialogue listant les 4 profils
// (label, rôle, badge d'autorité IBM i, description) et met en évidence le
// profil actif. La sélection délègue à `useProfile().setProfile` ; le remontage
// du runtime (donc le rechargement de la liste de threads cloisonnée) est géré
// par la `key` du sous-arbre dans `assistant.tsx`.

import { useState } from "react";
import { CheckIcon, ShieldIcon } from "lucide-react";
import { PROFILES } from "@/lib/profiles";
import { useProfile } from "@/app/runtime/profile-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function AuthorityBadge({ authorities }: { authorities: string }) {
  const none = authorities === "—";
  return (
    <span
      className={
        none
          ? "text-muted-foreground bg-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]"
          : "inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-500"
      }
    >
      <ShieldIcon className="size-3" />
      {authorities}
    </span>
  );
}

export function ProfileSelector() {
  const { profile, setProfile } = useProfile();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-foreground hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors"
            title="Changer de profil"
          />
        }
      >
        <ShieldIcon className="text-muted-foreground size-4" />
        <span className="font-medium">{profile.label}</span>
        <AuthorityBadge authorities={profile.ibmiAuthorities} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profil actif</DialogTitle>
          <DialogDescription>
            Le même agent répond différemment selon le profil : cloisonnement
            des conversations, gating SQL et prompt système.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {PROFILES.map((p) => {
            const active = p.id === profile.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProfile(p.id);
                  setOpen(false);
                }}
                className={
                  active
                    ? "border-primary bg-primary/5 flex flex-col gap-1 rounded-lg border p-3 text-start"
                    : "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors"
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  <AuthorityBadge authorities={p.ibmiAuthorities} />
                  {active && (
                    <CheckIcon className="text-primary ml-auto size-4 shrink-0" />
                  )}
                </div>
                <span className="text-muted-foreground text-xs font-medium">
                  {p.role}
                </span>
                <span className="text-muted-foreground text-xs">
                  {p.description}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
