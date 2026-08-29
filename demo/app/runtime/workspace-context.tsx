"use client";

// Workspace actif (sécurité | gestion), même patron que profile-context :
// singleton synchrone pour les couches non-React + contexte React pour l'UI.
// Changer de workspace force le profil sur le défaut du workspace cible (les
// jeux de profils sont disjoints) ; le runtime est remonté via la `key`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Workspace } from "@/lib/profiles";

const STORAGE_KEY = "demo.activeWorkspace";

let activeWorkspace: Workspace = "security";
let hydrated = false;

function normalize(v: string | null): Workspace {
  return v === "gestion" ? "gestion" : "security";
}

export function getActiveWorkspace(): Workspace {
  if (!hydrated && typeof window !== "undefined") {
    activeWorkspace = normalize(window.localStorage.getItem(STORAGE_KEY));
    hydrated = true;
  }
  return activeWorkspace;
}

export function setActiveWorkspace(ws: Workspace): void {
  activeWorkspace = ws;
  hydrated = true;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, ws);
  }
}

interface WorkspaceContextValue {
  workspace: Workspace;
  setWorkspace: (ws: Workspace) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<Workspace>("security");

  useEffect(() => {
    const stored = getActiveWorkspace();
    setWorkspaceState((prev) => (prev === stored ? prev : stored));
  }, []);

  const setWorkspace = useCallback((ws: Workspace) => {
    setActiveWorkspace(ws);
    setWorkspaceState(ws);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace doit être utilisé dans un <WorkspaceProvider>.");
  }
  return ctx;
}
