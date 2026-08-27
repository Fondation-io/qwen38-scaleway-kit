"use client";

// Sélecteur du niveau de réflexion. Même présentation que `profile-selector` :
// un dialogue listant les crans, cran actif mis en évidence. La sélection écrit
// le singleton (`useReasoning().setMode`) sans remonter le runtime.

import { useState } from "react";
import { BrainIcon, CheckIcon } from "lucide-react";
import { useReasoning, type ReasoningMode } from "@/app/runtime/reasoning-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MODES: readonly {
  id: ReasoningMode;
  label: string;
  description: string;
}[] = [
  {
    id: "off",
    label: "Sans réflexion",
    description: "Réponse directe, sans chaîne de raisonnement.",
  },
  {
    id: "low",
    label: "Réflexion rapide",
    description: "Raisonnement court avant de répondre.",
  },
  {
    id: "medium",
    label: "Réflexion standard",
    description: "Équilibre entre profondeur et latence.",
  },
  {
    id: "high",
    label: "Réflexion approfondie",
    description: "Raisonnement étendu pour les cas complexes.",
  },
];

export function ReasoningSelector() {
  const { mode, setMode } = useReasoning();
  const [open, setOpen] = useState(false);
  const active = MODES.find((m) => m.id === mode) ?? MODES[2];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-foreground hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors"
            title="Niveau de réflexion"
          />
        }
      >
        <BrainIcon className="text-muted-foreground size-4" />
        <span className="font-medium">{active.label}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Niveau de réflexion</DialogTitle>
          <DialogDescription>
            Contrôle la profondeur du raisonnement du modèle avant sa réponse.
            Plus de réflexion améliore les cas complexes au prix de la latence.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {MODES.map((m) => {
            const isActive = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  setOpen(false);
                }}
                className={
                  isActive
                    ? "border-primary bg-primary/5 flex flex-col gap-1 rounded-lg border p-3 text-start"
                    : "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors"
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.label}</span>
                  {isActive && (
                    <CheckIcon className="text-primary ml-auto size-4 shrink-0" />
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {m.description}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
