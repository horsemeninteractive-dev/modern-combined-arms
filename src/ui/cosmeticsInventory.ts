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
 * Identity, rank and the equipped frame already live in the page head, so this
 * page only names what is worn and offers the swap.
 */
import {
  COSMETIC_SECTIONS,
  cosmeticById,
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
  /** Which section is being browsed. */
  filter?: CosmeticCategory | 'all';
  /** Whether the player has an account, which decides where equipment is saved. */
  signedIn?: boolean;
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

/** One state per item: worn, wearable, or locked. */
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

function itemCard(
  item: CosmeticItem,
  options: CosmeticsInventoryOptions,
  names: Record<string, string>,
  current: string | null,
): string {
  const unlocked = isCosmeticUnlocked(item, options.progress);
  const equipped = current === item.id;
  return `<article class="ci-item${equipped ? ' is-equipped' : ''}${unlocked ? '' : ' is-locked'}">
    <span class="${cosmeticArtClass(item)}" aria-hidden="true"></span>
    <div class="ci-item-body">
      <p class="ci-item-name">
        <b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.tier)}</small>
        ${itemAction(item, unlocked, equipped)}
      </p>
      <p class="ci-item-desc">${escapeHtml(item.description)}</p>
      ${
        unlocked
          ? ''
          : `<p class="ci-item-req"><span>${escapeHtml(requirementText(item, names))}</span><em>${escapeHtml(
              unlockProgressText(item.unlock, options.progress),
            )}</em></p>`
      }
    </div>
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

/**
 * What is worn right now, in one place.
 *
 * The category rows below already say which item is on, but that is only true
 * within the visible section; this strip answers "what am I wearing" without
 * scrolling and clears a slot without hunting for its card.
 */
function worn(options: CosmeticsInventoryOptions): string {
  const slots: Array<{ category: CosmeticCategory; label: string; id: string | null }> = [
    { category: 'frame', label: 'Avatar frame', id: options.equipped.frame },
    { category: 'background', label: 'Card background', id: options.equipped.background },
    { category: 'camo', label: 'Unit camo', id: options.equipped.camo },
  ];
  const rows = slots.map((slot) => {
    if (slot.id === null) return '';
    const item = cosmeticById(slot.id);
    return `<li data-slot="${slot.category}">
      <span>${escapeHtml(slot.label)}</span>
      <b>${escapeHtml(item?.name ?? slot.id)}</b>
      <button type="button" class="ci-equip ci-equip-clear" data-cosmetic-equip="${slot.category}:">REMOVE</button>
    </li>`;
  });
  const filled = rows.filter(Boolean);
  if (filled.length === 0) {
    return '<p class="ci-worn ci-worn-empty">Nothing is equipped yet. Everything you own can be worn from the list below.</p>';
  }
  return `<ul class="ci-worn" aria-label="Equipped cosmetics">${filled.join('')}</ul>`;
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
      const current = equippedId(section.id, options.equipped);
      if (section.id === 'emblem') {
        return `<section class="ci-section" aria-label="${escapeHtml(section.title)}">
          <header class="ci-section-head">
            <div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.blurb)}</p></div>
          </header>
          <div class="ci-grid">
            ${items
              .map((item) => {
                const unlocked = isCosmeticUnlocked(item, options.progress);
                return `<article class="ci-item${unlocked ? '' : ' is-locked'}">
                  <span class="${cosmeticArtClass(item)}" aria-hidden="true"></span>
                  <div class="ci-item-body">
                    <p class="ci-item-name">
                      <b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.tier)}</small>
                      <span class="ci-state${unlocked ? '' : ' is-locked'}">${unlocked ? 'UNLOCKED' : 'LOCKED'}</span>
                    </p>
                    <p class="ci-item-desc">${escapeHtml(item.description)}</p>
                    ${
                      unlocked
                        ? ''
                        : `<p class="ci-item-req"><span>${escapeHtml(requirementText(item, names))}</span><em>${escapeHtml(
                            unlockProgressText(item.unlock, options.progress),
                          )}</em></p>`
                    }
                  </div>
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
        </header>
        <div class="ci-grid">
          ${items.map((item) => itemCard(item, options, names, current)).join('')}
        </div>
      </section>`;
    })
    .join('');

  const total = [...counts.values()].reduce((sum, entry) => sum + entry.total, 0);
  const owned = [...counts.values()].reduce((sum, entry) => sum + entry.owned, 0);
  return `<div class="ci">
    ${worn(options)}
    <div class="ci-summary">
      <p class="ci-summary-text"><b>${owned} of ${total}</b> cosmetics unlocked. Everything here is earned by playing: career XP, matches, victories and commendations. There is no shop and no currency.</p>
      <p class="ci-summary-hint">Equipped items are saved${options.signedIn ? ' to your account' : ' on this device'} and travel with your identity.</p>
    </div>
    ${filterRow(options, counts)}
    ${sections || '<p class="account-note">No cosmetics in this category yet.</p>'}
  </div>`;
}
