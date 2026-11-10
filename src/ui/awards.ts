/**
 * Award artwork.
 *
 * Awards are service records, not cosmetics, and they are drawn — not imported
 * — so the same catalogue renders identically everywhere without shipping
 * copyrighted medal scans. Every shape is deterministic from the award's
 * `visual` token: the same ribbon always has the same stripes, and no award is
 * randomised between sessions. No gradients or filters mean no duplicate SVG
 * ids when a whole decoration rack is on one page.
 */
import type { AwardDefinition, AwardType } from '../accounts/achievements';
import { escapeCareerHtml } from './careerView';

/** Restrained service palette: no neon, no pure white metal. */
const ENAMEL = ['#2c4a6b', '#6b2c33', '#2f5340', '#6a5220', '#3d3f52', '#4a3357', '#24555a'] as const;
const METAL: Record<AwardType, { face: string; edge: string; mark: string }> = {
  medal: { face: '#c9b071', edge: '#8a7440', mark: '#f3e6be' },
  ribbon: { face: '#d8d3c4', edge: '#8d8878', mark: '#4a4a44' },
  commendation: { face: '#a9805a', edge: '#6d5038', mark: '#efdcc4' },
};

const TYPE_LABEL: Record<AwardType, string> = {
  medal: 'Medal',
  ribbon: 'Ribbon',
  commendation: 'Commendation',
};

export function awardTypeLabel(type: AwardType): string {
  return TYPE_LABEL[type];
}

/** Stable 32-bit hash so a token's palette never changes between builds. */
function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function enamelFor(token: string): string {
  return ENAMEL[hashToken(token) % ENAMEL.length];
}

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return points.join(' ');
}

function ribbonStripes(token: string, width: number, height: number): string {
  const enamel = enamelFor(token);
  const seed = hashToken(token);
  // Two to four stripes, symmetric about the centre, from a fixed set.
  const count = 2 + (seed % 3);
  const stripes: string[] = [];
  for (let i = 0; i < count; i++) {
    const offset = ((i + 1) / (count + 1)) * width;
    const w = 2 + ((seed >> (i * 3)) % 3);
    stripes.push(
      `<rect x="${(offset - w / 2).toFixed(2)}" y="0" width="${w}" height="${height}" fill="${enamel}" />`,
    );
  }
  return stripes.join('');
}

function medalSvg(award: AwardDefinition, label: string): string {
  const metal = METAL.medal;
  const enamel = enamelFor(award.visual);
  return `<svg viewBox="0 0 64 96" role="img" aria-label="${label}" focusable="false">
    <path d="M20 2h24l-6 30-6 8-6-8z" fill="${metal.face}" stroke="${metal.edge}" stroke-width="1.2" />
    ${ribbonStripes(award.visual, 64, 30).replace(/y="0"/g, 'y="2"').replace(/height="30"/g, 'height="28"')}
    <circle cx="32" cy="64" r="24" fill="${metal.face}" stroke="${metal.edge}" stroke-width="1.5" />
    <circle cx="32" cy="64" r="16" fill="${enamel}" stroke="${metal.edge}" stroke-width="1" />
    <polygon points="${starPoints(32, 64, 9, 4)}" fill="${metal.mark}" />
  </svg>`;
}

function ribbonSvg(award: AwardDefinition, label: string): string {
  const metal = METAL.ribbon;
  return `<svg viewBox="0 0 64 22" role="img" aria-label="${label}" focusable="false">
    <rect x="1" y="1" width="62" height="20" fill="${metal.face}" stroke="${metal.edge}" stroke-width="1.2" />
    ${ribbonStripes(award.visual, 64, 22)}
    <rect x="1" y="1" width="62" height="20" fill="none" stroke="${metal.edge}" stroke-width="1.2" />
  </svg>`;
}

function commendationSvg(award: AwardDefinition, label: string): string {
  const metal = METAL.commendation;
  const enamel = enamelFor(award.visual);
  return `<svg viewBox="0 0 64 64" role="img" aria-label="${label}" focusable="false">
    <circle cx="32" cy="32" r="26" fill="${metal.face}" stroke="${metal.edge}" stroke-width="1.6" />
    <circle cx="32" cy="32" r="21" fill="none" stroke="${metal.edge}" stroke-width="0.9" opacity="0.7" />
    <polygon points="${starPoints(32, 32, 15, 6)}" fill="${enamel}" stroke="${metal.edge}" stroke-width="0.8" />
    <circle cx="32" cy="32" r="3" fill="${metal.mark}" />
  </svg>`;
}

export interface AwardRenderOptions {
  className?: string;
  /** Rendered width in CSS pixels; height follows the award's proportions. */
  size?: number;
}

/** One award, drawn at its natural proportions. */
export function awardSvg(award: AwardDefinition, options: AwardRenderOptions = {}): string {
  const label = escapeCareerHtml(`${award.name} — ${TYPE_LABEL[award.type]}`);
  const body =
    award.type === 'medal'
      ? medalSvg(award, label)
      : award.type === 'ribbon'
        ? ribbonSvg(award, label)
        : commendationSvg(award, label);
  const size = options.size;
  const style = size ? ` style="width:${Math.max(16, Math.round(size))}px"` : '';
  return `<span class="award-art award-art-${award.type}${options.className ? ` ${escapeCareerHtml(options.className)}` : ''}" data-award-type="${award.type}"${style}>${body}</span>`;
}

/** A compact award chip: artwork, name and — when known — the date earned. */
export function awardChipMarkup(
  award: AwardDefinition,
  options: { awardedAt?: number | null; locked?: boolean; description?: string } = {},
): string {
  const locked = options.locked === true;
  const date = options.awardedAt ? new Date(options.awardedAt).toISOString().slice(0, 10) : null;
  const description = options.description ?? award.description;
  return `<li class="award-chip" data-award-type="${award.type}" data-state="${locked ? 'locked' : 'earned'}" data-award="${escapeCareerHtml(award.id)}">
    ${awardSvg(award, { size: award.type === 'medal' ? 30 : award.type === 'ribbon' ? 42 : 30 })}
    <span class="award-chip-text">
      <b>${escapeCareerHtml(locked ? (award.hidden ? 'Classification withheld' : award.name) : award.name)}</b>
      <small>${escapeCareerHtml(locked ? (award.hidden ? 'Earn this award to reveal its citation.' : TYPE_LABEL[award.type]) : TYPE_LABEL[award.type])}${date ? ` · ${date}` : ''}</small>
      ${locked ? '' : `<span class="award-chip-citation">${escapeCareerHtml(description)}</span>`}
    </span>
  </li>`;
}
