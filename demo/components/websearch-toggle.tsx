"use client";

// Bouton d'autorisation de la recherche web EXTERNE, dans le prompt input (à côté
// du sélecteur de réflexion). Un simple interrupteur : coupé par défaut, l'analyste
// doit l'activer pour que le modèle puisse appeler web_search/ask_perplexity/
// fetch_url (le header `x-demo-websearch` suit sans remonter le runtime).

import { GlobeIcon } from "lucide-react";
import { useWebSearch } from "@/app/runtime/websearch-context";

export function WebSearchToggle() {
  const { enabled, setEnabled } = useWebSearch();

  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      aria-pressed={enabled}
      title={
        enabled
          ? "Recherche web externe autorisée — cliquer pour couper"
          : "Recherche web externe coupée — cliquer pour autoriser"
      }
      className={
        enabled
          ? "border-primary bg-primary/10 text-primary flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors"
          : "text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors"
      }
    >
      <GlobeIcon className="size-4" />
      <span>{enabled ? "Recherche web autorisée" : "Recherche web coupée"}</span>
    </button>
  );
}
