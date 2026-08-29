import { describe, expect, test } from "bun:test";
import {
  buildSkillCatalog,
  parseSkillDocument,
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
});
