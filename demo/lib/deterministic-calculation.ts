import Decimal from "decimal.js";
import { z } from "zod";

Decimal.set({ precision: 80, rounding: Decimal.ROUND_HALF_UP });

export const DETERMINISTIC_CALCULATION_PROTOCOL = `CALCULS DÉTERMINISTES — INTERDICTION ABSOLUE :
- ne calcule jamais toi-même, ni mentalement, ni dans ton raisonnement, même pour une opération triviale.
- Toute valeur dérivée doit provenir de calculator, date_calculator ou d'un calcul exécuté par Db2.
- Tu peux seulement recopier sans modification une valeur fournie par l'utilisateur ou retournée par un tool.
- Sommes multi-lignes, différences, ratios, pourcentages, évolutions, moyennes, arrondis, conversions et durées exigent un tool.
- Si le tool échoue ou refuse, signale l'impossibilité ; ne calcule jamais à sa place.
- Avant la réponse finale, vérifie que chaque valeur dérivée publiée possède un résultat de tool explicite.`;

const decimalString = z
  .string()
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/, "Nombre décimal attendu sous forme de chaîne");
const nonNegativeDecimalString = z
  .string()
  .regex(/^(?:\d+(?:\.\d*)?|\.\d+)$/, "Durée positive attendue sous forme de chaîne");
const resultScale = z.number().int().min(0).max(12).default(6);

export const arithmeticBatchSchema = z.object({
  calculations: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        operation: z.enum([
          "sum",
          "subtract",
          "multiply",
          "divide",
          "average",
          "median",
          "min",
          "max",
          "ratio",
          "percent_of",
          "percentage_change",
          "round",
        ]),
        values: z.array(decimalString).min(1).max(200),
        scale: resultScale,
      }),
    )
    .min(1)
    .max(100),
});

type ArithmeticCalculation = z.infer<typeof arithmeticBatchSchema>["calculations"][number];

export interface ArithmeticBatchResult {
  source: "calculator";
  results: Array<{
    id: string;
    operation: ArithmeticCalculation["operation"];
    value: string;
    scale: number;
  }>;
}

function requireArity(
  calculation: ArithmeticCalculation,
  expected: number | { min: number },
): void {
  const actual = calculation.values.length;
  if (typeof expected === "number" && actual !== expected) {
    throw new Error(
      `${calculation.id}: ${calculation.operation} exige ${expected} valeur(s), reçu ${actual}`,
    );
  }
  if (typeof expected !== "number" && actual < expected.min) {
    throw new Error(
      `${calculation.id}: ${calculation.operation} exige au moins ${expected.min} valeur(s), reçu ${actual}`,
    );
  }
}

function safeDivide(numerator: Decimal, denominator: Decimal, id: string): Decimal {
  if (denominator.isZero()) throw new Error(`${id}: division par zéro interdite`);
  return numerator.dividedBy(denominator);
}

function calculateArithmetic(calculation: ArithmeticCalculation): Decimal {
  const values = calculation.values.map((value) => new Decimal(value));

  switch (calculation.operation) {
    case "sum":
      return values.reduce((total, value) => total.plus(value), new Decimal(0));
    case "subtract":
      requireArity(calculation, 2);
      return values[0]!.minus(values[1]!);
    case "multiply":
      requireArity(calculation, { min: 2 });
      return values.reduce((product, value) => product.times(value), new Decimal(1));
    case "divide":
    case "ratio":
      requireArity(calculation, 2);
      return safeDivide(values[0]!, values[1]!, calculation.id);
    case "average": {
      const total = values.reduce((sum, value) => sum.plus(value), new Decimal(0));
      return total.dividedBy(values.length);
    }
    case "median": {
      const sorted = [...values].sort((left, right) => left.comparedTo(right));
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1
        ? sorted[middle]!
        : sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2);
    }
    case "min":
      return Decimal.min(...values);
    case "max":
      return Decimal.max(...values);
    case "percent_of":
      requireArity(calculation, 2);
      return safeDivide(values[0]!, values[1]!, calculation.id).times(100);
    case "percentage_change":
      requireArity(calculation, 2);
      return safeDivide(values[1]!.minus(values[0]!), values[0]!, calculation.id).times(100);
    case "round":
      requireArity(calculation, 1);
      return values[0]!;
  }
}

