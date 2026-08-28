// Outils de recherche autonome pour l'assistant de sécurité : recherche web
// (Serper), réponse sourcée (Perplexity), récupération de page (fetch), et
// recherche/détail de CVE (NVD). Implémentations pures — le câblage `tool()` +
// traçabilité se fait dans lib/tools.ts. Clés via env (SERPER_API_KEY,
// PERPLEXITY_API_KEY, NVD_API_KEY optionnelle).

const UA = "qwen38-demo-security-assistant/1.0";

// --- Recherche web (Serper / Google) ---
export async function webSearch(
  query: string,
  num = 6,
): Promise<Record<string, unknown>> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { error: "SERPER_API_KEY non configurée sur le serveur." };
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify({ q: query, num }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { error: `Serper HTTP ${res.status}` };
  const d = (await res.json()) as {
    organic?: { title?: string; link?: string; snippet?: string }[];
    answerBox?: { answer?: string; snippet?: string };
  };
  return {
    query,
    answer: d.answerBox?.answer ?? d.answerBox?.snippet,
    results: (d.organic ?? []).slice(0, num).map((o) => ({
      title: o.title,
      link: o.link,
      snippet: o.snippet,
    })),
  };
}

// --- Réponse sourcée (Perplexity sonar) ---
export async function askPerplexity(
  question: string,
): Promise<Record<string, unknown>> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return { error: "PERPLEXITY_API_KEY non configurée sur le serveur." };
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: question }],
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) return { error: `Perplexity HTTP ${res.status}` };
  const d = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    citations?: string[];
    search_results?: { url?: string; title?: string }[];
  };
  return {
    answer: d.choices?.[0]?.message?.content,
    citations: d.citations ?? (d.search_results ?? []).map((s) => s.url),
  };
}

// --- Récupération de page (avec garde SSRF) ---
function safeUrl(u: string): URL | null {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const h = url.hostname.toLowerCase();
  const blocked =
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "::1" ||
    h === "[::1]" ||
    h.startsWith("fd") ||
    h.startsWith("fe80");
  return blocked ? null : url;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchUrl(
  u: string,
  maxChars = 6000,
): Promise<Record<string, unknown>> {
  const url = safeUrl(u);
  if (!url)
    return {
      error: "URL refusée : seuls http/https publics sont autorisés (pas d'adresse interne).",
    };
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = ct.includes("html") ? htmlToText(raw) : raw;
    return {
      url: url.toString(),
      status: res.status,
      contentType: ct,
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// --- CVE (NVD) ---
const NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0";

type NvdCve = {
  id: string;
  published?: string;
  descriptions?: { lang: string; value: string }[];
  metrics?: Record<string, { cvssData?: Record<string, unknown>; baseSeverity?: string }[]>;
  weaknesses?: { description?: { value: string }[] }[];
  references?: { url: string }[];
};

function summarizeCve(cve: NvdCve, full = false): Record<string, unknown> {
  const desc = cve.descriptions?.find((x) => x.lang === "en")?.value ?? "";
  const m = cve.metrics ?? {};
  const cvss =
    m.cvssMetricV31?.[0]?.cvssData ??
    m.cvssMetricV30?.[0]?.cvssData ??
    m.cvssMetricV2?.[0]?.cvssData;
  const cwe = (cve.weaknesses ?? [])
    .flatMap((w) => w.description?.map((x) => x.value) ?? [])
    .filter((x) => x && x !== "NVD-CWE-noinfo");
  const base: Record<string, unknown> = {
    id: cve.id,
    published: cve.published?.slice(0, 10),
    severity:
      (cvss?.baseSeverity as string) ?? m.cvssMetricV31?.[0]?.baseSeverity,
    score: cvss?.baseScore,
    vector: cvss?.vectorString,
    cwe: cwe.slice(0, 3),
    description: full ? desc : desc.slice(0, 300),
  };
  if (full) base.references = (cve.references ?? []).slice(0, 8).map((r) => r.url);
  return base;
}

async function nvd(params: URLSearchParams): Promise<Record<string, unknown>> {
  const key = process.env.NVD_API_KEY;
  const res = await fetch(`${NVD}?${params}`, {
    headers: key ? { apiKey: key } : {},
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return { error: `NVD HTTP ${res.status}` };
  return (await res.json()) as Record<string, unknown>;
}

export async function cveSearch(
  keyword: string,
  opts: { exact?: boolean; limit?: number } = {},
): Promise<Record<string, unknown>> {
  const limit = Math.min(opts.limit ?? 10, 40);
  // Le modèle encadre souvent le mot-clé de guillemets (consigne cve.org) : NVD
  // les cherche alors littéralement → 0 résultat. keywordExactMatch fait déjà le
  // filtre phrase, on retire donc les guillemets encadrants.
  const cleaned = keyword.trim().replace(/^["']+|["']+$/g, "").trim();
  const params = new URLSearchParams({
    keywordSearch: cleaned,
    resultsPerPage: String(limit),
  });
  if (opts.exact) params.set("keywordExactMatch", "");
  const d = await nvd(params);
  if (d.error) return d;
  const vulns = (d.vulnerabilities as { cve: NvdCve }[] | undefined) ?? [];
  return {
    keyword,
    total: d.totalResults,
    count: vulns.length,
    results: vulns.map((v) => summarizeCve(v.cve)),
  };
}

// Recherche SÉMANTIQUE locale/confidentielle via le service RAG indépendant
// (index CVE IBM i + bulletins, embeddings locaux). La requête ne sort pas.
export async function cveRag(
  query: string,
  k = 6,
): Promise<Record<string, unknown>> {
  const base = process.env.CVE_RAG_URL;
  if (!base) return { error: "CVE_RAG_URL non configurée (service RAG absent)." };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, k }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { error: `RAG HTTP ${res.status}` };
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cveDetail(cveId: string): Promise<Record<string, unknown>> {
  const d = await nvd(new URLSearchParams({ cveId }));
  if (d.error) return d;
  const v = (d.vulnerabilities as { cve: NvdCve }[] | undefined)?.[0]?.cve;
  if (!v) return { error: `CVE ${cveId} introuvable.` };
  return summarizeCve(v, true);
}
