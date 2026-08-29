import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DETERMINISTIC_CALCULATION_PROTOCOL,
  runArithmeticBatch,
  runDateBatch,
} from "../lib/deterministic-calculation";

describe("calculs arithmétiques déterministes", () => {
  test("réconcilie exactement G2", () => {
    const result = runArithmeticBatch({
      calculations: [
        {
          id: "ca",
          operation: "sum",
          values: [
            "127482.37",
            "271239.32",
            "414330.95",
            "390812.40",
            "566851.40",
            "490050.37",
            "566299.08",
            "645832.36",
            "701077.49",
            "751117.01",
            "1153364.20",
            "843078.29",
          ],
          scale: 2,
        },
        {
          id: "orders",
          operation: "sum",
          values: [
            "750",
            "1653",
            "2546",
            "2303",
            "3546",
            "3135",
            "3872",
            "4193",
            "4150",
            "4478",
            "7289",
            "5513",
          ],
          scale: 0,
        },
      ],
    });

    expect(result.results.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: "ca", value: "6921535.24" },
      { id: "orders", value: "43428" },
    ]);
  });

  test("calcule ratios, évolution et statistiques", () => {
    const result = runArithmeticBatch({
      calculations: [
        {
          id: "ratio",
          operation: "ratio",
          values: ["1412089.53", "8647"],
          scale: 2,
        },
        {
          id: "growth",
          operation: "percentage_change",
          values: ["127482.37", "271239.32"],
          scale: 1,
        },
        {
          id: "median",
          operation: "median",
          values: ["1", "9", "3", "5"],
          scale: 1,
        },
        { id: "rounded", operation: "round", values: ["2.345"], scale: 2 },
      ],
    });

    expect(result.results.map((entry) => entry.value)).toEqual([
      "163.30",
      "112.8",
      "4.0",
      "2.35",
    ]);
  });

  test("refuse la division par zéro", () => {
    expect(() =>
      runArithmeticBatch({
        calculations: [
          { id: "zero", operation: "divide", values: ["1", "0"], scale: 2 },
        ],
      }),
    ).toThrow(/zéro/i);
  });
});

describe("dates déterministes", () => {
  test("mesure les 773 jours historiques", () => {
    expect(
      runDateBatch({
        calculations: [
          {
            id: "age",
            operation: "difference",
            start: "2016-09-04",
            end: "2018-10-17",
            unit: "days",
            scale: 0,
          },
        ],
      }).results[0]?.value,
    ).toBe("773");
  });

  test("ajoute une durée en UTC", () => {
    expect(
      runDateBatch({
        calculations: [
          {
            id: "window",
            operation: "add",
            date: "2024-02-28T12:00:00Z",
            amount: "2",
            unit: "days",
          },
        ],
      }).results[0]?.value,
    ).toBe("2024-03-01T12:00:00.000Z");
  });

  test("refuse un timestamp sans fuseau", () => {
    expect(() =>
      runDateBatch({
        calculations: [
          {
            id: "ambiguous",
            operation: "difference",
            start: "2024-01-01T10:00:00",
            end: "2024-01-02T10:00:00Z",
            unit: "hours",
            scale: 0,
          },
        ],
      }),
    ).toThrow(/fuseau/i);
  });

  test("interdit explicitement tout calcul LLM", () => {
    expect(DETERMINISTIC_CALCULATION_PROTOCOL).toContain("INTERDICTION ABSOLUE");
    expect(DETERMINISTIC_CALCULATION_PROTOCOL).toContain("ne calcule jamais toi-même");
    expect(DETERMINISTIC_CALCULATION_PROTOCOL).toContain("date_calculator");
  });
});

describe("intégration runtime", () => {
  test("expose les deux tools obligatoires dans les deux workspaces", () => {
    const source = readFileSync(join(process.cwd(), "lib/tools.ts"), "utf8");

    expect(source).toContain("calculator: tool({");
    expect(source).toContain("date_calculator: tool({");
    expect(source).toContain("OBLIGATOIRE pour toute valeur arithmétique dérivée");
    expect(source).toContain("OBLIGATOIRE pour toute différence ou conversion de date/durée");
    expect(source.match(/\.\.\.deterministicCalculationTools\(ctx\)/g)).toHaveLength(2);
  });

  test("injecte le protocole dans les deux prompts système", () => {
    const source = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");

    expect(source).toContain('from "@/lib/deterministic-calculation"');
    expect(source.match(/\$\{DETERMINISTIC_CALCULATION_PROTOCOL\}/g)).toHaveLength(2);
  });
});
