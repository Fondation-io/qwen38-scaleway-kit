"use client";

// Autorisation de la recherche web EXTERNE, propagée par le header
// `x-demo-websearch` (on/off). Calqué sur `reasoning-context` : singleton lisible
// sans React (le header du transport le lit de manière SYNCHRONE à chaque requête)
// + contexte UI pour le bouton. Défaut = COUPÉ : l'analyste doit autoriser
// explicitement l'envoi de requêtes hors du périmètre.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "demo.websearch";
const DEFAULT_ENABLED = false;

// Valeur courante lisible sans React. Hydratée depuis localStorage au 1er accès
// côté navigateur (le SSR retombe sur le défaut).
let enabled = DEFAULT_ENABLED;
let hydrated = false;

export function getWebSearchEnabled(): boolean {
  if (!hydrated && typeof window !== "undefined") {
    enabled = window.localStorage.getItem(STORAGE_KEY) === "on";
    hydrated = true;
  }
  return enabled;
}

export function setWebSearchEnabled(next: boolean): void {
  enabled = next;
  hydrated = true;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  }
}

interface WebSearchContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const WebSearchContext = createContext<WebSearchContextValue | null>(null);

export function WebSearchProvider({ children }: { children: ReactNode }) {
  // Départ sur le défaut pour un rendu serveur/client identique, puis
  // hydratation depuis localStorage au montage.
  const [current, setCurrent] = useState<boolean>(DEFAULT_ENABLED);

  useEffect(() => {
    const stored = getWebSearchEnabled();
    setCurrent((prev) => (prev === stored ? prev : stored));
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setWebSearchEnabled(next);
    setCurrent(next);
  }, []);

  return (
    <WebSearchContext.Provider value={{ enabled: current, setEnabled }}>
      {children}
    </WebSearchContext.Provider>
  );
}

export function useWebSearch(): WebSearchContextValue {
  const ctx = useContext(WebSearchContext);
  if (!ctx) {
    throw new Error("useWebSearch doit être utilisé dans un <WebSearchProvider>.");
  }
  return ctx;
}
