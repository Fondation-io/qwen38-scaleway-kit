export interface ToolCallGuardDecision {
  allowed: boolean;
  reason?: string;
}

export interface ToolCallGuard {
  claim(name: string, args: unknown): ToolCallGuardDecision;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function fingerprint(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(canonicalize(args))}`;
}

export function createToolCallGuard(
  limits: Readonly<Record<string, number>> = { sql_query: 12 },
): ToolCallGuard {
  const seen = new Set<string>();
  const counts = new Map<string, number>();

  return {
    claim(name, args) {
      const key = fingerprint(name, args);
      if (seen.has(key)) {
        return {
          allowed: false,
          reason: `Appel identique déjà exécuté dans ce run : ${name}. Relis son résultat et conclus.`,
        };
      }

      const count = counts.get(name) ?? 0;
      const limit = limits[name];
      if (limit !== undefined && count >= limit) {
        return {
          allowed: false,
          reason: `Budget de ${limit} appels ${name} atteint dans ce run. N'explore plus : conclus avec les preuves disponibles.`,
        };
      }

      seen.add(key);
      counts.set(name, count + 1);
      return { allowed: true };
    },
  };
}
