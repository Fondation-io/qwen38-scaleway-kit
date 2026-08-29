import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPORT_PATH = "/documents/rapport-validation-runbook-securite-agents-ibmi.pdf";
const REPORT_FILE = join(process.cwd(), "public", REPORT_PATH);

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
});
