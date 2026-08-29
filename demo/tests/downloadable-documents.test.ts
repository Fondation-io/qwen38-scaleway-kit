import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPORT_PATH = "/documents/rapport-validation-runbook-securite-agents-ibmi.pdf";
const REPORT_FILE = join(process.cwd(), "public", REPORT_PATH);
const RUNBOOK_PATH = "/documents/runbook-labs-securite-agents-ibmi-10-scenarios.md";
const RUNBOOK_FILE = join(process.cwd(), "public", RUNBOOK_PATH);

describe("documents téléchargeables", () => {
  test("publie le rapport de validation dans la navigation", () => {
    const sidebar = readFileSync(
      join(process.cwd(), "components/assistant-ui/threadlist-sidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain(REPORT_PATH);
    expect(sidebar).toContain("Rapport de validation");
    expect(sidebar).toContain("Runbook & résultats");
  });

  test("sert un PDF valide et non vide", () => {
    expect(existsSync(REPORT_FILE)).toBe(true);
    expect(statSync(REPORT_FILE).size).toBeGreaterThan(100_000);
    expect(readFileSync(REPORT_FILE).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("publie le runbook exécutable dans la navigation", () => {
    const sidebar = readFileSync(
      join(process.cwd(), "components/assistant-ui/threadlist-sidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain(RUNBOOK_PATH);
    expect(sidebar).toContain("Runbook exécutable");
    expect(sidebar).toContain("10 scénarios · Markdown");
    expect(sidebar).toContain("download");
  });

  test("sert le runbook complet sans identifiants", () => {
    expect(existsSync(RUNBOOK_FILE)).toBe(true);

    const runbook = readFileSync(RUNBOOK_FILE, "utf8");
    expect(runbook).toContain("# Runbook de recette — sécurité des agents sur IBM i");
    expect(runbook.match(/^## [SG]\d\b/gm)).toHaveLength(10);
    expect(runbook).not.toContain("766a5da898ab8068");
  });
});
