"use client";

import { Component, type ReactNode } from "react";

interface Props {
  toolName: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

// Isole le rendu d'une carte de tool : si un composant plante sur une
// donnée inattendue, seule la carte affiche l'erreur — la conversation et
// le reste de la page survivent. L'incident est rapporté au journal.
export class ToolErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `[tool-ui:${this.props.toolName}] ${message}`,
        stack,
        url: typeof location !== "undefined" ? location.href : undefined,
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.message !== null) {
      return (
        <div className="border-destructive/50 text-destructive my-2 rounded-lg border p-3 text-xs">
          Affichage du résultat impossible ({this.props.toolName}).
        </div>
      );
    }
    return this.props.children;
  }
}
