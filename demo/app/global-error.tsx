"use client";

import { useEffect } from "react";

// Remplace la page opaque « This page couldn't load » de Next par un écran
// lisible + rapporte l'erreur au journal d'audit serveur.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        url: typeof location !== "undefined" ? location.href : undefined,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0b",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 440, padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Une erreur est survenue
          </h1>
          <p style={{ fontSize: 14, color: "#a1a1a1", marginBottom: 16 }}>
            L&apos;incident a été journalisé. Vous pouvez réessayer sans
            recharger la page.
          </p>
          <pre
            style={{
              fontSize: 12,
              color: "#f87171",
              background: "#171717",
              padding: 12,
              borderRadius: 8,
              overflowX: "auto",
              marginBottom: 16,
            }}
          >
            {error.message}
          </pre>
          <button
            onClick={() => reset()}
            style={{
              fontSize: 14,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#fafafa",
              color: "#0b0b0b",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
