import { BUILDINGS } from '../data/buildings';
import { BUILDING_MODULES, installedModuleEffects } from '../data/research';

/**
 * The grid breakdown behind the power meter and the structure cards.
 *
 * The simulation only exposes totals (`Game.powerStatus`). A brownout is
 * diagnosed by seeing which structures are drawing and which are generating,
 * so this groups the player's operational buildings the same way the
 * simulation counts them: one entry per definition, with a count.
 */
export interface PowerStructure {
  defId: string;
  construction?: boolean;
  hp: number;
  /** Installed research modules, which can change the structure's grid draw. */
  modules?: readonly string[];
}

/** One grouped grid contributor: a definition, how many stand, and its total. */
export interface PowerLine {
  id: string;
  name: string;
  count: number;
  /** Power per structure: positive generates, negative draws. */
  each: number;
  total: number;
}

export interface GridReport {
  supply: number;
  demand: number;
  /** Supply over demand, clamped to 1 when balanced. */
  ratio: number;
  brownout: boolean;
  /** Generators, largest contribution first. */
  sources: PowerLine[];
  /** Consumers, largest draw first. */
  consumers: PowerLine[];
}

/** Structures under construction and rubble do not sit on the grid. */
function operational(structure: PowerStructure): boolean {
  return !structure.construction && structure.hp > 0;
}

function group(
  lines: Map<string, PowerLine>,
  id: string,
  name: string,
  each: number,
): void {
  const existing = lines.get(id);
  if (existing) {
    existing.count += 1;
    existing.total += each;
    return;
  }
  lines.set(id, { id, name, count: 1, each, total: each });
}

/** Modules are grouped separately so a brownout shows what the retrofit adds. */
function groupModule(lines: Map<string, PowerLine>, moduleId: string, each: number): void {
  const module = BUILDING_MODULES[moduleId];
  group(lines, `module:${moduleId}`, module?.name ?? moduleId, each);
}

/** Group a player's buildings into supply and demand lines, as the grid sees them. */
export function gridReport(structures: readonly PowerStructure[]): GridReport {
  const sources = new Map<string, PowerLine>();
  const consumers = new Map<string, PowerLine>();
  for (const structure of structures) {
    if (!operational(structure)) continue;
    const power = BUILDINGS[structure.defId]?.power ?? 0;
    if (power > 0) group(sources, structure.defId, BUILDINGS[structure.defId]?.name ?? structure.defId, power);
    else if (power < 0) {
      group(consumers, structure.defId, BUILDINGS[structure.defId]?.name ?? structure.defId, power);
    }
    for (const moduleId of structure.modules ?? []) {
      const modulePower = installedModuleEffects([moduleId]).power;
      if (modulePower > 0) groupModule(sources, moduleId, modulePower);
      else if (modulePower < 0) groupModule(consumers, moduleId, modulePower);
    }
  }
  const sourceLines = [...sources.values()].sort((a, b) => b.total - a.total);
  const consumerLines = [...consumers.values()].sort((a, b) => a.total - b.total);
  const supply = sourceLines.reduce((sum, line) => sum + line.total, 0);
  const demand = Math.abs(consumerLines.reduce((sum, line) => sum + line.total, 0));
  const brownout = demand > supply;
  return {
    supply,
    demand,
    ratio: brownout ? supply / demand : 1,
    brownout,
    sources: sourceLines,
    consumers: consumerLines,
  };
}

/** The grid's state word, shared by the meter, the cards and the hover readout. */
export type GridLoadState = 'brownout' | 'strained' | 'stable' | 'idle';

export const GRID_LOAD_LABEL: Readonly<Record<GridLoadState, string>> = Object.freeze({
  brownout: 'BROWNOUT',
  strained: 'STRAINED',
  stable: 'STABLE',
  idle: 'NO LOAD',
});

export function gridLoadState(
  supply: number,
  demand: number,
  brownout: boolean,
): GridLoadState {
  if (brownout) return 'brownout';
  if (demand <= 0) return 'idle';
  return demand / Math.max(1, supply) >= 0.85 ? 'strained' : 'stable';
}

/** One line of the gauge's hover readout, with its bar scaled to the column. */
export interface PowerReadoutRow extends PowerLine {
  /** Absolute total over the column's largest line, 0..1. */
  share: number;
}

export interface PowerReadout {
  state: GridLoadState;
  label: string;
  supply: number;
  demand: number;
  /** Largest generators, biggest first, capped at the requested limit. */
  sources: PowerReadoutRow[];
  /** Largest consumers, biggest draw first, capped at the requested limit. */
  consumers: PowerReadoutRow[];
  /** Lines left out of each column, reported rather than silently dropped. */
  hiddenSources: number;
  hiddenConsumers: number;
}

function readoutRows(lines: readonly PowerLine[], limit: number): PowerReadoutRow[] {
  const top = lines.slice(0, limit);
  const peak = top.reduce((max, line) => Math.max(max, Math.abs(line.total)), 0);
  return top.map((line) => ({
    ...line,
    share: peak > 0 ? Math.abs(line.total) / peak : 0,
  }));
}

/**
 * The rail gauge's hover copy: state, totals and the top contributors on each
 * side of the grid. A readout that lists every structure stops being glanceable
 * inside a brownout, so the largest few answer "what is drawing this?" and the
 * remainder is counted.
 */
export function powerReadout(report: GridReport, limit = 3): PowerReadout {
  const count = Math.max(1, Math.round(limit));
  const state = gridLoadState(report.supply, report.demand, report.brownout);
  return {
    state,
    label: GRID_LOAD_LABEL[state],
    supply: report.supply,
    demand: report.demand,
    sources: readoutRows(report.sources, count),
    consumers: readoutRows(report.consumers, count),
    hiddenSources: Math.max(0, report.sources.length - count),
    hiddenConsumers: Math.max(0, report.consumers.length - count),
  };
}

function formatLine(line: PowerLine): string {
  const total = line.total > 0 ? `+${line.total}` : `${line.total}`;
  return line.count > 1
    ? `${line.name} ×${line.count} ${total}`
    : `${line.name} ${total}`;
}

/**
 * The hover copy for a structure card, or for the grid meter itself when no
 * definition is supplied. Kept as plain lines so a native tooltip can show it
 * and a test can assert the arithmetic without a DOM.
 */
export function powerBreakdownLines(
  report: GridReport,
  def?: { id: string; name: string; power: number },
): string[] {
  const load = Math.round((report.demand / Math.max(1, report.supply)) * 100);
  const lines: string[] = [
    report.brownout
      ? `POWER GRID BROWNOUT — ${report.supply} supply / ${report.demand} demand (output ${Math.round(report.ratio * 100)}%)`
      : `POWER GRID — ${report.supply} supply / ${report.demand} demand (${load}% load)`,
  ];
  lines.push(
    report.sources.length > 0
      ? `Generators: ${report.sources.map(formatLine).join(', ')}`
      : 'Generators: none standing',
  );
  lines.push(
    report.consumers.length > 0
      ? `Draw: ${report.consumers.map(formatLine).join(', ')}`
      : 'Draw: no structures drawing',
  );
  if (def && def.power !== 0) {
    const supply = report.supply + Math.max(0, def.power);
    const demand = report.demand + Math.max(0, -def.power);
    lines.push(
      `${def.name}: ${def.power > 0 ? '+' : ''}${def.power} → grid after build ${supply} supply / ${demand} demand`,
    );
  }
  return lines;
}
