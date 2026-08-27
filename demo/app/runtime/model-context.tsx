"use client";

// Choix du modèle/provider actif (RBAC simulé côté modèle). Singleton module-level
// lu SYNCHRONE par le header du transport, + contexte React pour l'UI. Propagé par
// le header `x-demo-model`. Défaut : DEFAULT_MODEL_ID.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_MODEL_ID, getModel, type ModelEntry } from "@/lib/models";

const STORAGE_KEY = "demo.activeModel";

let activeModelId: string = DEFAULT_MODEL_ID;

export function getActiveModelId(): string {
  if (activeModelId === DEFAULT_MODEL_ID && typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) activeModelId = stored;
  }
  return activeModelId;
}

export function setActiveModelId(id: string): void {
  activeModelId = id;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, id);
  }
}

interface ModelContextValue {
  model: ModelEntry;
  setModel: (id: string) => void;
}

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(DEFAULT_MODEL_ID);

  useEffect(() => {
    const stored = getActiveModelId();
    if (stored !== id) setId(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setModel = (next: string) => {
    setActiveModelId(next);
    setId(next);
  };

  return (
    <ModelContext.Provider value={{ model: getModel(id), setModel }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel(): ModelContextValue {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useModel hors ModelProvider");
  return ctx;
}
