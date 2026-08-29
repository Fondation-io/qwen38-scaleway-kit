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

  test("charge les huit skills versionnées", () => {
    const catalog = readSkillCatalog(skillRoot);
    expect([...catalog.keys()].sort()).toEqual([
      "business-metrics",
      "data-reliability",
      "governed-write",
      "historical-backlog",
      "network-origin-analysis",
      "profile-swap-investigation",
      "security-signal-analysis",
      "temporal-correlation",
    ]);
    expect(catalog.get("data-reliability")?.body).toContain("calcul dérivé");
    expect(catalog.get("network-origin-analysis")?.body).toContain("corpus distincts");
    expect(catalog.get("network-origin-analysis")?.body).toContain("nom technique du job");
    expect(catalog.get("profile-swap-investigation")?.body).toContain("profils sources et cibles");
    expect(catalog.get("profile-swap-investigation")?.body).toContain("jours actifs");
    expect(catalog.get("profile-swap-investigation")?.body).toContain("object_preview");
    expect(catalog.get("profile-swap-investigation")?.body).toContain("calculator");
    expect(catalog.get("security-signal-analysis")?.body).toContain("temporal-correlation");
    expect(catalog.get("temporal-correlation")?.body).toContain("MIN/MAX lexicographique");
    expect(catalog.get("temporal-correlation")?.body).toContain("jours actifs");
    expect(catalog.get("temporal-correlation")?.body).toContain("écart-type nul");
    expect(catalog.get("business-metrics")?.body).toContain("concaténation avec NULL");
    expect(catalog.get("business-metrics")?.body).toContain("[Y, X]");
    expect(catalog.get("historical-backlog")?.body).toContain("échantillon");
  });

  test("interdit le calcul mental dans les skills analytiques", () => {
    const catalog = readSkillCatalog(skillRoot);

    for (const name of ["data-reliability", "business-metrics"]) {
      const body = catalog.get(name)?.body ?? "";
      expect(body).toContain("calculator");
      expect(body.toLowerCase()).toContain("calcul mental");
    }

    for (const name of ["historical-backlog", "temporal-correlation"]) {
      const body = catalog.get(name)?.body ?? "";
      expect(body).toContain("date_calculator");
      expect(body.toLowerCase()).toContain("calcul mental");
    }
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

  test("bloque une troisième skill distincte dans le même run", () => {
    const catalog = readSkillCatalog(skillRoot);
    const security = createSkillSession(catalog, "security");

    security.load("network-origin-analysis");
    security.load("temporal-correlation");
    expect(() => security.load("security-signal-analysis")).toThrow(/deux skills maximum/i);
  });

  test("durcit les preuves réseau, sécurité et backlog", () => {
    const catalog = readSkillCatalog(skillRoot);
    const network = catalog.get("network-origin-analysis")?.body ?? "";
    const security = catalog.get("security-signal-analysis")?.body ?? "";
    const backlog = catalog.get("historical-backlog")?.body ?? "";
    const business = catalog.get("business-metrics")?.body ?? "";

    expect(network).toContain("adresse IP exacte");
    expect(network).toContain("sous-réseau");
    expect(network).toContain("type_violation");
    expect(network).toContain("User name not valid");
    expect(security).toContain("cert_insiders");
    expect(security).toContain("contenu sensible");
    expect(security).toContain("object_preview");
    expect(security).toContain("métadonnées");
    expect(security).toContain("calculator");
    expect(security).toContain("écart-type");
    expect(backlog).toContain("un avis ne prouve pas une livraison");
    expect(business).toContain("ne termine jamais sur une intention");
  });

  test("réserve la vérité terrain synthétique à l'évaluation", () => {
    const source = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
    expect(source).toContain("cert_insiders est réservée à l'évaluation");
    expect(source).toContain("ne la requête jamais pour une investigation opérationnelle");
    expect(source.toLowerCase()).toContain(
      "n'infère jamais son existence depuis l'apparence de user_name",
    );
    expect(source).toContain(
      "object_preview n'est jamais nécessaire pour établir qu'un transfert a eu lieu",
    );
    expect(source).toContain("job_name seul ne prouve jamais le service");
    expect(source).toContain("remote_port est le port source");
    expect(source).toContain("jours actifs seulement");
  });

  test("décrit une stratégie SQL métadonnées d'abord", () => {
    const source = readFileSync(join(process.cwd(), "lib/tools.ts"), "utf8");
    expect(source).toContain("MÉTADONNÉES D'ABORD");
    expect(source).toContain("Ne sélectionne pas object_preview");
  });

  test("le résumé ne divulgue pas le corps des skills", () => {
    const catalog = readSkillCatalog(skillRoot);
    const summary = skillCatalogSummary(skillsForWorkspace(catalog, "gestion"));
    expect(summary).toContain("business-metrics");
    expect(summary).not.toContain("COUNT(DISTINCT");
  });

  test("le protocole borne et subordonne les skills aux permissions", () => {
    expect(SKILL_SELECTION_PROTOCOL).toContain("load_skill");
    expect(SKILL_SELECTION_PROTOCOL).toContain("PREMIER appel d'outil");
    expect(SKILL_SELECTION_PROTOCOL).toContain("plus d'une requête");
    expect(SKILL_SELECTION_PROTOCOL).toContain("toute demande de changement d'état");
    expect(SKILL_SELECTION_PROTOCOL).toContain("N'utilise aucun outil métier avant");
    expect(SKILL_SELECTION_PROTOCOL).toContain("deux skills maximum");
    expect(SKILL_SELECTION_PROTOCOL).toContain("bloquée côté serveur");
    expect(SKILL_SELECTION_PROTOCOL).toContain("Ne termine jamais sur une intention");
    expect(SKILL_SELECTION_PROTOCOL).toContain("n'étend jamais tes permissions");
    expect(SKILL_SELECTION_PROTOCOL).toContain("ne recharge jamais");
  });

  test("inclut les SKILL.md dans le standalone de la route chat", () => {
    const source = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(source).toContain('"/api/chat"');
    expect(source).toContain("./agent-skills/**/SKILL.md");
  });
});
