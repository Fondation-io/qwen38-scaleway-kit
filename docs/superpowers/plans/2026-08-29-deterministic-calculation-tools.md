# Deterministic Calculation Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interdire les calculs produits par le LLM et fournir deux tools déterministes, arithmétique et dates/durées, dans les workspaces Sécurité et Gestion.

**Architecture:** Un module pur utilise `decimal.js` pour les décimaux exacts et `Date` en UTC pour les durées ISO. `lib/tools.ts` expose deux tools batchés et `route.ts` injecte un protocole système absolu ; les skills analytiques reprennent la même règle de provenance.

**Tech Stack:** Next.js 16, TypeScript 7, AI SDK 7, Zod 4, Decimal.js, Bun test, Baseten via l'interface web.

---

## Structure des fichiers

- Create: `demo/lib/deterministic-calculation.ts` — schémas, calculs purs et protocole système.
- Create: `demo/tests/deterministic-calculation.test.ts` — régressions arithmétiques et temporelles.
- Modify: `demo/lib/tools.ts` — exposition auditée des deux tools.
- Modify: `demo/app/api/chat/route.ts` — injection de la règle système dans les deux workspaces.
- Modify: `demo/tests/agent-skills.test.ts` — contrat du prompt, des tools et des skills.
- Modify: `demo/agent-skills/data-reliability/SKILL.md` — provenance numérique commune.
- Modify: `demo/agent-skills/business-metrics/SKILL.md` — sommes et ratios via tool.
- Modify: `demo/agent-skills/historical-backlog/SKILL.md` — durées via tool/Db2.
- Modify: `demo/agent-skills/temporal-correlation/SKILL.md` — fenêtres et durées déterministes.
- Modify: `demo/package.json`, `demo/bun.lock` — dépendance `decimal.js`.
- Create: `docs/validation-calculs-deterministes-baseten.md` — résultats de la recette ciblée.

### Task 1: Contrat rouge des calculs purs

**Files:**
- Create: `demo/tests/deterministic-calculation.test.ts`
- Create: `demo/lib/deterministic-calculation.ts`
- Modify: `demo/package.json`
- Modify: `demo/bun.lock`

- [ ] **Step 1: Installer Decimal.js**

Run: `cd demo && bun add decimal.js`

Expected: `decimal.js` apparaît dans `dependencies` et le lockfile est mis à jour.

- [ ] **Step 2: Écrire les tests rouges**

Créer `demo/tests/deterministic-calculation.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import {
  DETERMINISTIC_CALCULATION_PROTOCOL,
  runArithmeticBatch,
  runDateBatch,
} from "../lib/deterministic-calculation";

describe("calculs arithmétiques déterministes", () => {
  test("réconcilie exactement G2", () => {
    const result = runArithmeticBatch({ calculations: [
      { id: "ca", operation: "sum", values: ["127482.37", "271239.32", "414330.95", "390812.40", "566851.40", "490050.37", "566299.08", "645832.36", "701077.49", "751117.01", "1153364.20", "843078.29"], scale: 2 },
      { id: "orders", operation: "sum", values: ["750", "1653", "2546", "2303", "3546", "3135", "3872", "4193", "4150", "4478", "7289", "5513"], scale: 0 },
    ]});
    expect(result.results.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: "ca", value: "6921535.24" },
      { id: "orders", value: "43428" },
    ]);
  });

  test("calcule ratios, évolution et statistiques", () => {
    const result = runArithmeticBatch({ calculations: [
      { id: "ratio", operation: "ratio", values: ["1412089.53", "8647"], scale: 2 },
      { id: "growth", operation: "percentage_change", values: ["127482.37", "271239.32"], scale: 1 },
      { id: "median", operation: "median", values: ["1", "9", "3", "5"], scale: 1 },
      { id: "rounded", operation: "round", values: ["2.345"], scale: 2 },
    ]});
    expect(result.results.map((entry) => entry.value)).toEqual(["163.30", "112.8", "4.0", "2.35"]);
  });

  test("refuse la division par zéro", () => {
    expect(() => runArithmeticBatch({ calculations: [
      { id: "zero", operation: "divide", values: ["1", "0"], scale: 2 },
    ]})).toThrow(/zéro/i);
  });
});

describe("dates déterministes", () => {
  test("mesure les 773 jours historiques", () => {
    expect(runDateBatch({ calculations: [{
      id: "age", operation: "difference", start: "2016-09-04", end: "2018-10-17", unit: "days", scale: 0,
    }]}).results[0]?.value).toBe("773");
  });

  test("ajoute une durée en UTC", () => {
    expect(runDateBatch({ calculations: [{
      id: "window", operation: "add", date: "2024-02-28T12:00:00Z", amount: "2", unit: "days",
    }]}).results[0]?.value).toBe("2024-03-01T12:00:00.000Z");
  });

  test("refuse un timestamp sans fuseau", () => {
    expect(() => runDateBatch({ calculations: [{
      id: "ambiguous", operation: "difference", start: "2024-01-01T10:00:00", end: "2024-01-02T10:00:00Z", unit: "hours", scale: 0,
    }]})).toThrow(/fuseau/i);
  });

  test("interdit explicitement tout calcul LLM", () => {
    expect(DETERMINISTIC_CALCULATION_PROTOCOL).toContain("INTERDICTION ABSOLUE");
    expect(DETERMINISTIC_CALCULATION_PROTOCOL).toContain("ne calcule jamais toi-même");
    expect(DETERMINISTIC_CALCULATION_PROTOCOL).toContain("date_calculator");
  });
});
```

