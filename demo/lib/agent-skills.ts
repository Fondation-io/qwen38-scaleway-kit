import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "./profiles";

export const MAX_SKILL_BODY_CHARS = 8_000;

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
