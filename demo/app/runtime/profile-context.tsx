"use client";

// Profil actif de la démo, propagé par le header `x-demo-profile` (D6). Deux
// canaux d'accès complémentaires :
// - un SINGLETON module-level lu de manière SYNCHRONE par les couches non-React
//   (headers du transport de chat, fetch de l'adapter de threads, fetch SQL) ;
// - un contexte React pour l'UI (sélecteur + remontage du runtime au changement).
// Les deux restent alignés : `setProfile` écrit d'abord le singleton puis le state.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_PROFILE_ID, getProfile, type Profile } from "@/lib/profiles";

const STORAGE_KEY = "demo.activeProfile";

// Valeur courante lisible sans React. Hydratée depuis localStorage au 1er accès
// côté navigateur (le SSR retombe sur le défaut, pas d'accès à localStorage).
let activeProfileId: string = DEFAULT_PROFILE_ID;
let hydrated = false;

export function getActiveProfileId(): string {
  if (!hydrated && typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    activeProfileId = getProfile(stored).id;
    hydrated = true;
  }
  return activeProfileId;
}

export function setActiveProfileId(id: string): void {
  activeProfileId = getProfile(id).id;
  hydrated = true;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, activeProfileId);
  }
}

interface ProfileContextValue {
  profile: Profile;
  setProfile: (id: string) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  // Départ sur le défaut pour un rendu serveur/client identique, puis
  // hydratation depuis localStorage au montage.
  const [profile, setProfileState] = useState<Profile>(() =>
    getProfile(DEFAULT_PROFILE_ID),
  );

  useEffect(() => {
    const stored = getActiveProfileId();
    setProfileState((prev) => (prev.id === stored ? prev : getProfile(stored)));
  }, []);

  const setProfile = useCallback((id: string) => {
    setActiveProfileId(id);
    setProfileState(getProfile(id));
  }, []);

  return (
    <ProfileContext.Provider value={{ profile, setProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile doit être utilisé dans un <ProfileProvider>.");
  }
  return ctx;
}
