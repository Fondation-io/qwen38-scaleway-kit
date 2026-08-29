// Profils de démo (RBAC simulé — PAS d'authentification réelle). Le profil actif
// est un contexte choisi dans l'UI, propagé par le header `x-demo-profile`. Il
// détermine (1) le cloisonnement des conversations, (2) le gating SQL, (3) le
// bloc d'autorisations injecté dans le prompt système.
//
// Aligné au récit IBM i : chaque profil porte une autorité spéciale (ou aucune),
// et le profil `*ALLOBJ` illustre EN DIRECT pourquoi le profil sur-privilégié est
// le risque interne n°1 (voir plan démo F2).

export type ContentAccess = "none" | "self-approve" | "allowed" | "unrestricted";

// Deux workspaces ÉTANCHES : « security » (base d'audit SQLite, profils SOC) et
// « gestion » (base Db2 GESTION/OLIST, rôles métier mappés sur des comptes Db2
// réels). Le workspace est déterminé par le profil actif — jamais par la syntaxe
// SQL : la gate Db2 s'applique parce que le workspace est gestion, point.
export type Workspace = "security" | "gestion";

export interface ProfilePolicy {
  // Colonnes de contenu sensible / PII que ce profil ne peut PAS sélectionner.
  deniedColumns: string[];
  // Comportement de la gate face à une lecture de contenu sensible.
  contentAccess: ContentAccess;
}

// Accès en écriture du workspace gestion : aucun, via procédures stockées
// (carte d'approbation), ou direct (profil sur-privilégié, gate débrayée).
export type WriteAccess = "none" | "procedures" | "direct";

export interface Profile {
  id: string;
  workspace: Workspace;
  label: string;
  role: string;
  ibmiAuthorities: string; // badge affiché : autorité IBM i ou compte Db2
  description: string; // une phrase, affichée dans le sélecteur
  policy: ProfilePolicy;
  // Workspace gestion uniquement : compte Db2 réel + droits d'écriture.
  db2Role?: "consult" | "analyste" | "operateur" | "admin";
  writeAccess?: WriteAccess;
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
    workspace: "security",
    label: "Analyste SOC junior",
    role: "Agrégats seulement",
    ibmiAuthorities: "—",
    description:
      "Ne peut lire aucun contenu sensible en clair. Comptages, tendances et agrégats uniquement.",
    policy: { deniedColumns: [...SENSITIVE_COLUMNS], contentAccess: "none" },
  },
  {
    id: "soc-senior",
    workspace: "security",
    label: "Analyste SOC senior",
    role: "Lecture tracée (auto-consentie)",
    ibmiAuthorities: "—",
    description:
      "Peut lire le contenu sensible après validation explicite tracée (garde-fou et journal RGPD).",
    policy: { deniedColumns: [], contentAccess: "self-approve" },
  },
  {
    id: "rssi",
    workspace: "security",
    label: "RSSI / DPO",
    role: "Supervision sécurité",
    ibmiAuthorities: "*AUDIT",
    description:
      "Habilité à consulter directement le contenu sensible dans le cadre d'une investigation.",
    policy: { deniedColumns: [], contentAccess: "allowed" },
  },
  {
    id: "allobj",
    workspace: "security",
    label: "Profil *ALLOBJ",
    role: "Administrateur sur-privilégié",
    ibmiAuthorities: "*ALLOBJ *SECADM",
    description:
      "Voit tout, sans aucun garde-fou. Illustre le risque interne n°1 du profil sur-privilégié — pas un bon défaut.",
    policy: { deniedColumns: [], contentAccess: "unrestricted" },
  },
  // ---- Workspace GESTION : rôles métier mappés sur des comptes Db2 réels ----
  // La gate applicative (dialecte Db2) est la 1ère ligne ; les GRANTs Db2 du
  // compte connecté sont la 2ème : un contournement meurt en SQL0551N.
  {
    id: "gest-consult",
    workspace: "gestion",
    label: "Consultation direction",
    role: "Agrégats seulement (vues)",
    ibmiAuthorities: "CONSULT",
    description:
      "Lit uniquement les vues agrégées (CA, ventes, notes, états). Aucun accès aux clients ni au texte des avis.",
    policy: { deniedColumns: [], contentAccess: "none" },
    db2Role: "consult",
    writeAccess: "none",
  },
  {
    id: "gest-analyste",
    workspace: "gestion",
    label: "Analyste gestion",
    role: "Lecture complète",
    ibmiAuthorities: "ANALYSTE",
    description:
      "Lit toutes les tables de gestion (clients, commandes, paiements, avis). Aucune écriture.",
    policy: { deniedColumns: [], contentAccess: "allowed" },
    db2Role: "analyste",
    writeAccess: "none",
  },
  {
    id: "gest-operateur",
    workspace: "gestion",
    label: "Opérateur ADV",
    role: "Écritures encadrées",
    ibmiAuthorities: "OPERATEUR",
    description:
      "Lecture complète. Écrit UNIQUEMENT via les opérations paramétrées prévues (statut de commande, paiement), chacune validée par une carte d'approbation.",
    policy: { deniedColumns: [], contentAccess: "allowed" },
    db2Role: "operateur",
    writeAccess: "procedures",
  },
  {
    id: "gest-admin",
    workspace: "gestion",
    label: "Admin sur-privilégié",
    role: "Accès total, sans garde-fou",
    ibmiAuthorities: "DATAACCESS",
    description:
      "Équivalent *ALLOBJ : lit et écrit tout, directement, gate débrayée. Illustre le risque du profil sur-privilégié.",
    policy: { deniedColumns: [], contentAccess: "unrestricted" },
    db2Role: "admin",
    writeAccess: "direct",
  },
];

export const DEFAULT_PROFILE_ID = "soc-senior";
export const DEFAULT_GESTION_PROFILE_ID = "gest-analyste";

export function profilesFor(workspace: Workspace): Profile[] {
  return PROFILES.filter((p) => p.workspace === workspace);
}

export function defaultProfileId(workspace: Workspace): string {
  return workspace === "gestion" ? DEFAULT_GESTION_PROFILE_ID : DEFAULT_PROFILE_ID;
}

export function getProfile(id: string | null | undefined): Profile {
  return (
    PROFILES.find((p) => p.id === id) ??
    PROFILES.find((p) => p.id === DEFAULT_PROFILE_ID)!
  );
}
