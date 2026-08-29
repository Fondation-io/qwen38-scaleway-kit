import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSkillCatalog,
  createSkillSession,
  parseSkillDocument,
  readSkillCatalog,
  SKILL_SELECTION_PROTOCOL,
  skillCatalogSummary,
  skillsForWorkspace,
  type RuntimeSkill,
} from "../lib/agent-skills";

const valid = `---
name: business-metrics
description: Vérifie les métriques métier.
workspaces: [gestion]
---
Définis le grain et le dénominateur.`;

describe("catalogue de skills runtime Qwen", () => {
  test("parse un SKILL.md borné", () => {
    expect(parseSkillDocument(valid, "business-metrics/SKILL.md")).toMatchObject({
      name: "business-metrics",
      description: "Vérifie les métriques métier.",
      workspaces: ["gestion"],
      body: "Définis le grain et le dénominateur.",
    });
  });

  test.each([
    ["nom invalide", valid.replace("business-metrics", "../secret")],
    ["workspace inconnu", valid.replace("[gestion]", "[finance]")],
    ["corps vide", valid.replace("Définis le grain et le dénominateur.", "")],
    ["corps trop long", valid.replace("Définis le grain et le dénominateur.", "x".repeat(8_001))],
  ])("rejette %s", (_label, source) => {
    expect(() => parseSkillDocument(source, "fixture/SKILL.md")).toThrow();
  });

  test("rejette deux noms identiques", () => {
    const skill = parseSkillDocument(valid, "a/SKILL.md");
    expect(() => buildSkillCatalog([skill, { ...skill, source: "b/SKILL.md" }])).toThrow(
      /dupliqué/i,
    );
  });

  test("filtre le catalogue par workspace", () => {
    const common: RuntimeSkill = {
      name: "data-reliability",
      description: "Fiabilité.",
      workspaces: ["security", "gestion"],
      body: "Contrôle les preuves.",
      source: "common/SKILL.md",
    };
    const gestion = parseSkillDocument(valid, "business/SKILL.md");
    const catalog = buildSkillCatalog([common, gestion]);
    expect(skillsForWorkspace(catalog, "security").map((skill) => skill.name)).toEqual([
      "data-reliability",
    ]);
    expect(skillsForWorkspace(catalog, "gestion").map((skill) => skill.name)).toEqual([
      "business-metrics",
      "data-reliability",
    ]);
  });

  const skillRoot = join(process.cwd(), "agent-skills");

  test("charge les sept skills versionnées", () => {
    expect([...readSkillCatalog(skillRoot).keys()].sort()).toEqual([
      "business-metrics",
      "data-reliability",
      "governed-write",
      "historical-backlog",
      "network-origin-analysis",
      "security-signal-analysis",
      "temporal-correlation",
    ]);
  });

  test("isole les deux workspaces et bloque les rechargements", () => {
    const catalog = readSkillCatalog(skillRoot);
    const security = createSkillSession(catalog, "security");
    expect(() => security.load("business-metrics")).toThrow(/non autorisée/i);
    expect(security.load("network-origin-analysis")).toMatchObject({
      name: "network-origin-analysis",
    });
    expect(security.load("network-origin-analysis")).toEqual({
      name: "network-origin-analysis",
      alreadyLoaded: true,
    });
  });

  test("le résumé ne divulgue pas le corps des skills", () => {
    const catalog = readSkillCatalog(skillRoot);
    const summary = skillCatalogSummary(skillsForWorkspace(catalog, "gestion"));
    expect(summary).toContain("business-metrics");
    expect(summary).not.toContain("COUNT(DISTINCT");
  });

  test("le protocole borne et subordonne les skills aux permissions", () => {
    expect(SKILL_SELECTION_PROTOCOL).toContain("load_skill");
    expect(SKILL_SELECTION_PROTOCOL).toContain("deux skills maximum");
    expect(SKILL_SELECTION_PROTOCOL).toContain("n'étend jamais tes permissions");
    expect(SKILL_SELECTION_PROTOCOL).toContain("ne recharge jamais");
  });

  test("inclut les SKILL.md dans le standalone de la route chat", () => {
    const source = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(source).toContain('"/api/chat"');
    expect(source).toContain("./agent-skills/**/SKILL.md");
  });
});
