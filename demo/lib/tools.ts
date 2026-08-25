import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { runQuery } from "@/lib/db";

const execFileAsync = promisify(execFile);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD")
  .optional();

type ChartArgs = Record<string, string | number | undefined>;

async function runChart(toolName: string, args: ChartArgs) {
  const pythonBin = process.env.PYTHON_BIN;
  const script = process.env.CHARTS_SCRIPT;
  if (!pythonBin || !script) {
    throw new Error("PYTHON_BIN ou CHARTS_SCRIPT non configuré");
  }
  const argv = [script, toolName];
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) argv.push(`--${key}`, String(value));
  }
  const { stdout } = await execFileAsync(pythonBin, argv, {
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("Sortie vide du script de charts");
  const result = JSON.parse(lines[lines.length - 1]) as Record<
    string,
    unknown
  >;
  if (typeof result.chart === "string") {
    result.chartUrl = `/api/charts/${basename(result.chart)}`;
    delete result.chart;
  }
  return result;
}

function safeError(error: unknown) {
  return { error: error instanceof Error ? error.message : String(error) };
}

export const tools = {
  sql_query: tool({
    description:
      "Exécute une requête SQL en lecture seule (SELECT ou WITH) sur la base SQLite des événements de sécurité. Résultats plafonnés à 200 lignes.",
    inputSchema: z.object({
      sql: z.string().describe("Requête SQL (SELECT ou WITH ... SELECT)"),
    }),
    execute: async ({ sql }) => {
      try {
        return runQuery(sql);
      } catch (error) {
        return safeError(error);
      }
    },
  }),

  describe_data: tool({
    description:
      "Retourne le profil des données (table data_profile) : pour chaque colonne, nombre de lignes, valeurs distinctes, nulls, min/max et valeurs les plus fréquentes. Filtrable par table.",
    inputSchema: z.object({
      table: z
        .string()
        .optional()
        .describe("Nom de table pour filtrer (optionnel)"),
    }),
    execute: async ({ table }) => {
      try {
        const where = table
          ? ` WHERE table_name = '${table.replace(/'/g, "''")}'`
          : "";
        return runQuery(
          `SELECT table_name, column_name, n_rows, n_distinct, n_null, min_value, max_value, top_values FROM data_profile${where}`,
        );
      } catch (error) {
        return safeError(error);
      }
    },
  }),

  user_timeline: tool({
    description:
      "Génère un graphique PNG de l'activité quotidienne d'un utilisateur (logon, email, http, device), avec la fenêtre d'intrusion surlignée si l'utilisateur est un insider confirmé. Retourne un résumé JSON et chartUrl.",
    inputSchema: z.object({
      user: z.string().describe("Identifiant utilisateur, ex. AAM0658"),
      start: dateSchema.describe("Date de début YYYY-MM-DD"),
      end: dateSchema.describe("Date de fin YYYY-MM-DD"),
    }),
    execute: async ({ user, start, end }) => {
      try {
        return await runChart("user_timeline", { user, start, end });
      } catch (error) {
        return safeError(error);
      }
    },
  }),

  usb_activity: tool({
    description:
      "Génère un graphique PNG des branchements USB quotidiens d'un utilisateur, avec sa moyenne et le seuil moyenne + 3 écarts-types. Retourne un résumé JSON et chartUrl.",
    inputSchema: z.object({
      user: z.string().describe("Identifiant utilisateur, ex. AAM0658"),
      start: dateSchema.describe("Date de début YYYY-MM-DD"),
      end: dateSchema.describe("Date de fin YYYY-MM-DD"),
    }),
    execute: async ({ user, start, end }) => {
      try {
        return await runChart("usb_activity", { user, start, end });
      } catch (error) {
        return safeError(error);
      }
    },
  }),

  after_hours: tool({
    description:
      "Génère un graphique PNG du classement des utilisateurs les plus actifs en dehors des heures ouvrées. Retourne un résumé JSON et chartUrl.",
    inputSchema: z.object({
      start: dateSchema.describe("Date de début YYYY-MM-DD"),
      end: dateSchema.describe("Date de fin YYYY-MM-DD"),
      top: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Nombre d'utilisateurs à afficher (défaut 15)"),
    }),
    execute: async ({ start, end, top }) => {
      try {
        return await runChart("after_hours", { start, end, top });
      } catch (error) {
        return safeError(error);
      }
    },
  }),

  outliers: tool({
    description:
      "Génère un graphique PNG des jours anormaux (n_events > moyenne + sigma * écart-type) pour un flux donné (logon, email, http, device), et indique combien d'insiders confirmés sont détectés. Retourne un résumé JSON et chartUrl.",
    inputSchema: z.object({
      stream: z
        .enum(["logon", "email", "http", "device"])
        .optional()
        .describe("Flux analysé (défaut device)"),
      sigma: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Seuil en écarts-types (défaut 3)"),
      start: dateSchema.describe("Date de début YYYY-MM-DD"),
      end: dateSchema.describe("Date de fin YYYY-MM-DD"),
    }),
    execute: async ({ stream, sigma, start, end }) => {
      try {
        return await runChart("outliers", { stream, sigma, start, end });
      } catch (error) {
        return safeError(error);
      }
    },
  }),
};
