import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import manifestRaw from '../public/manifest.webmanifest?raw';
import swRaw from '../public/sw.js?raw';
import html from '../index.html?raw';

describe('installable app', () => {
  const manifest = JSON.parse(manifestRaw) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    orientation: string;
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
  };

  it('declares a launchable, landscape game shell', () => {
    expect(manifest.name).toBe('MCA: Modern Combined Arms');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('fullscreen');
    // The portrait gate is the runtime half of this promise.
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ships the icon sizes an install prompt asks for', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) expect(icon.src.startsWith('/')).toBe(true);
  });

  it('links the manifest and touch icon from the document', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/icon-180\.png"/);
    expect(html).toMatch(/<meta name="theme-color"/);
    expect(html).toMatch(/apple-mobile-web-app-capable/);
  });

  it('precaches the shell and serves navigations offline', () => {
    expect(swRaw).toContain("'/index.html'");
    expect(swRaw).toContain("'/icons/icon-192.png'");
    expect(swRaw).toContain("'/irontide-mark.svg'");
    expect(swRaw).toMatch(/request\.mode === 'navigate'/);
    expect(swRaw).toMatch(/caches\.match\('\/index\.html'/);
    // Host assets are served with Vary: Origin, which would otherwise miss the
    // precached copy on a module or navigation request.
    expect(swRaw).toContain('ignoreVary: true');
  });

  it('publishes a 1200×630 social card with an absolute hero URL', () => {
    const origin = 'https://moderncombinedarms.pages.dev';
    // Crawlers do not resolve relative OG image URLs, so these must be absolute.
    expect(html).toContain(`property="og:image"\n      content="${origin}/og-mca.jpg"`);
    expect(html).toContain(`property="og:url" content="${origin}/"`);
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`name="twitter:image" content="${origin}/og-mca.jpg"`);
    expect(html).toContain(`<link rel="canonical" href="${origin}/" />`);

    const hero = readFileSync(new URL('../public/og-mca.jpg', import.meta.url));
    expect(hero.length).toBeGreaterThan(20_000);
    // JPEG SOI, so the card is a real image rather than a placeholder path.
    expect(hero[0]).toBe(0xff);
    expect(hero[1]).toBe(0xd8);
  });

  it('plays the engine plate after the studio sting', () => {
    const engine = html.indexOf('class="intro-engine"');
    const studio = html.indexOf('class="intro-frame"');
    expect(studio).toBeGreaterThan(-1);
    expect(engine).toBeGreaterThan(studio);
    expect(html).toContain('/irontide-mark.svg');
    expect(html).toContain('Irontide');
  });
});
