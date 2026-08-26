"use client";

import { useEffect } from "react";

// Error boundary de segment : capte un crash de rendu dans l'app sans
// blanchir toute la page, et le rapporte au journal d'audit.
export default function Error({
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
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">Une erreur est survenue</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          L&apos;incident a été journalisé. Réessayez sans recharger.
        </p>
        <pre className="text-destructive bg-muted/50 mt-4 overflow-x-auto rounded-md p-3 text-left text-xs">
          {error.message}
        </pre>
        <button
          onClick={() => reset()}
          className="bg-foreground text-background mt-4 rounded-md px-4 py-2 text-sm"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