- [ ] **Step 3: Vérifier le rouge**

Run: `cd demo && bun test tests/deterministic-calculation.test.ts`

Expected: FAIL car `../lib/deterministic-calculation` n'existe pas.

- [ ] **Step 4: Implémenter le module minimal**

Créer `demo/lib/deterministic-calculation.ts` avec :

```ts
import Decimal from "decimal.js";
import { z } from "zod";

export const DETERMINISTIC_CALCULATION_PROTOCOL = `CALCULS DÉTERMINISTES — INTERDICTION ABSOLUE :
- Ne calcule jamais toi-même, ni mentalement, ni dans ton raisonnement, même pour une opération triviale.
- Toute valeur dérivée doit provenir de calculator, date_calculator ou d'un calcul exécuté par Db2.
- Tu peux seulement recopier sans modification une valeur fournie par l'utilisateur ou retournée par un tool.
- Sommes multi-lignes, différences, ratios, pourcentages, évolutions, moyennes, arrondis, conversions et durées exigent un tool.
- Si le tool échoue ou refuse, signale l'impossibilité ; ne calcule jamais à sa place.
- Avant la réponse finale, vérifie que chaque valeur dérivée publiée possède un résultat de tool explicite.`;

const decimal = z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/);
const scale = z.number().int().min(0).max(12).default(6);
const arithmeticOperation = z.enum(["sum", "subtract", "multiply", "divide", "average", "median", "min", "max", "ratio", "percent_of", "percentage_change", "round"]);
export const arithmeticBatchSchema = z.object({ calculations: z.array(z.object({ id: z.string().min(1).max(80), operation: arithmeticOperation, values: z.array(decimal).min(1).max(200), scale })).min(1).max(100) });

// Parse avec Zod, valide l'arité par opération, calcule avec Decimal,
// normalise zéro et retourne une chaîne toFixed(scale) en ROUND_HALF_UP.
export function runArithmeticBatch(input: unknown): ArithmeticBatchResult;

const isoDate = z.string();
export const dateBatchSchema = z.object({ calculations: z.array(z.discriminatedUnion("operation", [
  z.object({ id: z.string(), operation: z.literal("difference"), start: isoDate, end: isoDate, unit: z.enum(["seconds", "minutes", "hours", "days"]), scale }),
  z.object({ id: z.string(), operation: z.enum(["add", "subtract"]), date: isoDate, amount: decimal, unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]) }),
])).min(1).max(100) });

// Dates simples en UTC ; timestamps avec Z/offset obligatoire ; opérations en millisecondes.
// Les différences utilisent Decimal et les additions/soustractions renvoient un ISO UTC.
export function runDateBatch(input: unknown): DateBatchResult;
```

- [ ] **Step 5: Vérifier le vert**

Run: `cd demo && bun test tests/deterministic-calculation.test.ts`

Expected: tous les tests PASS.

- [ ] **Step 6: Commit**

```bash
git add demo/package.json demo/bun.lock demo/lib/deterministic-calculation.ts demo/tests/deterministic-calculation.test.ts
git commit -m "feat(demo): ajouter les calculs déterministes"
```

### Task 2: Exposer les tools et le protocole système

**Files:**
- Modify: `demo/lib/tools.ts`
- Modify: `demo/app/api/chat/route.ts`
- Modify: `demo/tests/deterministic-calculation.test.ts`

- [ ] **Step 1: Ajouter les assertions rouges d'intégration**

Ajouter un test qui lit les sources et exige `calculator`, `date_calculator`, leur description obligatoire et les deux interpolations du protocole dans `route.ts`.

- [ ] **Step 2: Vérifier le rouge**

Run: `cd demo && bun test tests/deterministic-calculation.test.ts`

Expected: FAIL sur l'absence des tools dans `tools.ts` et du protocole dans `route.ts`.

- [ ] **Step 3: Exposer les tools**

Dans `lib/tools.ts`, importer les schémas, fonctions et créer :

