// Logo/pastille par provider. Marques simples (lettermark colorée) faciles à
// remplacer par les vrais SVG de marque quand on les a. Fallback : 1re lettre.

const STYLES: Record<string, { bg: string; fg: string; text: string }> = {
  near_ai: { bg: "#000000", fg: "#ffffff", text: "N" },
  vllm: { bg: "#111827", fg: "#a5b4fc", text: "v" },
  baseten: { bg: "#1a1a2e", fg: "#22d3ee", text: "B" },
};

export function ProviderLogo({
  provider,
  label,
  className,
}: {
  provider: string;
  label?: string;
  className?: string;
}) {
  const s =
    STYLES[provider] ??
    {
      bg: "#374151",
      fg: "#e5e7eb",
      text: (label ?? provider).charAt(0).toUpperCase(),
    };
  return (
    <span
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${className ?? ""}`}
      style={{ backgroundColor: s.bg, color: s.fg }}
      aria-hidden
    >
      {s.text}
    </span>
  );
}
