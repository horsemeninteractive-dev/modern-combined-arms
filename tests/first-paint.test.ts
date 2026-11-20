import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import main from '../src/main.ts?raw';
import app from '../src/app.ts?raw';

/**
 * The browser paints the document before the module bundle has injected the
 * game stylesheet, so the raw markup used to flash on a white page: an
 * oversized logo over an unformatted menu. The document therefore starts in a
 * `booting` state that hides #app behind a plain dark plate until main.ts has
 * the real styles live.
 */
describe('first paint', () => {
  it('starts in the booting state on a dark page', () => {
    expect(html).toMatch(/<html[^>]*\bclass="booting"/);
    expect(html).toMatch(/html\s*\{\s*background:\s*#04070a/);
    expect(html).toMatch(/html\.booting #app\s*\{[^}]*visibility:\s*hidden/);
  });

  it('keeps the unstyled intro and menu behind the plate', () => {
    expect(html).toContain('class="boot-plate"');
    expect(html).toMatch(/<div id="app">[\s\S]*id="intro-screen"[\s\S]*id="menu-screen"/);
    // The hand-off is a morph, not a stylesheet show/hide: main.ts flies a
    // clone of the start button out of the loading reticle, so hiding the plate
    // from CSS would cut the transition off.
    expect(html).not.toMatch(/html:not\(\.booting\)\s*\.boot-plate\s*\{[^}]*display:\s*none/);
    expect(main).toContain("classList.add('morphing')");
    expect(main).toContain('intro-start-ghost');
    expect(main).toContain("classList.add('arriving')");
  });

  it('arrives at the menu with nothing selected', () => {
    expect(html).toMatch(/id="menu-screen"[^>]*data-view="idle"/);
    expect(html).toContain('data-menu-panel="idle"');
    // No nav entry is pre-lit, and no panel claims to be the current page.
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toMatch(/menu-nav-item\s+on["']/);
    expect(app).toContain('menuView: MenuView | null = null');
    expect(app).toContain("menu.dataset.view = view ?? 'idle'");
  });

  it('releases the plate only after the stylesheet import', () => {
    const stylesheet = main.indexOf("import './style.css'");
    const release = main.indexOf("classList.remove('booting')");
    expect(stylesheet).toBeGreaterThanOrEqual(0);
    expect(release).toBeGreaterThan(stylesheet);
  });
});