```ts
function deterministicCalculationTools(ctx: ToolContext) {
  return {
    calculator: tool({
      description: "OBLIGATOIRE pour toute valeur arithmétique dérivée...",
      inputSchema: arithmeticBatchSchema,
      execute: traced(ctx, "calculator", async (args) => runArithmeticBatch(args)),
    }),
    date_calculator: tool({
      description: "OBLIGATOIRE pour toute différence ou conversion de date/durée...",
      inputSchema: dateBatchSchema,
      execute: traced(ctx, "date_calculator", async (args) => runDateBatch(args)),
    }),
  };
}
```

Ajouter `...deterministicCalculationTools(ctx)` aux objets retournés par `makeTools` et `makeGestionTools`.

- [ ] **Step 4: Injecter le protocole**

Importer `DETERMINISTIC_CALCULATION_PROTOCOL` dans `route.ts` et l'insérer après `SKILL_SELECTION_PROTOCOL` dans les deux branches du prompt système.

- [ ] **Step 5: Vérifier le vert et commit**

Run: `cd demo && bun test tests/deterministic-calculation.test.ts`

Puis :

```bash
git add demo/lib/tools.ts demo/app/api/chat/route.ts demo/tests/deterministic-calculation.test.ts
git commit -m "feat(demo): imposer les tools de calcul"
```

### Task 3: Durcir les skills

**Files:**
- Modify: `demo/tests/agent-skills.test.ts`
- Modify: `demo/agent-skills/data-reliability/SKILL.md`
- Modify: `demo/agent-skills/business-metrics/SKILL.md`
- Modify: `demo/agent-skills/historical-backlog/SKILL.md`
- Modify: `demo/agent-skills/temporal-correlation/SKILL.md`

- [ ] **Step 1: Ajouter les assertions rouges**

Exiger que les quatre skills nomment explicitement `calculator` ou `date_calculator` et interdisent le calcul mental.

- [ ] **Step 2: Vérifier le rouge**

Run: `cd demo && bun test tests/agent-skills.test.ts`

Expected: FAIL sur les nouvelles assertions.

- [ ] **Step 3: Modifier les skills**

Ajouter les règles exactes :

- `data-reliability` : toute réconciliation multi-lignes via `calculator`, sans double calcul mental ;
- `business-metrics` : sommes, ratios, évolutions et arrondis via `calculator` ;
- `historical-backlog` : durée via Db2 ou `date_calculator` ;
- `temporal-correlation` : fenêtres et écarts via Db2 ou `date_calculator`.

- [ ] **Step 4: Vérifier le vert et commit**

Run: `cd demo && bun test tests/agent-skills.test.ts`

Puis :

```bash
git add demo/tests/agent-skills.test.ts demo/agent-skills
git commit -m "fix(demo): interdire les calculs dans les skills"
```

### Task 4: Vérification complète et publication

**Files:**
- Verify: `demo/**`

- [ ] **Step 1: Exécuter toute la suite**

Run: `cd demo && bun test`

Expected: 0 échec.

- [ ] **Step 2: Lint et format**

Run: `cd demo && bun run lint`

Expected: exit 0. Si le formatteur propose des changements mécaniques, exécuter `bun run format:fix`, puis relancer les tests et le lint.

- [ ] **Step 3: Build production**

Run: `cd demo && bun run build`

Expected: build Next.js réussi et route `/api/chat` générée.

- [ ] **Step 4: Commit de finition si nécessaire et push**

```bash
git status --short
git push origin main
```

Le workflow GitHub doit publier `ghcr.io/fondation-io/qwen38-demo:latest`.

- [ ] **Step 5: Déployer**

Identifier la cible de production depuis la configuration opérateur existante, puis exécuter `scripts/deploy-demo.sh <ip>`. Vérifier HTTP 200 et la version affichée dans l'interface.

### Task 5: Recette Baseten ciblée

**Files:**
- Create: `docs/validation-calculs-deterministes-baseten.md`

- [ ] **Step 1: Rejouer S3, S4, G2, G3 et G4**

Dans `https://securiti.tech-leads.cc/`, utiliser DeepSeek V4 Flash Baseten, réflexion standard, recherche web coupée, profils du runbook et une conversation neuve par scénario.

- [ ] **Step 2: Vérifier les preuves**

Pour chaque run, relever : skill chargée, appels `calculator`/`date_calculator`, SQL déterministe éventuel, valeurs publiées, temps, débit, coût et verdict.

- [ ] **Step 3: Écrire le rapport**

Documenter les cinq runs, les erreurs résiduelles et la décision de validation. Ne déclarer la règle validée que si chaque valeur dérivée publiée possède une provenance de tool visible.

- [ ] **Step 4: Commit et push du rapport**

```bash
git add docs/validation-calculs-deterministes-baseten.md
git commit -m "docs(demo): valider les calculs avec Baseten"
git push origin main
```
