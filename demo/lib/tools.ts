import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { runQuery } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  webSearch,
  askPerplexity,
  fetchUrl,
  cveSearch,
  cveDetail,
  cveRag,
} from "@/lib/research-tools";

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

// Outils de recherche web EXTERNE (la requête sort du périmètre : Serper/Google,
// Perplexity, fetch d'URL arbitraire). Inclus dans le jeu d'outils UNIQUEMENT si
// l'analyste a explicitement autorisé la recherche web (bouton du prompt input,
// header `x-demo-websearch`). Non autorisée = le modèle ne peut pas les appeler.
function webExternalTools(ctx: ToolContext) {
  return {
    web_search: tool({
      description:
        "Recherche web (Google via Serper). Pour trouver des informations à jour : avis de sécurité éditeurs, articles, documentation, contexte de menace. Retourne les meilleurs résultats (titre, lien, extrait). Cite toujours les liens.",
      inputSchema: z.object({
        query: z.string().describe("Requête de recherche"),
        num: z.number().min(1).max(10).optional().describe("Nombre de résultats (défaut 6)"),
      }),
      execute: traced(
        ctx,
        "web_search",
        ({ query, num }: { query: string; num?: number }) => webSearch(query, num),
      ),
    }),
    ask_perplexity: tool({
      description:
        "Pose une question à Perplexity (réponse synthétique SOURCÉE avec citations). Utile pour une réponse déjà agrégée à une question de veille/menace plutôt qu'une liste de liens.",
      inputSchema: z.object({
        question: z.string().describe("Question en langage naturel"),
      }),
      execute: traced(
        ctx,
        "ask_perplexity",
        ({ question }: { question: string }) => askPerplexity(question),
      ),
    }),
    fetch_url: tool({
      description:
        "Récupère le contenu texte d'une page web publique (http/https). À utiliser pour lire un avis de sécurité, une page CVE, une doc éditeur trouvés via web_search. Adresses internes refusées.",
      inputSchema: z.object({
        url: z.string().describe("URL http(s) publique"),
      }),
      execute: traced(ctx, "fetch_url", ({ url }: { url: string }) => fetchUrl(url)),
    }),
  };
}

export function makeTools(ctx: ToolContext, opts: { allowWebSearch?: boolean } = {}) {
  // sql_query n'est PAS ici : c'est un tool CLIENT (composants/tool-uis/
  // sql-approval.tsx) soumis à validation humaine avant exécution (gate HITL).
  return {
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
          const res = runQuery(
            `SELECT table_name, column_name, n_rows, n_distinct, n_null, min_value, max_value, top_values FROM data_profile${where}`,
          );
          // data_profile ne couvre QUE cert_* et guide_evidence. Pour une table
          // non profilée (vues SECAUDIT.*, tables HONEYPOT.*), on renvoie un indice
          // actionnable au lieu d'un résultat vide qui fait boucler l'agent.
          if (res.rowCount === 0) {
            return {
              note: `Aucun profil pour "${table ?? "(toutes)"}". describe_data ne couvre QUE cert_* et guide_evidence. Les vues SECAUDIT.* (QAUDJRN_SIGNON/TRANSFER/OBJECT/MAIL/PROFILE_SWAP, USER_PROFILES, DAILY_BASELINE) et les tables HONEYPOT.* (qaudjrn_pw/sk/im) NE SONT PAS profilées : interroge-les DIRECTEMENT au SQL (COUNT(*), DISTINCT, GROUP BY), n'appelle pas describe_data dessus.`,
            };
          }
          return res;
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

    // --- Recherche autonome (assistant de sécurité) ---
    // web_search / ask_perplexity / fetch_url : inclus SEULEMENT si l'analyste a
    // autorisé la recherche web externe (sinon le modèle ne peut pas les appeler).
    ...(opts.allowWebSearch ? webExternalTools(ctx) : {}),
    cve_search: tool({
      description:
        "Recherche de CVE (base NVD/NIST) par mot-clé ou produit (ex. IBM i, QSYS, Db2 for i). Passe le terme SEUL, sans guillemets ; exact=true suffit à filtrer la phrase. Retourne id, sévérité CVSS, score, CWE et description. Renseigne le total pour cadrer le volume.",
      inputSchema: z.object({
        keyword: z.string().describe("Mot-clé ou produit, sans guillemets (ex. IBM i)"),
        exact: z.boolean().optional().describe("Correspondance exacte de la phrase"),
        limit: z.number().min(1).max(40).optional().describe("Nb de résultats (défaut 10)"),
      }),
      execute: traced(
        ctx,
        "cve_search",
        ({ keyword, exact, limit }: { keyword: string; exact?: boolean; limit?: number }) =>
          cveSearch(keyword, { exact, limit }),
      ),
    }),
    cve_rag: tool({
      description:
        "Recherche SÉMANTIQUE (par le sens, pas le mot-clé) dans une base LOCALE et CONFIDENTIELLE des CVE IBM i + bulletins de sécurité IBM (embeddings locaux, la requête ne sort pas de l'infra). À privilégier pour une question conceptuelle (ex. « failles d'élévation de privilège sur le serveur HTTP IBM i »). Formule la requête en anglais (corpus anglais). Retourne les CVE les plus proches avec score sémantique et liens de bulletins.",
      inputSchema: z.object({
        query: z.string().describe("Requête sémantique, de préférence en anglais"),
        k: z.number().min(1).max(20).optional().describe("Nb de résultats (défaut 6)"),
      }),
      execute: traced(
        ctx,
        "cve_rag",
        ({ query, k }: { query: string; k?: number }) => cveRag(query, k),
      ),
    }),
    cve_detail: tool({
      description:
        "Détail complet d'une CVE par identifiant (ex. CVE-2024-12345) : description intégrale, CVSS (score + vecteur), CWE, et liens de référence (avis éditeur, patchs).",
      inputSchema: z.object({
        cveId: z.string().describe("Identifiant CVE, ex. CVE-2024-12345"),
      }),
      execute: traced(ctx, "cve_detail", ({ cveId }: { cveId: string }) => cveDetail(cveId)),
    }),
  };
}
