import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { runQuery } from "@/lib/db";
import { assessRisk, guardDb2 } from "@/lib/sql-guard";
import { db2Call, db2Query } from "@/lib/db2";
import { createSkillSession, getSkillCatalog, skillCatalogSummary } from "@/lib/agent-skills";
import {
  arithmeticBatchSchema,
  dateBatchSchema,
  runArithmeticBatch,
  runDateBatch,
} from "@/lib/deterministic-calculation";
import { createToolCallGuard, type ToolCallGuard } from "@/lib/tool-call-guard";
import type { Profile, ProfilePolicy, Workspace } from "@/lib/profiles";
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
    if (Array.isArray(o.rows)) return { rowCount: o.rowCount ?? (o.rows as unknown[]).length };
    if (typeof o.chartUrl === "string") return { chartUrl: o.chartUrl };
  }
  return {};
}

export interface ToolContext {
  traceId: string;
  callGuard?: ToolCallGuard;
  // Profil actif : politique de gating appliquée au tool serveur sql_query.
  profilePolicy?: ProfilePolicy;
  // Profil complet (workspace gestion : porte le compte Db2 et les droits d'écriture).
  profile?: Profile;
}

// Plafonne un résultat SQL avant de le renvoyer au modèle (économie de contexte),
// même logique que la carte client : ≤ 60 lignes et ≤ 6000 caractères sérialisés.
const MAX_MODEL_ROWS = 60;
const MAX_MODEL_CHARS = 6000;
function capRows(result: { columns: string[]; rows: unknown[]; rowCount: number }) {
  let rows = result.rows.slice(0, MAX_MODEL_ROWS);
  while (rows.length > 5 && JSON.stringify(rows).length > MAX_MODEL_CHARS) {
    rows = rows.slice(0, Math.ceil(rows.length * 0.7));
  }
  return rows.length === result.rows.length ? result : { ...result, rows, truncated: true };
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
    const guardDecision = ctx.callGuard?.claim(name, args);
    if (guardDecision && !guardDecision.allowed) {
      await audit(ctx.traceId, "tool_result", {
        tool: name,
        ok: false,
        blocked: true,
        durationMs: Date.now() - started,
        reason: guardDecision.reason,
      });
      return { blocked: true, reason: guardDecision.reason };
    }
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
      execute: traced(ctx, "web_search", ({ query, num }: { query: string; num?: number }) =>
        webSearch(query, num),
      ),
    }),
    ask_perplexity: tool({
      description:
        "Pose une question à Perplexity (réponse synthétique SOURCÉE avec citations). Utile pour une réponse déjà agrégée à une question de veille/menace plutôt qu'une liste de liens.",
      inputSchema: z.object({
        question: z.string().describe("Question en langage naturel"),
      }),
      execute: traced(ctx, "ask_perplexity", ({ question }: { question: string }) =>
        askPerplexity(question),
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

function makeLoadSkillTool(ctx: ToolContext, workspace: Workspace) {
  const session = createSkillSession(getSkillCatalog(), workspace);
  const names = session.skills.map((skill) => skill.name);
  if (names.length === 0) {
    throw new Error(`Aucune skill disponible pour le workspace ${workspace}`);
  }

  return tool({
    description: `Charge une méthode d'analyse de confiance adaptée au contexte. Catalogue autorisé :\n${skillCatalogSummary(session.skills)}`,
    inputSchema: z.object({
      name: z.enum(names as [string, ...string[]]).describe("Skill méthodologique à charger"),
    }),
    execute: traced(ctx, "load_skill", async ({ name }: { name: string }) => session.load(name)),
  });
}

function deterministicCalculationTools(ctx: ToolContext) {
  return {
    calculator: tool({
      description:
        'OBLIGATOIRE pour toute valeur arithmétique dérivée, même triviale : somme, différence, produit, division, moyenne, médiane, minimum, maximum, ratio, pourcentage, évolution ou arrondi. Fournis les nombres comme chaînes décimales. Pour percentage_change, values = [base, nouvelle valeur] et baseLabel/comparedLabel sont obligatoires. Dans la réponse, recopie mot pour mot canonicalStatement ou reverseStatement retourné ; n\'inverse jamais toi-même le sens de la comparaison. Pour réutiliser un résultat précédent du même batch, passe {ref:"id"} au lieu de recopier ou deviner le nombre. Réutilise exactement le résultat retourné ; ne calcule jamais toi-même.',
      inputSchema: arithmeticBatchSchema,
      execute: traced(ctx, "calculator", async (args) => runArithmeticBatch(args)),
    }),
    date_calculator: tool({
      description:
        "OBLIGATOIRE pour toute différence ou conversion de date/durée et pour ajouter ou soustraire une durée. Les dates simples sont interprétées en UTC ; tout timestamp doit inclure Z ou un décalage explicite. Réutilise exactement le résultat retourné ; ne calcule jamais toi-même.",
      inputSchema: dateBatchSchema,
      execute: traced(ctx, "date_calculator", async (args) => runDateBatch(args)),
    }),
  };
}

// ---------------------------------------------------------------------------
// Workspace GESTION : outils sur la base Db2 réelle (GESTION/OLIST) via la
// passerelle db2-gw. La gate Db2 est choisie par le WORKSPACE (jamais par la
// syntaxe) ; les GRANTs du compte Db2 du profil sont le 2ème étage. Les
// écritures ne passent QUE par set_order_status / record_payment (procédures
// stockées paramétrées), avec carte d'approbation pour l'opérateur.
// ---------------------------------------------------------------------------
export function makeGestionTools(ctx: ToolContext, opts: { allowWebSearch?: boolean } = {}) {
  ctx.callGuard ??= createToolCallGuard();
  const profile = ctx.profile;
  const role = profile?.db2Role ?? "analyste";
  const writeAccess = profile?.writeAccess ?? "none";

  // Écriture encadrée commune aux deux outils : refus (profil sans écriture),
  // carte d'approbation (opérateur), ou exécution directe de la procédure.
  async function framedWrite(
    proc: "SET_ORDER_STATUS" | "RECORD_PAYMENT",
    args: Record<string, unknown>,
  ) {
    if (writeAccess === "none") {
      return {
        blocked: true,
        reason:
          "Le profil actif n'a aucun droit d'écriture. Seul l'opérateur ADV (via approbation) ou l'admin peuvent modifier les données.",
      };
    }
    if (writeAccess === "procedures") {
      // Carte d'approbation : le modèle rappelle request_write_approval avec
      // les MÊMES arguments ; l'exécution passera par /api/db2-write.
      return { status: "approval_required", proc, args };
    }
    const res = await db2Call(proc, args, role);
    return "error" in res ? res : { ok: true, proc, args };
  }

  return {
    load_skill: makeLoadSkillTool(ctx, "gestion"),
    ...deterministicCalculationTools(ctx),
    sql_query: tool({
      description:
        "Exécute une requête SQL sur la base de gestion Db2 (schéma OLIST). SELECT/WITH uniquement — toute écriture passe par set_order_status ou record_payment. La requête s'exécute avec le compte Db2 du profil actif : un objet hors habilitation est refusé par la base (SQL0551N). Dialecte Db2 natif (FETCH FIRST n ROWS ONLY, YEAR(), MONTH(), DECIMAL()).",
      inputSchema: z.object({
        sql: z.string().describe("Requête SQL Db2 (SELECT ou WITH ... SELECT)"),
      }),
      execute: traced(ctx, "sql_query", async ({ sql }: { sql: string }) => {
        const verdict = guardDb2(sql, {
          unrestricted: writeAccess === "direct",
        });
        if (!verdict.ok) return { blocked: true, reason: verdict.reason };
        const res = await db2Query(sql, role);
        if ("error" in res) return res;
        return capRows(res);
      }),
    }),

    set_order_status: tool({
      description:
        "Change le statut d'une commande — SEULE voie autorisée pour cette écriture (procédure stockée paramétrée OLIST.SET_ORDER_STATUS, statuts validés côté base). Selon le profil : refus, carte d'approbation (rappelle alors request_write_approval avec les MÊMES arguments), ou exécution directe.",
      inputSchema: z.object({
        order_id: z.string().length(32).describe("Identifiant de commande (32 caractères)"),
        status: z
          .enum([
            "created",
            "approved",
            "processing",
            "invoiced",
            "shipped",
            "delivered",
            "canceled",
            "unavailable",
          ])
          .describe("Nouveau statut"),
      }),
      execute: traced(
        ctx,
        "set_order_status",
        ({ order_id, status }: { order_id: string; status: string }) =>
          framedWrite("SET_ORDER_STATUS", { order_id, status }),
      ),
    }),

    record_payment: tool({
      description:
        "Enregistre un paiement sur une commande — SEULE voie autorisée pour cette écriture (procédure stockée paramétrée OLIST.RECORD_PAYMENT : type et montant validés côté base, numéro de séquence calculé). Selon le profil : refus, carte d'approbation (rappelle alors request_write_approval avec les MÊMES arguments), ou exécution directe.",
      inputSchema: z.object({
        order_id: z.string().length(32).describe("Identifiant de commande (32 caractères)"),
        payment_type: z
          .enum(["credit_card", "boleto", "voucher", "debit_card"])
          .describe("Type de paiement"),
        installments: z.number().int().min(1).max(24).describe("Nombre d'échéances"),
        value: z.number().positive().describe("Montant (positif)"),
      }),
      execute: traced(
        ctx,
        "record_payment",
        (args: { order_id: string; payment_type: string; installments: number; value: number }) =>
          framedWrite("RECORD_PAYMENT", { ...args }),
      ),
    }),

    ...(opts.allowWebSearch ? webExternalTools(ctx) : {}),
  };
}

export function makeTools(ctx: ToolContext, opts: { allowWebSearch?: boolean } = {}) {
  ctx.callGuard ??= createToolCallGuard();
  return {
    load_skill: makeLoadSkillTool(ctx, "security"),
    ...deterministicCalculationTools(ctx),
    // sql_query est un tool SERVEUR : les requêtes NON sensibles s'exécutent
    // directement DANS le run streamText (pas de round-trip client), ce qui
    // permet au modèle d'enchaîner N requêtes en UNE génération — donc UN seul
    // préambule/raisonnement, sans la boucle « re-préambule à chaque requête »
    // qu'induisait un tool client. Le HITL (carte d'approbation) est conservé
    // pour les requêtes sensibles via le tool CLIENT `request_sql_approval` :
    // ici, une requête sensible renvoie {status:"approval_required"} et le modèle
    // rappelle request_sql_approval avec la même requête.
    sql_query: tool({
      description:
        "Exécute une requête SQL en lecture seule (SELECT/WITH) sur la base d'audit Db2 for i (schémas SECAUDIT et HONEYPOT). MÉTADONNÉES D'ABORD : sélectionne uniquement les colonnes nécessaires. Ne sélectionne pas object_preview pour confirmer un transfert : timestamp, user_profile et object_name suffisent. Tout contenu sensible en clair exige à la fois une demande explicite de l'utilisateur et un besoin indispensable au verdict ; sinon conclus avec les métadonnées. Si une lecture sensible justifiée renvoie {status:\"approval_required\"}, appelle request_sql_approval avec la MÊME requête. Une requête refusée renvoie {blocked:true}. Formule une requête claire et autoportante.",
      inputSchema: z.object({
        sql: z.string().describe("Requête SQL (SELECT ou WITH ... SELECT)"),
      }),
      execute: traced(ctx, "sql_query", async ({ sql }: { sql: string }) => {
        const risk = assessRisk(sql, ctx.profilePolicy);
        if (risk.blocked) return { blocked: true, reason: risk.reason };
        if (risk.risky) {
          return { status: "approval_required", reason: risk.reason, sql };
        }
        return capRows(runQuery(sql));
      }),
    }),
    describe_data: tool({
      description:
        "Retourne le profil des données (table data_profile) : pour chaque colonne, nombre de lignes, valeurs distinctes, nulls, min/max et valeurs les plus fréquentes. Filtrable par table.",
      inputSchema: z.object({
        table: z.string().optional().describe("Nom de table pour filtrer (optionnel)"),
      }),
      execute: traced(ctx, "describe_data", async ({ table }: { table?: string }) => {
        const where = table ? ` WHERE table_name = '${table.replace(/'/g, "''")}'` : "";
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
      }),
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
        async ({ user, start, end }: { user: string; start?: string; end?: string }) =>
          runChart("user_timeline", { user, start, end }),
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
        async ({ user, start, end }: { user: string; start?: string; end?: string }) =>
          runChart("transfer_sessions", { user, start, end }),
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
        async ({ start, end, top }: { start?: string; end?: string; top?: number }) =>
          runChart("after_hours", { start, end, top }),
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
        sigma: z.number().min(1).max(10).optional().describe("Seuil en écarts-types (défaut 3)"),
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
      execute: traced(ctx, "cve_rag", ({ query, k }: { query: string; k?: number }) =>
        cveRag(query, k),
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
