// Next.js instrumentation : exécuté au démarrage du serveur. Attache des
// gardes de dernier recours pour qu'aucune erreur non gérée ne tue le
// process (donc pas de coupure en pleine démo) — chaque incident est tracé.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { audit, auditFireAndForget } = await import("@/lib/audit");

  await audit("boot", "startup", {
    model: process.env.VLLM_MODEL,
    node: process.version,
  });

  process.on("unhandledRejection", (reason) => {
    auditFireAndForget("process", "process_error", {
      kind: "unhandledRejection",
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on("uncaughtException", (err) => {
    // On journalise et on NE quitte PAS : un crash isolé ne doit pas
    // interrompre la démo. Le conteneur reste debout.
    auditFireAndForget("process", "process_error", {
      kind: "uncaughtException",
      error: err.message,
      stack: err.stack,
    });
  });
}
