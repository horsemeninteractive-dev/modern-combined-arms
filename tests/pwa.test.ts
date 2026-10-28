import { describe, expect, it } from 'vitest';
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

  it('plays the engine plate after the studio sting', () => {
    const engine = html.indexOf('class="intro-engine"');
    const studio = html.indexOf('class="intro-frame"');
    expect(studio).toBeGreaterThan(-1);
    expect(engine).toBeGreaterThan(studio);
    expect(html).toContain('/irontide-mark.svg');
    expect(html).toContain('Irontide');
  });
});
