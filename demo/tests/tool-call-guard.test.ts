import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createToolCallGuard } from "../lib/tool-call-guard";

describe("garde d'appels de tools", () => {
  test("bloque un appel identique malgré l'ordre des propriétés", () => {
    const guard = createToolCallGuard();

    expect(
      guard.claim("sql_query", { sql: "SELECT 1", options: { b: 2, a: 1 } }).allowed,
    ).toBeTrue();
    expect(guard.claim("sql_query", { options: { a: 1, b: 2 }, sql: "SELECT 1" })).toEqual({
      allowed: false,
      reason:
        "Appel identique déjà exécuté dans ce run : sql_query. Relis son résultat et conclus.",
    });
  });

  test("autorise des arguments réellement différents", () => {
    const guard = createToolCallGuard();

    expect(guard.claim("sql_query", { sql: "SELECT 1" }).allowed).toBeTrue();
    expect(guard.claim("sql_query", { sql: "SELECT 2" }).allowed).toBeTrue();
  });

  test("plafonne les requêtes SQL d'un même run", () => {
    const guard = createToolCallGuard({ sql_query: 2 });

    expect(guard.claim("sql_query", { sql: "SELECT 1" }).allowed).toBeTrue();
    expect(guard.claim("sql_query", { sql: "SELECT 2" }).allowed).toBeTrue();
    expect(guard.claim("sql_query", { sql: "SELECT 3" })).toEqual({
      allowed: false,
      reason:
        "Budget de 2 appels sql_query atteint dans ce run. N'explore plus : conclus avec les preuves disponibles.",
    });
  });

  test("protège tous les tools serveur via le wrapper tracé", () => {
    const source = readFileSync(join(process.cwd(), "lib/tools.ts"), "utf8");

    expect(source).toContain("ctx.callGuard?.claim(name, args)");
    expect(source).toContain("ctx.callGuard ??= createToolCallGuard()");
    expect(source).toContain("blocked: true");
  });
});
