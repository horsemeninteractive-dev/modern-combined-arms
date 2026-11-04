/**
 * Rank badges, drawn from the descriptors in `accounts/ranks.ts`.
 *
 * The shapes are the vocabulary a real rank badge uses — chevrons, rockers,
 * bars, stars, a wreath — composed rather than copied from one army's insignia.
 * Everything is inline SVG in `currentColor`, so a badge inherits the rank
 * block's colour, prints, and needs no asset request.
 */
import type { RankSpec } from '../accounts/ranks';

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function star(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    points.push(`${round(cx + Math.cos(angle) * r)},${round(cy + Math.sin(angle) * r)}`);
  }
  return `<polygon points="${points.join(' ')}" fill="currentColor" stroke="none" />`;
}

function chevron(y: number): string {
  return `<path d="M13 ${round(y + 5.2)} L24 ${round(y)} L35 ${round(y + 5.2)}" />`;
}

function rocker(y: number): string {
  return `<path d="M14 ${round(y)} Q24 ${round(y + 5.4)} 34 ${round(y)}" />`;
}

function bar(y: number): string {
  return `<rect x="14" y="${round(y)}" width="20" height="3.4" fill="currentColor" stroke="none" />`;
}

function wreath(): string {
  return (
    `<path d="M10 25 Q6 18 11 10" />` +
    `<path d="M38 25 Q42 18 37 10" />` +
    `<path d="M13 24 Q9 19 13 13" opacity="0.55" />` +
    `<path d="M35 24 Q39 19 35 13" opacity="0.55" />`
  );
}

/**
 * One badge. `label` is the accessible name; the SVG itself is decorative when
 * the rank title is already rendered beside it.
 */
export function rankInsigniaSvg(rank: RankSpec, options: { label?: string; className?: string } = {}): string {
  const spec = rank.insignia;
  const parts: string[] = [];
  const hasChevrons = Boolean(spec.chevrons);
  const hasRockers = Boolean(spec.rockers);
  const hasStars = Boolean(spec.stars);
  const hasBars = Boolean(spec.bars);

  if (spec.wreath) parts.push(wreath());
  if (hasBars) {
    const count = Math.min(3, Math.max(1, spec.bars ?? 0));
    const startY = 15 - (count - 1) * 3.6;
    for (let i = 0; i < count; i++) parts.push(bar(startY + i * 4.2));
  }
  if (hasStars) {
    const count = Math.min(3, Math.max(1, spec.stars ?? 0));
    const radius = hasChevrons ? 3.1 : 5.2;
    const y = hasChevrons ? 5.4 : 12;
    const spread = radius * 2.6;
    const startX = 24 - ((count - 1) * spread) / 2;
    for (let i = 0; i < count; i++) parts.push(star(startX + i * spread, y, radius));
  }
  if (hasChevrons) {
    const count = Math.min(3, Math.max(1, spec.chevrons ?? 0));
    const startY = hasStars ? 10 : hasRockers ? 7 : hasBars ? 6 : 9;
    for (let i = 0; i < count; i++) parts.push(chevron(startY + i * 5.4));
  }
  if (hasRockers) {
    const count = Math.min(3, Math.max(1, spec.rockers ?? 0));
    const chevronCount = Math.min(3, Math.max(0, spec.chevrons ?? 0));
    const startY = hasChevrons ? 7 + chevronCount * 5.4 + 0.5 : 10;
    for (let i = 0; i < count; i++) parts.push(rocker(startY + i * 3.4));
  }

  const className = options.className ? ` class="${options.className}"` : '';
  const title = options.label ? `<title>${options.label.replace(/[<>&]/g, '')}</title>` : '';
  // Bars and stars are filled; chevrons, rockers and the wreath are strokes.
  const stroke = hasChevrons || hasRockers || spec.wreath ? ' stroke="currentColor" fill="none" stroke-width="2.1" stroke-linecap="round"' : '';
  return `<svg${className} viewBox="0 0 48 30" role="img" aria-hidden="${options.label ? 'false' : 'true'}" focusable="false">${title}<g${stroke}>${parts.join('')}</g></svg>`;
}