function fixed(value: Decimal, scale: number): string {
  const normalized = value.isZero() ? new Decimal(0) : value;
  return normalized.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}

export function runArithmeticBatch(input: unknown): ArithmeticBatchResult {
  const parsed = arithmeticBatchSchema.parse(input);
  return {
    source: "calculator",
    results: parsed.calculations.map((calculation) => ({
      id: calculation.id,
      operation: calculation.operation,
      value: fixed(calculateArithmetic(calculation), calculation.scale),
      scale: calculation.scale,
    })),
  };
}

const dateUnit = z.enum(["seconds", "minutes", "hours", "days"]);
const durationUnit = z.enum(["seconds", "minutes", "hours", "days", "weeks"]);
const isoInput = z.string().min(1).max(80);

export const dateBatchSchema = z.object({
  calculations: z
    .array(
      z.discriminatedUnion("operation", [
        z.object({
          id: z.string().min(1).max(80),
          operation: z.literal("difference"),
          start: isoInput,
          end: isoInput,
          unit: dateUnit,
          scale: resultScale,
        }),
        z.object({
          id: z.string().min(1).max(80),
          operation: z.literal("add"),
          date: isoInput,
          amount: nonNegativeDecimalString,
          unit: durationUnit,
        }),
        z.object({
          id: z.string().min(1).max(80),
          operation: z.literal("subtract"),
          date: isoInput,
          amount: nonNegativeDecimalString,
          unit: durationUnit,
        }),
      ]),
    )
    .min(1)
    .max(100),
});

type DateCalculation = z.infer<typeof dateBatchSchema>["calculations"][number];

export interface DateBatchResult {
  source: "date_calculator";
  results: Array<{
    id: string;
    operation: DateCalculation["operation"];
    value: string;
    unit?: z.infer<typeof dateUnit>;
  }>;
}

const UNIT_MILLISECONDS = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
} as const;

function parseIsoDate(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new Error(`Date ISO invalide : ${value}`);
    }
    return timestamp;
  }

  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    throw new Error(`Timestamp sans fuseau explicite : ${value}`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Timestamp ISO invalide : ${value}`);
  return timestamp;
}

export function runDateBatch(input: unknown): DateBatchResult {
  const parsed = dateBatchSchema.parse(input);
  return {
    source: "date_calculator",
    results: parsed.calculations.map((calculation) => {
      if (calculation.operation === "difference") {
        const start = parseIsoDate(calculation.start);
        const end = parseIsoDate(calculation.end);
        const value = new Decimal(end).minus(start).dividedBy(UNIT_MILLISECONDS[calculation.unit]);
        return {
          id: calculation.id,
          operation: calculation.operation,
          value: fixed(value, calculation.scale),
          unit: calculation.unit,
        };
      }

      const timestamp = new Decimal(parseIsoDate(calculation.date));
      const delta = new Decimal(calculation.amount)
        .times(UNIT_MILLISECONDS[calculation.unit])
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      const result =
        calculation.operation === "add" ? timestamp.plus(delta) : timestamp.minus(delta);
      const milliseconds = result.toNumber();
      if (!Number.isSafeInteger(milliseconds)) {
        throw new Error(`${calculation.id}: date calculée hors plage sûre`);
      }
      const date = new Date(milliseconds);
      if (!Number.isFinite(date.getTime())) {
        throw new Error(`${calculation.id}: date calculée invalide`);
      }
      return {
        id: calculation.id,
        operation: calculation.operation,
        value: date.toISOString(),
      };
    }),
  };
}
