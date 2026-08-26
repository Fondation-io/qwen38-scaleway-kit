import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { runQuery } from "@/lib/db";
import { audit } from "@/lib/audit";

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
  const result = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  if (typeof result.chart === "string") {
    result.chartUrl = `/api/charts/${basename(result.chart)}`;
    delete result.chart;
  }
  return result;
}

// Résumé compact d'une sortie de tool pour le journal d'audit.
function summarize(out: unknown): Record<string, unknown> {
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    if (typeof o.error === "string") return { error: o.error };
    if (Array.isArray(o.rows))
      return { rowCount: o.rowCount ?? (o.rows as unknown[]).length };
    if (typeof o.chartUrl === "string") return { chartUrl: o.chartUrl };
  }
  return {};
}

export interface ToolContext {
  traceId: string;
}

// Enveloppe chaque tool : journalise appel + résultat/erreur + durée, et
// GARANTIT de ne jamais throw — retourne toujours soit la donnée, soit
// { error }. Un tool ne peut donc plus casser le stream ni le rendu.
function traced<A>(
  ctx: ToolContext,
  name: string,
  fn: (args: A) => Promise<unknown>,
): (args: A) => Promise<unknown> {
  return async (args: A) => {
    const started = Date.now();
    await audit(ctx.traceId, "tool_call", { tool: name, args });
    try {
      const out = await fn(args);
      await audit(ctx.traceId, "tool_result", {
        tool: name,
        ok: true,
        durationMs: Date.now() - started,
        ...summarize(out),
      });
      return out;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await audit(ctx.traceId, "tool_error", {
        tool: name,
        ok: false,
        durationMs: Date.now() - started,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { error: message };
    }
  };
}

export function makeTools(ctx: ToolContext) {
  return {
    sql_query: tool({
      description:
        "Exécute une requête SQL en lecture seule (SELECT ou WITH) sur la base SQLite des événements de sécurité. Résultats plafonnés à 200 lignes.",
      inputSchema: z.object({
        sql: z.string().describe("Requête SQL (SELECT ou WITH ... SELECT)"),
      }),
      execute: traced(ctx, "sql_query", async ({ sql }: { sql: string }) =>
        runQuery(sql),
      ),
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
      execute: traced(
        ctx,
        "describe_data",
        async ({ table }: { table?: string }) => {
          const where = table
            ? ` WHERE table_name = '${table.replace(/'/g, "''")}'`
            : "";
          return runQuery(
            `SELECT table_name, column_name, n_rows, n_distinct, n_null, min_value, max_value, top_values FROM data_profile${where}`,
          );
        },
      ),
    }),

    user_timeline: tool({
      description:
        "Génère un graphique PNG de l'activité quotidienne d'un profil (signon, mail SMTP, sessions de transfert, transferts d'objet), avec la fenêtre d'intrusion surlignée si le profil est un insider confirmé. Retourne un résumé JSON et chartUrl.",
      inputSchema: z.object({
        user: z.string().describe("Profil utilisateur, ex. AAM0658"),
        start: dateSchema.describe("Date de début YYYY-MM-DD"),
        end: dateSchema.describe("Date de fin YYYY-MM-DD"),
      }),
      execute: traced(
        ctx,
        "user_timeline",
        async ({
          user,
          start,
          end,
        }: {
          user: string;
          start?: string;
          end?: string;
        }) => runChart("user_timeline", { user, start, end }),
      ),
    }),

    transfer_sessions: tool({
      description:
        "Génère un graphique PNG des sessions de transfert réseau (ACS/FTP, jobs QZDASOINIT) ouvertes par jour pour un profil, avec sa moyenne et le seuil moyenne + 3 écarts-types. Retourne un résumé JSON et chartUrl.",
      inputSchema: z.object({
        user: z.string().describe("Profil utilisateur, ex. AAM0658"),
        start: dateSchema.describe("Date de début YYYY-MM-DD"),
        end: dateSchema.describe("Date de fin YYYY-MM-DD"),
      }),
      execute: traced(
        ctx,
        "transfer_sessions",
        async ({
          user,
          start,
          end,
        }: {
          user: string;
          start?: string;
          end?: string;
        }) => runChart("transfer_sessions", { user, start, end }),
      ),
    }),

    after_hours: tool({
      description:
        "Génère un graphique PNG du classement des profils avec le plus de signons interactifs en dehors des heures ouvrées. Retourne un résumé JSON et chartUrl.",
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
      execute: traced(
        ctx,
        "after_hours",
        async ({
          start,
          end,
          top,
        }: {
          start?: string;
          end?: string;
          top?: number;
        }) => runChart("after_hours", { start, end, top }),
      ),
    }),

    outliers: tool({
      description:
        "Génère un graphique PNG des jours anormaux (n_events > moyenne + sigma * écart-type) pour un flux IBM i donné (signon, mail, transfer_session, object_transfer), et indique combien d'insiders confirmés sont détectés. Retourne un résumé JSON et chartUrl.",
      inputSchema: z.object({
        stream: z
          .enum(["signon", "mail", "transfer_session", "object_transfer"])
          .optional()
          .describe("Flux analysé (défaut transfer_session)"),
        sigma: z
          .number()
          .min(1)
          .max(10)
          .optional()
          .describe("Seuil en écarts-types (défaut 3)"),
        start: dateSchema.describe("Date de début YYYY-MM-DD"),
        end: dateSchema.describe("Date de fin YYYY-MM-DD"),
      }),
      execute: traced(
        ctx,
        "outliers",
        async ({
          stream,
          sigma,
          start,
          end,
        }: {
          stream?: string;
          sigma?: number;
          start?: string;
          end?: string;
        }) => runChart("outliers", { stream, sigma, start, end }),
      ),
    }),
  };
}
