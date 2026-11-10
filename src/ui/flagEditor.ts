/**
 * Command flag editor.
 *
 * A single panel over one live draft composition. Every edit re-renders the same
 * preview at the top, so the flag is always the primary object on screen and the
 * controls serve it. Tabs group the controls by intent (background, pattern,
 * emblem, border, ornaments, profile) instead of presenting one long form.
 *
 * The editor is presentation only: it writes a composition to the flag store and
 * never touches the simulation. Undo/redo snapshots live here, not in storage.
 */
import {
  DEFAULT_FLAG_NAME,
  FLAG_BACKGROUNDS,
  FLAG_BORDERS,
  FLAG_DECORATIONS,
  FLAG_EMBLEMS,
  FLAG_PALETTE,
  FLAG_STRIPES,
  MAX_FLAG_DECORATIONS,
  MAX_FLAG_DESIGNS,
  MAX_FLAG_NAME_LENGTH,
  cloneComposition,
  defaultComposition,
  type FlagBackgroundKind,
  type FlagBorderKind,
  type FlagComposition,
  type FlagDecorationId,
  type FlagStripeKind,
} from '../identity/flag';
import {
  EMPTY_PROGRESS,
  cosmeticsByCategory,
  isCosmeticUnlocked,
  unlockRequirementText,
  type CosmeticProgress,
} from '../identity/cosmetics';
import { History } from '../identity/history';
import type { FlagDesign } from '../identity/flag';
import type { FlagStore } from '../identity/flagStore';
import { escapeHtml } from './modal';
import { commandFlagSvg } from './commandFlag';

type EditorTab = 'background' | 'pattern' | 'emblem' | 'border' | 'ornaments' | 'profile';

const TABS: Array<{ id: EditorTab; label: string }> = [
  { id: 'background', label: 'Background' },
  { id: 'pattern', label: 'Pattern' },
  { id: 'emblem', label: 'Emblem' },
  { id: 'border', label: 'Border' },
  { id: 'ornaments', label: 'Ornaments' },
  { id: 'profile', label: 'Profile' },
];

export interface FlagEditorOptions {
  store: FlagStore;
  progress?: () => CosmeticProgress;
  /** Called after any saved change and when the editor closes. */
  onChange?: () => void;
}

