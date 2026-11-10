/**
 * The one command-flag renderer.
 *
 * Every surface — editor preview, saved-design strip, profile banner, lobby row
 * — draws from this function, so a design cannot look different depending on
 * where it is shown. It renders inline SVG from a validated composition; no
 * image request, no canvas, no uploaded bytes.
 */
import {
  fallbackComposition,
  flagColorHex,
  flagColorRgb,
  flagEmblem,
  type FlagComposition,
  type FlagShape,
} from '../identity/flag';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shapeMarkup(shape: FlagShape, fill: string): string {
  switch (shape.kind) {
    case 'polygon':
      return `<polygon points="${shape.points}" fill="${fill}"/>`;
    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${fill}"/>`;
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${fill}"/>`;
    case 'path':
      return shape.stroke
        ? `<path d="${shape.d}" fill="none" stroke="${fill}" stroke-width="${shape.stroke}" stroke-linecap="round"/>`
        : `<path d="${shape.d}" fill="${fill}"/>`;
  }
}

function backgroundMarkup(composition: FlagComposition): string {
  const { kind, primary, secondary } = composition.background;
  const first = flagColorHex(primary);
  const second = flagColorHex(secondary);
  switch (kind) {
    case 'splitH':
      return `<rect width="300" height="100" fill="${first}"/><rect y="100" width="300" height="100" fill="${second}"/>`;
    case 'splitV':
      return `<rect width="150" height="200" fill="${first}"/><rect x="150" width="150" height="200" fill="${second}"/>`;
    case 'splitD':
      return `<rect width="300" height="200" fill="${first}"/><polygon points="0,200 300,0 300,200" fill="${second}"/>`;
    case 'gradient':
      return `<rect width="300" height="200" fill="url(#${gradientId(primary, secondary)})"/>`;
    case 'solid':
    default:
      return `<rect width="300" height="200" fill="${first}"/>`;
  }
}

function gradientId(primary: string, secondary: string): string {
  return `cf-${primary}-${secondary}`;
}

function stripeMarkup(composition: FlagComposition): string {
  const stripe = composition.stripe;
  if (stripe.kind === 'none') return '';
  const fill = flagColorHex(stripe.color);
  const band = stripe.width * 2.2;
  switch (stripe.kind) {
    case 'horizontal':
      return `<rect x="0" y="${(200 - band) / 2}" width="300" height="${band}" fill="${fill}"/>`;
    case 'vertical':
      return `<rect x="${(300 - band) / 2}" y="0" width="${band}" height="200" fill="${fill}"/>`;
    case 'diagonal':
      return `<polygon points="0,${130 - band} 300,${70 - band} 300,${70 + band} 0,${130 + band}" fill="${fill}"/>`;
    case 'cross':
      return `<rect x="0" y="${(200 - band) / 2}" width="300" height="${band}" fill="${fill}"/><rect x="${(300 - band) / 2}" y="0" width="${band}" height="200" fill="${fill}"/>`;
  }
}

