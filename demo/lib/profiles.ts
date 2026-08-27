// Profils de démo (RBAC simulé — PAS d'authentification réelle). Le profil actif
// est un contexte choisi dans l'UI, propagé par le header `x-demo-profile`. Il
// détermine (1) le cloisonnement des conversations, (2) le gating SQL, (3) le
// bloc d'autorisations injecté dans le prompt système.
//
// Aligné au récit IBM i : chaque profil porte une autorité spéciale (ou aucune),
// et le profil `*ALLOBJ` illustre EN DIRECT pourquoi le profil sur-privilégié est
// le risque interne n°1 (voir plan démo F2).

export type ContentAccess = "none" | "self-approve" | "allowed" | "unrestricted";

export interface ProfilePolicy {
  // Colonnes de contenu sensible / PII que ce profil ne peut PAS sélectionner.
  deniedColumns: string[];
  // Comportement de la gate face à une lecture de contenu sensible.
  contentAccess: ContentAccess;
}

export interface Profile {
  id: string;
  label: string;
  role: string;
  ibmiAuthorities: string; // ex. "*ALLOBJ *SECADM" ou "—"
  description: string; // une phrase, affichée dans le sélecteur
  policy: ProfilePolicy;
}

// Liste maîtresse des colonnes de contenu sensible (charge utile exfiltrable + PII).
// Corps de mail, objets exfiltrés, destinataires/expéditeur, pièces jointes, et
// l'identité nominative des profils (SECAUDIT.USER_PROFILES).
export const SENSITIVE_COLUMNS = [
  "content",
  "object_preview",
  "recipients",
  "sender",
  "attachments",
  "employee_name",
  "email",
];

export const PROFILES: Profile[] = [
  {
    id: "soc-junior",
    label: "Analyste SOC junior",
    role: "Agrégats seulement",
    ibmiAuthorities: "—",
    description:
      "Ne peut lire aucun contenu sensible en clair. Comptages, tendances et agrégats uniquement.",
    policy: { deniedColumns: [...SENSITIVE_COLUMNS], contentAccess: "none" },
  },
  {
    id: "soc-senior",
    label: "Analyste SOC senior",
    role: "Lecture tracée (auto-consentie)",
    ibmiAuthorities: "—",
    description:
      "Peut lire le contenu sensible après validation explicite tracée (garde-fou et journal RGPD).",
    policy: { deniedColumns: [], contentAccess: "self-approve" },
  },
  {
    id: "rssi",
    label: "RSSI / DPO",
    role: "Supervision sécurité",
    ibmiAuthorities: "*AUDIT",
    description:
      "Habilité à consulter directement le contenu sensible dans le cadre d'une investigation.",
    policy: { deniedColumns: [], contentAccess: "allowed" },
  },
  {
    id: "allobj",
    label: "Profil *ALLOBJ",
    role: "Administrateur sur-privilégié",
    ibmiAuthorities: "*ALLOBJ *SECADM",
    description:
      "Voit tout, sans aucun garde-fou. Illustre le risque interne n°1 du profil sur-privilégié — pas un bon défaut.",
    policy: { deniedColumns: [], contentAccess: "unrestricted" },
  },
];

export const DEFAULT_PROFILE_ID = "soc-senior";

export function getProfile(id: string | null | undefined): Profile {
  return (
    PROFILES.find((p) => p.id === id) ??
    PROFILES.find((p) => p.id === DEFAULT_PROFILE_ID)!
  );
}
