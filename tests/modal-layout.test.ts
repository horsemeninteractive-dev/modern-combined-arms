import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

/** One top-level rule, so an assertion cannot pass by matching a later override. */
function rule(selector: string): string {
  const start = styles.indexOf(`\n${selector} {`);
  expect(start, `missing ${selector} rule`).toBeGreaterThan(-1);
  const end = styles.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return styles.slice(start, end + 1);
}

describe('modal sizing', () => {
  it('keeps the card on screen and scrolls only its body', () => {
    const card = rule('.modal-card');
    expect(card).toMatch(/display:\s*flex/);
    expect(card).toMatch(/flex-direction:\s*column/);
    expect(card).toMatch(/max-height:\s*88(?:d)?vh/);
    expect(card).toMatch(/overflow:\s*hidden/);

    const body = rule('.modal-body');
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);

    // The footer is outside the scroll region, so Close is always reachable.
    expect(rule('.modal-actions')).toMatch(/flex:\s*0 0 auto/);
  });

  it('pins the end-of-operation controls under a scrolling report', () => {
    const card = rule('.end-card');
    expect(card).toMatch(/display:\s*flex/);
    expect(card).toMatch(/flex-direction:\s*column/);
    expect(card).toMatch(/max-height:\s*88(?:d)?vh/);
    expect(card).toMatch(/overflow:\s*hidden/);

    const body = rule('.end-body');
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);

    expect(rule('.end-actions')).toMatch(/flex:\s*0 0 auto/);
    expect(hud).toContain('<div class="end-body">');
    expect(hud).toContain('          </div>\n          <div class="end-actions">');
  });
});