function borderMarkup(composition: FlagComposition): string {
  const border = composition.border;
  if (border.kind === 'none') return '';
  const color = flagColorHex(border.color);
  if (border.kind === 'thin') {
    return `<rect x="4" y="4" width="292" height="192" fill="none" stroke="${color}" stroke-width="5"/>`;
  }
  if (border.kind === 'double') {
    return `<rect x="4" y="4" width="292" height="192" fill="none" stroke="${color}" stroke-width="4"/><rect x="14" y="14" width="272" height="172" fill="none" stroke="${color}" stroke-width="2"/>`;
  }
  const arm = 34;
  const width = 5;
  const lines = [
    `M4 ${arm} V4 H${arm}`,
    `M${300 - arm} 4 H296 V${arm}`,
    `M296 ${200 - arm} V196 H${300 - arm}`,
    `M4 ${200 - arm} V196 H${arm}`,
  ];
  return `<path d="${lines.join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
}

function emblemMarkup(composition: FlagComposition): string {
  const emblem = composition.emblem;
  if (!emblem) return '';
  const def = flagEmblem(emblem.id);
  if (!def) return '';
  const color = flagColorHex(emblem.color);
  const scale = 0.9 * emblem.scale * (emblem.mirror ? -1 : 1);
  const transform = `translate(${150 + emblem.x * 3} ${100 + emblem.y * 3}) rotate(${emblem.rotate}) scale(${scale} ${0.9 * emblem.scale}) translate(-50 -50)`;
  return `<g transform="${transform}">${def.shapes.map((shape) => shapeMarkup(shape, color)).join('')}</g>`;
}

function decorationMarkup(composition: FlagComposition): string {
  return composition.decorations
    .map((decoration) => {
      const color = flagColorHex(decoration.color);
      const x = 150 + decoration.x * 3;
      const y = 100 + decoration.y * 3;
      const s = decoration.scale;
      const transform = `translate(${x} ${y}) rotate(${decoration.rotate}) scale(${s})`;
      switch (decoration.id) {
        case 'dot':
          return `<circle cx="0" cy="0" r="7" fill="${color}" transform="${transform}"/>`;
        case 'bar':
          return `<rect x="-14" y="-3" width="28" height="6" fill="${color}" transform="${transform}"/>`;
        case 'chevron':
          return `<polygon points="0,-10 14,4 8,10 0,3 -8,10 -14,4" fill="${color}" transform="${transform}"/>`;
        case 'star':
        default:
          return `<polygon points="0,-12 3.5,-4 12,-4 5,1.5 7.5,10 0,5 -7.5,10 -5,1.5 -12,-4 -3.5,-4" fill="${color}" transform="${transform}"/>`;
      }
    })
    .join('');
}

export interface FlagRenderOptions {
  /** Width in CSS pixels; height follows the 3:2 flag ratio. */
  size?: number;
  className?: string;
  /** Accessible name. Without one the flag is decorative. */
  title?: string;
}

/**
 * Render one command flag. An unreadable composition falls back to a neutral
 * flag rather than throwing, so an old or damaged save cannot break a screen.
 */
export function commandFlagSvg(composition: FlagComposition, options: FlagRenderOptions = {}): string {
  const safe = composition ?? fallbackComposition();
  const size = Math.max(24, Math.min(1024, Math.round(options.size ?? 300)));
  const height = Math.round((size * 2) / 3);
  const className = options.className ? ` class="${esc(options.className)}"` : '';
  const title = options.title
    ? `<title>${esc(options.title)}</title>`
    : '';
  const role = options.title ? 'img' : 'presentation';
  const gradient = safe.background.kind === 'gradient';
  const rgb = flagColorRgb(safe.background.primary);
  const rgb2 = flagColorRgb(safe.background.secondary);
  return `<svg${className} width="${size}" height="${height}" viewBox="0 0 300 200" role="${role}" aria-hidden="${options.title ? 'false' : 'true'}" focusable="false" xmlns="http://www.w3.org/2000/svg">${title}${
    gradient
      ? `<defs><linearGradient id="${gradientId(safe.background.primary, safe.background.secondary)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${rgb})"/><stop offset="1" stop-color="rgb(${rgb2})"/></linearGradient></defs>`
      : ''
  }${backgroundMarkup(safe)}${stripeMarkup(safe)}${emblemMarkup(safe)}${decorationMarkup(safe)}${borderMarkup(safe)}</svg>`;
}

/** A flag with no authored design, used before a player has saved one. */
export function defaultCommandFlagSvg(options: FlagRenderOptions = {}): string {
  return commandFlagSvg(fallbackComposition(), options);
}

/**
 * The flag as a CSS background value, for surfaces that place an identity mark
 * in a circular or square frame and cannot nest an SVG.
 */
export function commandFlagTile(composition: FlagComposition, size = 96): string {
  return commandFlagSvg(composition, { size, className: 'command-flag-tile' });
}
