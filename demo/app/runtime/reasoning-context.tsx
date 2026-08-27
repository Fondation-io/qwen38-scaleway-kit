"use client";

// Niveau de réflexion de la démo, propagé par le header `x-demo-thinking`.
// Calqué sur `profile-context` (singleton lisible sans React + contexte UI),
// À UNE DIFFÉRENCE PRÈS : le changement de niveau ne remonte PAS le runtime.
// Le header du transport lit `getReasoningMode()` de manière SYNCHRONE à chaque
// requête ; il suffit donc d'avoir écrit le singleton avant l'envoi suivant.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ReasoningMode = "off" | "low" | "medium" | "high";

const STORAGE_KEY = "demo.reasoning";
const DEFAULT_MODE: ReasoningMode = "medium";
const MODES: readonly ReasoningMode[] = ["off", "low", "medium", "high"];

function normalize(value: string | null): ReasoningMode {
  return MODES.includes(value as ReasoningMode)
    ? (value as ReasoningMode)
    : DEFAULT_MODE;
}

// Valeur courante lisible sans React. Hydratée depuis localStorage au 1er accès
// côté navigateur (le SSR retombe sur le défaut, pas d'accès à localStorage).
let mode: ReasoningMode = DEFAULT_MODE;
let hydrated = false;

export function getReasoningMode(): ReasoningMode {
  if (!hydrated && typeof window !== "undefined") {
    mode = normalize(window.localStorage.getItem(STORAGE_KEY));
    hydrated = true;
  }
  return mode;
}

export function setReasoningMode(next: ReasoningMode): void {
  mode = normalize(next);
  hydrated = true;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }
}

interface ReasoningContextValue {
  mode: ReasoningMode;
  setMode: (mode: ReasoningMode) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function ReasoningProvider({ children }: { children: ReactNode }) {
  // Départ sur le défaut pour un rendu serveur/client identique, puis
  // hydratation depuis localStorage au montage.
  const [current, setCurrent] = useState<ReasoningMode>(DEFAULT_MODE);

  useEffect(() => {
    const stored = getReasoningMode();
    setCurrent((prev) => (prev === stored ? prev : stored));
  }, []);

  const setMode = useCallback((next: ReasoningMode) => {
    setReasoningMode(next);
    setCurrent(next);
  }, []);

  return (
    <ReasoningContext.Provider value={{ mode: current, setMode }}>
      {children}
    </ReasoningContext.Provider>
  );
}

export function useReasoning(): ReasoningContextValue {
  const ctx = useContext(ReasoningContext);
  if (!ctx) {
    throw new Error("useReasoning doit être utilisé dans un <ReasoningProvider>.");
  }
  return ctx;
}
