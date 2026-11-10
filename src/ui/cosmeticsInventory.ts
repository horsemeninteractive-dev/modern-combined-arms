/**
 * The cosmetics inventory.
 *
 * One page that answers three questions for every cosmetic in the catalogue:
 * what is it, how is it earned, and is it worn. Ownership is never stored here:
 * the same `isCosmeticUnlocked` rule the account service validates against is
 * evaluated against the career snapshot the panel already read, so the page and
 * the server cannot disagree about what a player owns.
 *
 * The page is presentation, not a store: there is no price, no currency and no
 * claim button. A locked item shows the step that opens it and current progress.
 */
import {
  COSMETIC_SECTIONS,
  cosmeticsByCategory,
  isCosmeticUnlocked,
  unlockProgressText,
  unlockRequirementText,
  type CosmeticCategory,
  type CosmeticItem,
  type CosmeticProgress,
} from '../identity/cosmetics';

export interface CosmeticsInventoryOptions {
  progress: CosmeticProgress;
  equipped: { frame: string | null; background: string | null; camo: string | null };
  identity: { callsign: string; avatar: string } | null;
  /** Which section is being browsed. */
  filter?: CosmeticCategory | 'all';
  /** Whether the player has an account, which decides where equipment is saved. */
  signedIn?: boolean;
  flagHtml?: string;
  rankName?: string | null;
  grade?: string | null;
  /** Achievement names, so a commendation unlock can name its award. */
  achievementNames?: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The CSS hook that draws an item's small preview. */
export function cosmeticArtClass(item: CosmeticItem): string {
  switch (item.category) {
    case 'frame':
      return `ci-art ci-art-frame identity-frame-${item.render}`;
    case 'background':
      return `ci-art ci-art-background identity-bg-${item.render}`;
    case 'camo':
      return `ci-art ci-art-camo ci-camo-${item.render}`;
    default:
      return 'ci-art ci-art-emblem';
  }
}

function requirementText(item: CosmeticItem, names: Record<string, string>): string {
  if (item.unlock.kind === 'achievement') {
    const name = names[item.unlock.achievementId];
    return name ? `Earn “${name}”` : 'Earn the associated commendation';
  }
  return unlockRequirementText(item.unlock);
}

function equippedId(
  category: CosmeticCategory,
  equipped: CosmeticsInventoryOptions['equipped'],
): string | null {
  if (category === 'frame') return equipped.frame;
  if (category === 'background') return equipped.background;
  if (category === 'camo') return equipped.camo;
  return null;
}

function itemAction(
  item: CosmeticItem,
  unlocked: boolean,
  current: boolean,
): string {
  if (current) return '<span class="ci-state is-on">EQUIPPED</span>';
  if (!unlocked) return '<span class="ci-state is-locked">LOCKED</span>';
  return `<button type="button" class="ci-equip" data-cosmetic-equip="${escapeHtml(
    `${item.category}:${item.id}`,
  )}">EQUIP</button>`;
}

function resetAction(category: CosmeticCategory, current: string | null): string {
  if (current === null) return '';
  return `<button type="button" class="ci-equip ci-equip-clear" data-cosmetic-equip="${escapeHtml(
    `${category}:`,
  )}">REMOVE</button>`;
}

function itemCard(
  item: CosmeticItem,
  options: CosmeticsInventoryOptions,
  names: Record<string, string>,
  current: string | null,
): string {
  const unlocked = isCosmeticUnlocked(item, options.progress);
  const equipped = current === item.id;
  const progress = unlocked ? 'Unlocked' : unlockProgressText(item.unlock, options.progress);
  return `<article class="ci-item${equipped ? ' is-equipped' : ''}${unlocked ? '' : ' is-locked'}">
    <span class="${cosmeticArtClass(item)}" aria-hidden="true"></span>
    <div class="ci-item-body">
      <p class="ci-item-name"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.tier)}</small></p>
      <p class="ci-item-desc">${escapeHtml(item.description)}</p>
      <p class="ci-item-req"><span>${escapeHtml(requirementText(item, names))}</span><em>${escapeHtml(progress)}</em></p>
    </div>
    <div class="ci-item-action">${itemAction(item, unlocked, equipped)}</div>
  </article>`;
}

function filterRow(
  options: CosmeticsInventoryOptions,
  counts: Map<CosmeticCategory, { owned: number; total: number }>,
): string {
  const active = options.filter ?? 'all';
  const items: Array<{ id: CosmeticCategory | 'all'; label: string; owned: number; total: number }> = [
    {
      id: 'all',
      label: 'All',
      owned: [...counts.values()].reduce((total, entry) => total + entry.owned, 0),
      total: [...counts.values()].reduce((total, entry) => total + entry.total, 0),
    },
    ...COSMETIC_SECTIONS.map((section) => ({
      id: section.id,
      label: section.title,
      owned: counts.get(section.id)?.owned ?? 0,
      total: counts.get(section.id)?.total ?? 0,
    })),
  ];
  return `<div class="ci-filters" role="group" aria-label="Cosmetic categories">
    ${items
      .map(
        (entry) => `<button type="button" class="ci-filter${entry.id === active ? ' on' : ''}" data-account-filter="${entry.id}" aria-pressed="${entry.id === active ? 'true' : 'false'}">
          <span>${escapeHtml(entry.label)}</span><small>${entry.owned}/${entry.total}</small>
        </button>`,
      )
      .join('')}
  </div>`;
}

function preview(options: CosmeticsInventoryOptions): string {
  const identity = options.identity;
  const initial = (identity?.callsign ?? 'Guest').trim().charAt(0).toUpperCase() || '?';
  const frame = options.equipped.frame ? ` identity-frame-${frameToken(options.equipped.frame)}` : '';
  const background = options.equipped.background
    ? ` identity-bg-${frameToken(options.equipped.background)}`
    : '';
  const camo = options.equipped.camo ? ` ci-camo-${camoToken(options.equipped.camo)}` : '';
  const rankLine = [options.rankName, options.grade].filter(Boolean).join(' · ');
  return `<section class="ci-preview${background}" aria-label="Player card preview">
    <span class="ci-preview-camo${camo}" aria-hidden="true"></span>
    <span class="ci-preview-avatar${frame}" aria-hidden="true">${escapeHtml(initial)}</span>
    <div class="ci-preview-text">
      <b>${escapeHtml(identity?.callsign ?? 'Guest commander')}</b>
      <small>${escapeHtml(rankLine || 'NO RANK RECORDED')}</small>
    </div>
    ${options.flagHtml ? `<span class="ci-preview-flag">${options.flagHtml}</span>` : ''}
  </section>`;
}

/** Catalogue ids are already validated; this only extracts the render token. */
function frameToken(id: string): string {
  return id.split('-').slice(1).join('-');
}

function camoToken(id: string): string {
  return id.split('-').slice(1).join('-');
}

export function cosmeticsInventoryMarkup(options: CosmeticsInventoryOptions): string {
  const names = options.achievementNames ?? {};
  const counts = new Map<CosmeticCategory, { owned: number; total: number }>();
  for (const section of COSMETIC_SECTIONS) {
    const items = cosmeticsByCategory(section.id);
    counts.set(section.id, {
      owned: items.filter((item) => isCosmeticUnlocked(item, options.progress)).length,
      total: items.length,
    });
  }
  const active = options.filter ?? 'all';
  const sections = COSMETIC_SECTIONS.filter((section) => active === 'all' || active === section.id)
    .map((section) => {
      const items = cosmeticsByCategory(section.id);
      const count = counts.get(section.id) ?? { owned: 0, total: items.length };
      const current = equippedId(section.id, options.equipped);
      if (section.id === 'emblem') {
        return `<section class="ci-section" aria-label="${escapeHtml(section.title)}">
          <header class="ci-section-head">
            <div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.blurb)}</p></div>
            <span class="ci-count">${count.owned}/${count.total}</span>
          </header>
          <div class="ci-grid">
            ${items
              .map((item) => {
                const unlocked = isCosmeticUnlocked(item, options.progress);
                return `<article class="ci-item${unlocked ? '' : ' is-locked'}">
                  <span class="${cosmeticArtClass(item)}" aria-hidden="true"></span>
                  <div class="ci-item-body">
                    <p class="ci-item-name"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.tier)}</small></p>
                    <p class="ci-item-desc">${escapeHtml(item.description)}</p>
                    <p class="ci-item-req"><span>${escapeHtml(requirementText(item, names))}</span><em>${escapeHtml(unlockProgressText(item.unlock, options.progress))}</em></p>
                  </div>
                  <div class="ci-item-action"><span class="ci-state${unlocked ? '' : ' is-locked'}">${unlocked ? 'UNLOCKED' : 'LOCKED'}</span></div>
                </article>`;
              })
              .join('')}
          </div>
          <div class="ci-section-actions">
            <button type="button" class="account-secondary" data-account-action="flags">Open flag editor</button>
          </div>
        </section>`;
      }
      return `<section class="ci-section" aria-label="${escapeHtml(section.title)}">
        <header class="ci-section-head">
          <div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.blurb)}</p></div>
          <span class="ci-count">${count.owned}/${count.total}</span>
        </header>
        <div class="ci-grid">
          ${items.map((item) => itemCard(item, options, names, current)).join('')}
        </div>
        ${resetAction(section.id, current)}
      </section>`;
    })
    .join('');

  const total = [...counts.values()].reduce((sum, entry) => sum + entry.total, 0);
  const owned = [...counts.values()].reduce((sum, entry) => sum + entry.owned, 0);
  return `<div class="ci">
    ${preview(options)}
    <div class="ci-summary">
      <p class="ci-summary-text"><b>${owned} of ${total}</b> cosmetics unlocked. Everything here is earned by playing: career XP, matches, victories and commendations. There is no shop and no currency.</p>
      <p class="ci-summary-hint">Equipped items are saved${options.signedIn ? ' to your account' : ' on this device'} and travel with your identity.</p>
    </div>
    ${filterRow(options, counts)}
    ${sections || '<p class="account-note">No cosmetics in this category yet.</p>'}
  </div>`;
}
