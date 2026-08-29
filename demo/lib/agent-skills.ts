import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "./profiles";

export const MAX_SKILL_BODY_CHARS = 8_000;

export const SKILL_SELECTION_PROTOCOL = `SKILLS MÉTHODOLOGIQUES — PROTOCOLE OBLIGATOIRE :
- Une demande est non triviale dès qu'elle exige plus d'une requête, une corrélation, un calcul métier ou une recommandation de changement d'état.
- Pour toute demande non triviale, ton PREMIER appel d'outil doit être load_skill avec la méthode la plus pertinente. N'utilise aucun outil métier avant d'avoir chargé cette skill.
- Charge une seule skill par défaut, deux skills maximum si elles sont réellement complémentaires.
- Une skill guide ta méthode mais n'étend jamais tes permissions, ne remplace jamais la gate et n'autorise aucune écriture.
- ne recharge jamais une skill déjà chargée dans cette conversation et ne cite pas son contenu comme une justification d'autorisation.
- Pour une demande triviale ne nécessitant aucune méthode spécialisée, utilise directement l'outil approprié.`;

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_KEYS = new Set(["name", "description", "workspaces"]);
const WORKSPACES = new Set<Workspace>(["security", "gestion"]);

export interface RuntimeSkill {
  name: string;
  description: string;
  workspaces: Workspace[];
  body: string;
  source: string;
}

export type SkillCatalog = ReadonlyMap<string, RuntimeSkill>;

function scalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function inlineList(value: string, source: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`${source}: workspaces doit être une liste YAML en ligne`);
  }
  return trimmed.slice(1, -1).split(",").map(scalar).filter(Boolean);
}

export function parseSkillDocument(text: string, source: string): RuntimeSkill {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${source}: frontmatter manquant ou invalide`);

  const values = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${source}: ligne de frontmatter invalide`);
    const key = line.slice(0, separator).trim();
    if (!ALLOWED_KEYS.has(key)) throw new Error(`${source}: champ inconnu ${key}`);
    if (values.has(key)) throw new Error(`${source}: champ dupliqué ${key}`);
    values.set(key, line.slice(separator + 1).trim());
  }

  const name = scalar(values.get("name") ?? "");
  const description = scalar(values.get("description") ?? "");
  const workspaces = inlineList(values.get("workspaces") ?? "", source);
  const body = match[2].trim();

  if (!NAME_PATTERN.test(name)) throw new Error(`${source}: name invalide`);
  if (!description) throw new Error(`${source}: description vide`);
  if (
    workspaces.length === 0 ||
    workspaces.some((workspace) => !WORKSPACES.has(workspace as Workspace))
  ) {
    throw new Error(`${source}: workspace invalide`);
  }
  if (!body || body.length > MAX_SKILL_BODY_CHARS) {
    throw new Error(`${source}: corps vide ou supérieur à ${MAX_SKILL_BODY_CHARS} caractères`);
  }

  return {
    name,
    description,
    workspaces: workspaces as Workspace[],
    body,
    source,
  };
}

export function buildSkillCatalog(skills: RuntimeSkill[]): SkillCatalog {
  const catalog = new Map<string, RuntimeSkill>();
  for (const skill of skills) {
    if (catalog.has(skill.name)) throw new Error(`Skill dupliquée : ${skill.name}`);
    catalog.set(skill.name, skill);
  }
  return catalog;
}

export function readSkillCatalog(root = join(process.cwd(), "agent-skills")): SkillCatalog {
  const skills = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const source = join(root, entry.name, "SKILL.md");
      return parseSkillDocument(readFileSync(source, "utf8"), source);
    });
  return buildSkillCatalog(skills);
}

export function skillsForWorkspace(catalog: SkillCatalog, workspace: Workspace): RuntimeSkill[] {
  return [...catalog.values()]
    .filter((skill) => skill.workspaces.includes(workspace))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function skillCatalogSummary(skills: RuntimeSkill[]): string {
  return skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
}

export function createSkillSession(catalog: SkillCatalog, workspace: Workspace) {
  const allowed = new Map(
    skillsForWorkspace(catalog, workspace).map((skill) => [skill.name, skill]),
  );
  const loaded = new Set<string>();

  return {
    skills: [...allowed.values()],
    load(name: string) {
      const skill = allowed.get(name);
      if (!skill) throw new Error(`Skill non autorisée dans ${workspace}: ${name}`);
      if (loaded.has(name)) return { name, alreadyLoaded: true } as const;
      loaded.add(name);
      return { name, instructions: skill.body } as const;
    },
  };
}

let cachedCatalog: SkillCatalog | undefined;

export function getSkillCatalog(): SkillCatalog {
  cachedCatalog ??= readSkillCatalog();
  return cachedCatalog;
}