type Notice = { level: 'info' | 'warning' | 'success' | 'error'; text: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function previewComposition(base: FlagComposition, emblemId: string): FlagComposition {
  const copy = clone(base);
  copy.background = { kind: 'solid', primary: 'navy', secondary: 'navy' };
  copy.stripe = { kind: 'none', color: 'navy', width: 6 };
  copy.border = { kind: 'none', color: 'navy' };
  copy.decorations = [];
  copy.emblem = {
    id: emblemId,
    color: 'bone',
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
    mirror: false,
  };
  return copy;
}

export class FlagEditor {
  private root: HTMLDivElement | null = null;
  private draft: FlagComposition = defaultComposition();
  private draftName = DEFAULT_FLAG_NAME;
  private editingId: string | null = null;
  private history = new History<FlagComposition>();
  private notice: Notice | null = null;
  private tab: EditorTab = 'background';
  /** True between the first input of a range gesture and its change event. */
  private gesture = false;

  constructor(private readonly options: FlagEditorOptions) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.className = 'cf-overlay';
    root.addEventListener('click', this.onClick);
    root.addEventListener('change', this.onChange);
    root.addEventListener('input', this.onInput);
    root.addEventListener('keydown', this.onKeyDown);
    document.body.appendChild(root);
    this.root = root;
    const active = this.options.store.activeDesign();
    if (active) this.load(active);
    else this.startNew();
    this.render();
    requestAnimationFrame(() => {
      root.querySelector<HTMLElement>('.cf-editor')?.focus();
    });
  }

  close(): void {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.options.onChange?.();
  }

  private progress(): CosmeticProgress {
    return this.options.progress?.() ?? EMPTY_PROGRESS;
  }

  private load(design: FlagDesign): void {
    this.draft = clone(design.composition);
    this.draftName = design.name;
    this.editingId = design.id;
    this.history.clear();
    this.notice = null;
  }

  private startNew(): void {
    this.draft = defaultComposition();
    this.draftName = DEFAULT_FLAG_NAME;
    this.editingId = null;
    this.history.clear();
    this.notice = null;
  }

  private pushUndo(): void {
    this.history.push(cloneComposition(this.draft));
  }

  private mutate(apply: (composition: FlagComposition) => void): void {
    this.pushUndo();
    apply(this.draft);
    this.gesture = false;
    this.render();
  }

  private refreshPreview(): void {
    const canvas = this.root?.querySelector<HTMLElement>('.cf-canvas');
    if (canvas) {
      canvas.innerHTML = commandFlagSvg(this.draft, {
        size: 420,
        title: `${this.draftName} preview`,
      });
    }
    const active = this.options.store.state.activeId;
    const status = this.root?.querySelector<HTMLElement>('.cf-status');
    if (status) {
      const state = this.editingId
        ? active === this.editingId
          ? 'ACTIVE IDENTITY'
          : 'SAVED DESIGN'
        : 'UNSAVED DESIGN';
      status.textContent = state;
      status.className = `cf-status ${this.editingId && active === this.editingId ? 'on' : ''}`;
    }
    const undo = this.root?.querySelector<HTMLButtonElement>('[data-flag-act="undo"]');
    const redo = this.root?.querySelector<HTMLButtonElement>('[data-flag-act="redo"]');
    if (undo) undo.disabled = !this.history.canUndo;
    if (redo) redo.disabled = !this.history.canRedo;
  }

  private render(): void {
    if (!this.root) return;
    const store = this.options.store;
    const design = store.design(this.editingId);
    const active = design !== null && store.state.activeId === design.id;
    const progress = this.progress();
    const equipped = store.state.equipped;
    const notice = this.notice
      ? `<p class="cf-notice" data-level="${this.notice.level}" role="status">${escapeHtml(this.notice.text)}</p>`
      : '';
    this.root.innerHTML = `<div class="cf-editor" role="dialog" aria-modal="true" aria-label="Command flag editor" tabindex="-1">
      <header class="cf-head">
        <div class="cf-head-title">
          <span class="cf-kicker">PERSONAL COMMAND FLAG</span>
          <h2>${escapeHtml(this.draftName)}</h2>
        </div>
        <div class="cf-head-actions">
          <button type="button" class="btn btn-ghost" data-flag-act="undo" ${this.history.canUndo ? '' : 'disabled'}>UNDO</button>
          <button type="button" class="btn btn-ghost" data-flag-act="redo" ${this.history.canRedo ? '' : 'disabled'}>REDO</button>
          <button type="button" class="btn btn-ghost" data-flag-act="reset">RESET</button>
          <button type="button" class="btn btn-ghost" data-flag-act="close" aria-label="Close flag editor">CLOSE</button>
        </div>
      </header>
      ${notice}
      <div class="cf-body">
        <section class="cf-preview" aria-label="Flag preview">
          <div class="cf-canvas">${commandFlagSvg(this.draft, { size: 420, title: `${this.draftName} preview` })}</div>
          <div class="cf-preview-meta">
            <label class="cf-name-field"><span>DESIGN NAME</span>
              <input id="cf-name" data-flag-scope="name" maxlength="${MAX_FLAG_NAME_LENGTH}" value="${escapeHtml(this.draftName)}" spellcheck="false" autocomplete="off">
            </label>
            <span class="cf-status ${active ? 'on' : ''}">${active ? 'ACTIVE IDENTITY' : this.editingId ? 'SAVED DESIGN' : 'UNSAVED DESIGN'}</span>
          </div>
          <div class="cf-preview-actions">
            <button type="button" class="btn btn-primary" data-flag-act="save">SAVE</button>
            <button type="button" class="btn btn-ghost" data-flag-act="activate" ${this.editingId ? '' : 'disabled'}>SET AS ACTIVE</button>
            <button type="button" class="btn btn-ghost" data-flag-act="duplicate">DUPLICATE</button>
            <button type="button" class="btn btn-ghost" data-flag-act="delete" ${this.editingId ? '' : 'disabled'}>DELETE</button>
          </div>
          <p class="cf-hint">A command flag is your own identity. It is not the national flag your force flies in a match, and it never changes what a unit can do.</p>
          ${store.error ? `<p class="cf-notice" data-level="error" role="alert">${escapeHtml(store.error)}</p>` : ''}
        </section>
        <section class="cf-panel" aria-label="Flag composition">
          <nav class="cf-tabs" aria-label="Composition sections">
            ${TABS.map(
              (tab) =>
                `<button type="button" class="cf-tab ${tab.id === this.tab ? 'on' : ''}" data-flag-act="tab" data-tab="${tab.id}" aria-pressed="${tab.id === this.tab}">${tab.label}</button>`,
            ).join('')}
          </nav>
          <div class="cf-controls">${this.controls(progress)}</div>
        </section>
      </div>
      <footer class="cf-designs">
        <div class="cf-designs-head">
          <span>SAVED FLAGS · ${store.designs.length} / ${MAX_FLAG_DESIGNS}</span>
          <button type="button" class="btn btn-ghost" data-flag-act="new" ${store.designs.length >= MAX_FLAG_DESIGNS ? 'disabled' : ''}>NEW DESIGN</button>
        </div>
        <div class="cf-design-strip">
          ${store.designs
            .map(
              (entry) => `<button type="button" class="cf-design ${entry.id === this.editingId ? 'on' : ''}" data-flag-act="select" data-id="${escapeHtml(entry.id)}" aria-pressed="${entry.id === this.editingId}">
                <span class="cf-design-flag">${commandFlagSvg(entry.composition, { size: 72 })}</span>
                <span class="cf-design-name">${escapeHtml(entry.name)}</span>
                ${store.state.activeId === entry.id ? '<span class="cf-design-active">ACTIVE</span>' : ''}
              </button>`,
            )
            .join('') || '<p class="cf-hint">No saved designs yet. Make one and press SAVE.</p>'}
        </div>
        <p class="cf-hint">Saved on this device${equipped.frame || equipped.background ? ' · profile cosmetics equipped' : ''}. ${MAX_FLAG_DESIGNS} designs are kept; delete one to make room.</p>
      </footer>
    </div>`;
  }

  private controls(progress: CosmeticProgress): string {
    switch (this.tab) {
      case 'background':
        return this.backgroundControls();
      case 'pattern':
        return this.patternControls();
      case 'emblem':
        return this.emblemControls(progress);
      case 'border':
        return this.borderControls();
      case 'ornaments':
        return this.ornamentControls();
      case 'profile':
        return this.profileControls(progress);
    }
  }

  private palette(field: string, current: string, index?: number): string {
    return `<div class="cf-swatches" role="group" aria-label="Colour">
      ${FLAG_PALETTE.map(
        (color) =>
          `<button type="button" class="cf-swatch ${color.id === current ? 'on' : ''}" style="--swatch:${color.hex}" data-flag-act="color" data-field="${field}" ${index === undefined ? '' : `data-index="${index}"`} data-value="${color.id}" title="${color.label}" aria-label="${color.label}" aria-pressed="${color.id === current}"></button>`,
      ).join('')}
    </div>`;
  }

  private backgroundControls(): string {
    return `<div class="cf-group">
      <span class="cf-label">BACKGROUND</span>
      <div class="cf-choice-row">
        ${FLAG_BACKGROUNDS.map(
          (entry) =>
            `<button type="button" class="cf-choice ${this.draft.background.kind === entry.id ? 'on' : ''}" data-flag-act="bg-kind" data-value="${entry.id}">${entry.label}</button>`,
        ).join('')}
      </div>
      <span class="cf-label">PRIMARY</span>
      ${this.palette('bg-primary', this.draft.background.primary)}
      <span class="cf-label">SECOND</span>
      ${this.palette('bg-secondary', this.draft.background.secondary)}
      <p class="cf-hint">A solid background uses the primary colour only. Gradient blends primary into second diagonally.</p>
    </div>`;
  }

  private patternControls(): string {
    return `<div class="cf-group">
      <span class="cf-label">ARRANGEMENT</span>
      <div class="cf-choice-row">
        ${FLAG_STRIPES.map(
          (entry) =>
            `<button type="button" class="cf-choice ${this.draft.stripe.kind === entry.id ? 'on' : ''}" data-flag-act="stripe-kind" data-value="${entry.id}">${entry.label}</button>`,
        ).join('')}
      </div>
      <span class="cf-label">BAND COLOUR</span>
      ${this.palette('stripe-color', this.draft.stripe.color)}
      <label class="cf-range"><span>BAND WIDTH · ${this.draft.stripe.width}</span>
        <input type="range" min="1" max="16" step="1" value="${this.draft.stripe.width}" data-flag-live="stripe-width">
      </label>
      <p class="cf-hint">Bands sit under the emblem, so the emblem always stays legible.</p>
    </div>`;
  }

  private emblemControls(progress: CosmeticProgress): string {
    const unlocked = new Set(this.progress().xp >= 0 ? this.unlockedEmblems() : []);
    const current = this.draft.emblem?.id ?? null;
    const items = FLAG_EMBLEMS.map((def) => {
      const item = cosmeticsByCategory('emblem').find((entry) => entry.render === def.id) ?? null;
      // A renderer emblem with no catalogue definition is never implicitly
      // free: the catalogue is the entitlement authority.
      const locked = item ? !isCosmeticUnlocked(item, progress) : true;
      const selected = current === def.id;
      return `<button type="button" class="cf-emblem ${selected ? 'on' : ''} ${locked ? 'locked' : ''}" data-flag-act="emblem" data-emblem="${def.id}" aria-pressed="${selected}" ${locked ? 'aria-disabled="true"' : ''}>
        <span class="cf-emblem-art">${commandFlagSvg(previewComposition(this.draft, def.id), { size: 64 })}</span>
        <span class="cf-emblem-name">${def.label}</span>
        ${locked && item ? `<small class="cf-lock">${escapeHtml(unlockRequirementText(item.unlock))}</small>` : ''}
      </button>`;
    }).join('');
    const emblem = this.draft.emblem;
    return `<div class="cf-group">
      <div class="cf-group-head">
        <span class="cf-label">EMBLEM</span>
        <button type="button" class="cf-choice ${emblem ? '' : 'on'}" data-flag-act="emblem" data-emblem="">None</button>
      </div>
      <div class="cf-emblem-grid">${items}</div>
      ${
        emblem
          ? `<span class="cf-label">EMBLEM COLOUR</span>
             ${this.palette('emblem-color', emblem.color)}
             <label class="cf-range"><span>SIZE · ${Math.round(emblem.scale * 100)}%</span>
               <input type="range" min="40" max="180" step="5" value="${Math.round(emblem.scale * 100)}" data-flag-live="emblem-scale">
             </label>
             <div class="cf-grid two">
               <label class="cf-range"><span>ACROSS</span><input type="range" min="-30" max="30" step="1" value="${emblem.x}" data-flag-live="emblem-x"></label>
               <label class="cf-range"><span>DOWN</span><input type="range" min="-20" max="20" step="1" value="${emblem.y}" data-flag-live="emblem-y"></label>
             </div>
             <div class="cf-grid two">
               <label class="cf-select"><span>ROTATION</span>
                 <select data-flag-act="emblem-rotate">
                   ${[0, 90, 180, 270].map((angle) => `<option value="${angle}" ${emblem.rotate === angle ? 'selected' : ''}>${angle}°</option>`).join('')}
                 </select>
               </label>
               <label class="cf-check"><input type="checkbox" data-flag-act="emblem-mirror" ${emblem.mirror ? 'checked' : ''}> Mirror</label>
             </div>`
          : '<p class="cf-hint">No emblem. Pick one above; locked emblems show the career step that opens them.</p>'
      }
      <p class="cf-hint">${unlocked.size} of ${FLAG_EMBLEMS.length} emblems unlocked.</p>
    </div>`;
  }

  private unlockedEmblems(): string[] {
    const progress = this.progress();
    return cosmeticsByCategory('emblem')
      .filter((item) => isCosmeticUnlocked(item, progress))
      .map((item) => item.render);
  }

  private borderControls(): string {
    return `<div class="cf-group">
      <span class="cf-label">BORDER</span>
      <div class="cf-choice-row">
        ${FLAG_BORDERS.map(
          (entry) =>
            `<button type="button" class="cf-choice ${this.draft.border.kind === entry.id ? 'on' : ''}" data-flag-act="border-kind" data-value="${entry.id}">${entry.label}</button>`,
        ).join('')}
      </div>
      <span class="cf-label">BORDER COLOUR</span>
      ${this.palette('border-color', this.draft.border.color)}
      <p class="cf-hint">A border is drawn last, over the emblem and any ornament near the edge.</p>
    </div>`;
  }

  private ornamentControls(): string {
    return `<div class="cf-group">
      <div class="cf-group-head">
        <span class="cf-label">ORNAMENTS · ${this.draft.decorations.length} / ${MAX_FLAG_DECORATIONS}</span>
        <button type="button" class="btn btn-ghost" data-flag-act="deco-add" ${this.draft.decorations.length >= MAX_FLAG_DECORATIONS ? 'disabled' : ''}>ADD</button>
      </div>
      ${
        this.draft.decorations
          .map(
            (decoration, index) => `<article class="cf-ornament">
              <header>
                <select data-flag-act="deco-kind" data-index="${index}" aria-label="Ornament ${index + 1}">
                  ${FLAG_DECORATIONS.map((entry) => `<option value="${entry.id}" ${decoration.id === entry.id ? 'selected' : ''}>${entry.label}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-ghost" data-flag-act="deco-remove" data-index="${index}">REMOVE</button>
              </header>
              ${this.palette('deco-color', decoration.color, index)}
              <div class="cf-grid two">
                <label class="cf-range"><span>SIZE · ${Math.round(decoration.scale * 100)}%</span>
                  <input type="range" min="30" max="160" step="5" value="${Math.round(decoration.scale * 100)}" data-flag-live="deco-scale" data-index="${index}">
                </label>
                <label class="cf-select"><span>ROTATION</span>
                  <select data-flag-act="deco-rotate" data-index="${index}">
                    ${[0, 90, 180, 270].map((angle) => `<option value="${angle}" ${decoration.rotate === angle ? 'selected' : ''}>${angle}°</option>`).join('')}
                  </select>
                </label>
              </div>
            </article>`,
          )
          .join('') || '<p class="cf-hint">No ornaments. Add up to three small marks for balance.</p>'
      }
    </div>`;
  }

  private profileControls(progress: CosmeticProgress): string {
    const equipped = this.options.store.state.equipped;
    const grid = (category: 'frame' | 'background', current: string | null) =>
      cosmeticsByCategory(category)
        .map((item) => {
          const unlocked = isCosmeticUnlocked(item, progress);
          return `<button type="button" class="cf-cosmetic ${current === item.id ? 'on' : ''} ${unlocked ? '' : 'locked'}" data-flag-act="equip" data-category="${category}" data-id="${item.id}">
            <span class="cf-cosmetic-swatch ${category === 'frame' ? `identity-frame-${escapeHtml(item.render)}` : `identity-bg-${escapeHtml(item.render)}`}" aria-hidden="true"></span>
            <span class="cf-cosmetic-name">${escapeHtml(item.name)}</span>
            <small>${unlocked ? (current === item.id ? 'EQUIPPED' : 'READY') : escapeHtml(unlockRequirementText(item.unlock))}</small>
          </button>`;
        })
        .join('');
    return `<div class="cf-group">
      <span class="cf-label">PROFILE FRAME</span>
      <div class="cf-cosmetic-grid">${grid('frame', equipped.frame)}<button type="button" class="cf-cosmetic ${equipped.frame === null ? 'on' : ''}" data-flag-act="equip" data-category="frame" data-id=""><span class="cf-cosmetic-swatch"></span><span class="cf-cosmetic-name">None</span><small>${equipped.frame === null ? 'EQUIPPED' : 'READY'}</small></button></div>
      <span class="cf-label">PROFILE BACKGROUND</span>
      <div class="cf-cosmetic-grid">${grid('background', equipped.background)}</div>
      <p class="cf-hint">Cosmetics are earned with career XP, matches, victories and commendations. They change presentation only.</p>
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  private onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-flag-act]');
    if (!target || !this.root) return;
    const act = target.dataset.flagAct ?? '';
    if (act === 'tab') {
      this.tab = (target.dataset.tab as EditorTab) ?? 'background';
      this.render();
      return;
    }
    if (act === 'close') {
      this.close();
      return;
    }
    if (act === 'undo' || act === 'redo') {
      const next = act === 'undo' ? this.history.undo(this.draft) : this.history.redo(this.draft);
      if (next) this.draft = next;
      this.notice = null;
      this.render();
      return;
    }
    if (act === 'reset') {
      this.mutate((composition) => Object.assign(composition, defaultComposition()));
      return;
    }
    if (act === 'color') {
      const field = target.dataset.field ?? '';
      const value = target.dataset.value ?? '';
      const index = target.dataset.index === undefined ? null : Number(target.dataset.index);
      this.mutate((composition) => {
        if (field === 'bg-primary') composition.background.primary = value;
        if (field === 'bg-secondary') composition.background.secondary = value;
        if (field === 'stripe-color') composition.stripe.color = value;
        if (field === 'border-color') composition.border.color = value;
        if (field === 'emblem-color' && composition.emblem) composition.emblem.color = value;
        if (field === 'deco-color' && index !== null && composition.decorations[index]) {
          composition.decorations[index].color = value;
        }
      });
      return;
    }
    if (act === 'bg-kind') {
      const value = target.dataset.value as FlagBackgroundKind;
      this.mutate((composition) => {
        composition.background.kind = value;
      });
      return;
    }
    if (act === 'stripe-kind') {
      const value = target.dataset.value as FlagStripeKind;
      this.mutate((composition) => {
        composition.stripe.kind = value;
      });
      return;
    }
    if (act === 'border-kind') {
      const value = target.dataset.value as FlagBorderKind;
      this.mutate((composition) => {
        composition.border.kind = value;
      });
      return;
    }
    if (act === 'emblem') {
      const id = target.dataset.emblem ?? '';
      if (!id) {
        this.mutate((composition) => {
          composition.emblem = null;
        });
        return;
      }
      const item = cosmeticsByCategory('emblem').find((entry) => entry.render === id);
      if (item && !isCosmeticUnlocked(item, this.progress())) {
        this.notice = {
          level: 'warning',
          text: `${item.name} unlocks at ${unlockRequirementText(item.unlock)}.`,
        };
        this.render();
        return;
      }
      this.mutate((composition) => {
        composition.emblem = {
          id,
          color: composition.emblem?.color ?? 'bone',
          x: composition.emblem?.x ?? 0,
          y: composition.emblem?.y ?? 0,
          scale: composition.emblem?.scale ?? 1,
          rotate: composition.emblem?.rotate ?? 0,
          mirror: composition.emblem?.mirror ?? false,
        };
      });
      return;
    }
    if (act === 'deco-add') {
      const used = new Set(this.draft.decorations.map((entry) => entry.id));
      const next = FLAG_DECORATIONS.find((entry) => !used.has(entry.id)) ?? FLAG_DECORATIONS[0];
      this.mutate((composition) => {
        if (composition.decorations.length >= MAX_FLAG_DECORATIONS) return;
        composition.decorations.push({
          id: next.id,
          color: composition.border.color,
          x: 30,
          y: -18,
          scale: 1,
          rotate: 0,
        });
      });
      return;
    }
    if (act === 'deco-remove') {
      const index = Number(target.dataset.index ?? 0);
      this.mutate((composition) => {
        composition.decorations.splice(index, 1);
      });
      return;
    }
    if (act === 'equip') {
      const category = target.dataset.category === 'background' ? 'background' : 'frame';
      const id = target.dataset.id ? target.dataset.id : null;
      const result = this.options.store.equip(category, id, this.progress());
      this.notice = result.ok
        ? { level: 'success', text: id ? 'Equipped.' : 'Cleared.' }
        : { level: 'error', text: result.error ?? 'That cosmetic could not be equipped.' };
      this.render();
      this.options.onChange?.();
      return;
    }
    if (act === 'select') {
      const design = this.options.store.design(target.dataset.id ?? null);
      if (design) {
        this.load(design);
        this.render();
      }
      return;
    }
    if (act === 'new') {
      this.startNew();
      this.render();
      return;
    }
    if (act === 'save') {
      const error = this.save();
      this.notice = error ? { level: 'error', text: error } : { level: 'success', text: 'Flag saved.' };
      this.render();
      return;
    }
    if (act === 'activate') {
      const error = this.save();
      if (error) {
        this.notice = { level: 'error', text: error };
        this.render();
        return;
      }
      const result = this.options.store.setActive(this.editingId);
      this.notice = result.ok
        ? { level: 'success', text: 'This flag is now your active identity.' }
        : { level: 'error', text: result.error ?? 'The active flag could not be changed.' };
      this.render();
      this.options.onChange?.();
      return;
    }
    if (act === 'duplicate') {
      const source = this.editingId;
      if (!source) {
        this.notice = { level: 'warning', text: 'Save this design before duplicating it.' };
        this.render();
        return;
      }
      const result = this.options.store.duplicate(source);
      if (result.ok && result.value) {
        this.load(result.value);
        this.notice = { level: 'success', text: 'Design duplicated.' };
      } else {
        this.notice = { level: 'error', text: result.error ?? 'The design could not be duplicated.' };
      }
      this.render();
      this.options.onChange?.();
      return;
    }
    if (act === 'delete') {
      if (!this.editingId) return;
      const design = this.options.store.design(this.editingId);
      if (!design) return;
      const confirmed =
        typeof window === 'undefined' ||
        typeof window.confirm !== 'function' ||
        window.confirm(`Delete “${design.name}”? This cannot be undone.`);
      if (!confirmed) return;
      const result = this.options.store.remove(design.id);
      if (result.ok) {
        this.startNew();
        this.notice = { level: 'info', text: 'Design deleted.' };
        this.options.onChange?.();
      } else {
        this.notice = { level: 'error', text: result.error ?? 'The design could not be deleted.' };
      }
      this.render();
    }
  };

  private onChange = (event: Event): void => {
    const el = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return;
    if (el.dataset.flagLive) {
      this.gesture = false;
      return;
    }
    if (el.dataset.flagScope === 'name') {
      this.draftName = (el.value || DEFAULT_FLAG_NAME).slice(0, MAX_FLAG_NAME_LENGTH);
      this.refreshPreview();
      return;
    }
    const act = el.dataset.flagAct ?? '';
    const index = Number(el.dataset.index ?? 0);
    if (act === 'emblem-rotate') {
      const value = Number(el.value);
      this.mutate((composition) => {
        if (composition.emblem) composition.emblem.rotate = value === 90 || value === 180 || value === 270 ? value : 0;
      });
      return;
    }
    if (act === 'emblem-mirror') {
      const checked = (el as HTMLInputElement).checked;
      this.mutate((composition) => {
        if (composition.emblem) composition.emblem.mirror = checked;
      });
      return;
    }
    if (act === 'deco-kind') {
      const value = el.value as FlagDecorationId;
      this.mutate((composition) => {
        if (composition.decorations[index]) composition.decorations[index].id = value;
      });
      return;
    }
    if (act === 'deco-rotate') {
      const value = Number(el.value);
      this.mutate((composition) => {
        const decoration = composition.decorations[index];
        if (decoration) decoration.rotate = value === 90 || value === 180 || value === 270 ? value : 0;
      });
    }
  };

  private onInput = (event: Event): void => {
    const el = event.target as HTMLInputElement | null;
    if (!el) return;
    const field = el.dataset.flagLive;
    if (!field) return;
    if (!this.gesture) {
      this.pushUndo();
      this.gesture = true;
    }
    const value = Number(el.value);
    const index = Number(el.dataset.index ?? 0);
    const composition = this.draft;
    if (field === 'stripe-width') composition.stripe.width = Math.min(16, Math.max(1, value));
    if (field === 'emblem-scale' && composition.emblem) {
      composition.emblem.scale = Math.min(1.8, Math.max(0.4, value / 100));
    }
    if (field === 'emblem-x' && composition.emblem) composition.emblem.x = Math.min(30, Math.max(-30, value));
    if (field === 'emblem-y' && composition.emblem) composition.emblem.y = Math.min(20, Math.max(-20, value));
    if (field === 'deco-scale' && composition.decorations[index]) {
      composition.decorations[index].scale = Math.min(1.6, Math.max(0.3, value / 100));
    }
    this.refreshPreview();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    const next = event.shiftKey ? this.history.redo(this.draft) : this.history.undo(this.draft);
    if (next) this.draft = next;
    this.notice = null;
    this.render();
  };

  private save(): string | null {
    // The server enforces emblem entitlement; the editor explains the same
    // rule before a request is made, so a stored design with an emblem that is
    // no longer unlocked can be repaired instead of failing repeatedly.
    if (this.draft.emblem) {
      const emblem = cosmeticsByCategory('emblem').find(
        (entry) => entry.render === this.draft.emblem!.id,
      );
      if (!emblem || !isCosmeticUnlocked(emblem, this.progress())) {
        return 'That emblem is not unlocked for this profile. Choose another emblem before saving.';
      }
    }
    const store = this.options.store;
    if (this.editingId) {
      const result = store.update(this.editingId, this.draftName, this.draft);
      if (!result.ok) return result.error ?? 'The flag could not be saved.';
      this.options.onChange?.();
      return null;
    }
    const result = store.create(this.draftName, this.draft);
    if (!result.ok || !result.value) return result.error ?? 'The flag could not be saved.';
    this.editingId = result.value.id;
    this.history.clear();
    this.options.onChange?.();
    return null;
  }
}

/** Open the editor for one store. Returns the instance so a caller can close it. */
export function openFlagEditor(options: FlagEditorOptions): FlagEditor {
  const editor = new FlagEditor(options);
  editor.open();
  return editor;
}
