/**
 * Multi-level variant resolution for roster content.
 *
 * A definition may declare `variantOf` pointing at the slot or platform it
 * refines. That is how a national replacement keeps its family's production
 * slot without a parallel alias table. One hop was enough while an alliance
 * baseline *was* the canonical slot, but the roster design needs
 *
 *   canonical slot → alliance platform → national replacement
 *
 * so resolution must walk the whole chain and report the canonical root.
 *
 * Resolution never throws: a broken chain (unknown target, self-reference,
 * cycle or excessive depth) returns a diagnostic and keeps the queried id as
 * the root, so a damaged definition is never folded into an unrelated slot.
 * The content registry converts the diagnostic into a hard failure through
 * `validateVariantChains`.
 */

export interface VariantNode {
  variantOf?: string;
}

/**
 * Defensive bound on chain length. Cycles are already rejected by identity, so
 * this only stops pathologically deep (or deliberately abusive) authored data
 * from producing an unbounded walk. The longest chain the design ever needs is
 * three levels: canonical slot, alliance platform, national replacement.
 */
export const MAX_VARIANT_DEPTH = 8;

export interface VariantChain {
  /** Canonical slot id: the last definition with no `variantOf`. On error, the queried id. */
  readonly root: string;
  /** Definitions walked, from the queried id towards the root (or to the failure). */
  readonly path: readonly string[];
  /** Diagnostic when the chain does not reach a canonical slot. */
  readonly error?: string;
}

function chainLabel(path: readonly string[], extra?: string): string {
  return extra === undefined ? path.join(' → ') : [...path, extra].join(' → ');
}

export function resolveVariantChain(
  registry: Readonly<Record<string, VariantNode | undefined>>,
  id: string,
): VariantChain {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = id;

  for (;;) {
    if (seen.has(current)) {
      return { root: id, path, error: `variant chain ${chainLabel(path)} is circular` };
    }
    seen.add(current);
    path.push(current);

    const def = registry[current];
    if (!def) {
      return { root: id, path, error: `variant chain ${chainLabel(path)} names an unknown definition` };
    }

    const next = def.variantOf;
    if (next === undefined) return { root: current, path };
    if (typeof next !== 'string' || next.length === 0) {
      return { root: id, path, error: `definition "${current}" has an invalid variantOf value` };
    }
    if (next === current) {
      return { root: id, path, error: `definition "${current}" is variantOf itself` };
    }
    if (seen.has(next)) {
      return {
        root: id,
        path,
        error: `variant chain ${chainLabel(path, next)} is circular`,
      };
    }
    if (path.length >= MAX_VARIANT_DEPTH) {
      return {
        root: id,
        path,
        error: `variant chain ${chainLabel(path, next)} is longer than ${MAX_VARIANT_DEPTH} levels`,
      };
    }
    current = next;
  }
}
