import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/ui/accountPanel.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

/** The header chip, from its opening element to the header that closes it. */
function chipMarkup(): string {
  const start = html.indexOf('id="menu-account"');
  const end = html.indexOf('</header>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('account chip', () => {
  it('leads with rank and level, then the avatar', () => {
    const chip = chipMarkup();
    const standing = chip.indexOf('id="menu-account-standing"');
    const avatar = chip.indexOf('id="menu-account-avatar"');
    expect(standing).toBeGreaterThan(-1);
    expect(avatar).toBeGreaterThan(standing);
    expect(chip).toContain('id="menu-account-rank"');
    expect(chip).toContain('id="menu-account-level"');
  });

  it('renders the provider avatar image, keeping the initial as a fallback', () => {
    expect(panel).toContain('account?.avatarUrl');
    expect(panel).toContain('referrerpolicy="no-referrer"');
    expect(styles).toContain('.menu-account-avatar img');
  });
});

describe('account screen', () => {
  it('is a deck page with a rail level, not a popover under the chip', () => {
    const chip = chipMarkup();
    // The chip is a route: no dialog semantics, and the screen lives in the deck.
    expect(chip).not.toContain('role="dialog"');
    expect(chip).not.toContain('id="menu-account-body"');
    expect(html).toContain('data-menu-level="account"');
    expect(html).toContain('id="menu-view-account"');
    expect(html).toContain('data-menu-panel="account"');
    expect(styles).toContain(".menu-screen[data-view='account'] .menu-view[data-menu-panel='account']");
  });

  it('puts the account sections in the left rail beside the stage', () => {
    expect(html).toContain('data-account-tab="account"');
    expect(html).toContain('data-account-tab="record"');
    const nav = html.slice(html.indexOf('data-menu-level="account"'), html.indexOf('data-menu-level="campaign"'));
    expect(nav).toContain('data-account-tab="record"');
    // The crumb climbs back to the main menu, as every other deck level does.
    expect(nav).toContain('data-menu-back="top"');
    expect(panel).toContain("dataset.accountTab");
  });

  it('opens the service record in the same surface rather than a modal', () => {
    expect(panel).not.toContain("from './modal'");
    const recordAction = panel.slice(panel.indexOf("if (action === 'record')"));
    expect(recordAction).toContain("this.view = 'record'");
    expect(panel).toContain('serviceRecordMarkup');
  });

  it('offers the command-flag editor to guests as well as accounts', () => {
    // Flags are a local design first; signing in merges them. Gating the row
    // behind an account would leave guests with no way in.
    const guestBranch = panel.slice(panel.indexOf('if (!account) {'), panel.indexOf('const identities = account.identities;'));
    expect(guestBranch).toContain('this.renderCommandFlag()');
    expect(panel).toContain("data-account-action=\"flags\"");
    expect(panel).toContain('openFlagEditor(');
  });

  it('shows the full identity and standing on the page head', () => {
    expect(html).toContain('id="account-view-head"');
    expect(panel).toContain('account-head-avatar');
    expect(panel).toContain('account-head-standing');
    expect(styles).toContain('.account-head-avatar img');
  });
});
