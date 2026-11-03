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
