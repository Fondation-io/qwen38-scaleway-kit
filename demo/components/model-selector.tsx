"use client";

// Commutateur de modèle multi-provider. Affiche provider (logo) + modèle, une
// pastille TEE quand le endpoint l'expose, le contexte et le prix. Sélection →
// useModel().setModel ; le runtime est remonté via la `key` dans assistant.tsx,
// donc le header x-demo-model change pour les messages suivants.

import { useState } from "react";
import { CheckIcon, LockIcon } from "lucide-react";
import { MODELS, type ModelEntry } from "@/lib/models";
import { useModel } from "@/app/runtime/model-context";
import { ProviderLogo } from "@/components/provider-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function TeeBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-500"
      title="Trusted Execution Environment — exécution confidentielle avec attestation"
    >
      <LockIcon className="size-3" />
      TEE
    </span>
  );
}

function priceLabel(m: ModelEntry): string {
  if (m.priceInPerM == null || m.priceOutPerM == null) return "auto-hébergé";
  return `$${m.priceInPerM} / $${m.priceOutPerM} par Mtok`;
}

export function ModelSelector() {
  const { model, setModel } = useModel();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-foreground hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors"
            title="Changer de modèle / provider"
          />
        }
      >
        <ProviderLogo provider={model.provider} label={model.providerLabel} />
        <span className="font-medium">{model.label}</span>
        {model.tee && <TeeBadge />}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modèle & provider</DialogTitle>
          <DialogDescription>
            Le chat est indépendant du GPU : bascule entre providers
            OpenAI-compatibles. La pastille TEE indique une exécution confidentielle
            attestée.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {MODELS.map((m) => {
            const active = m.id === model.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setModel(m.id);
                  setOpen(false);
                }}
                className={
                  active
                    ? "border-primary bg-primary/5 flex flex-col gap-1 rounded-lg border p-3 text-start"
                    : "hover:bg-muted flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors"
                }
              >
                <div className="flex items-center gap-2">
                  <ProviderLogo provider={m.provider} label={m.providerLabel} />
                  <span className="text-sm font-medium">{m.label}</span>
                  {m.tee && <TeeBadge />}
                  {active && (
                    <CheckIcon className="text-primary ml-auto size-4 shrink-0" />
                  )}
                </div>
                <span className="text-muted-foreground text-xs font-medium">
                  {m.providerLabel}
                </span>
                <span className="text-muted-foreground text-xs">
                  Contexte {m.contextLabel} · {priceLabel(m)}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
