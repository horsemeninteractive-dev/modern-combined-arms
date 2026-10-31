import { flagNationForFaction, flagTextureUrl } from '../render/flags';
import { escapeHtml } from './modal';

/** One row in a nation picker: a playable identity and its alliance grouping. */
export interface NationPickerEntry {
  id: string;
  name: string;
  group: string;
}

/**
 * The menu's nation field. A native `<select>` cannot show a flag beside each
 * option, so this is a small listbox: a flag-and-name button that opens a panel
 * of nations grouped by alliance. Keyboard behaviour follows a listbox
 * (Enter/Space opens, arrows move, Escape closes) and a click elsewhere closes
 * the panel. The host element is supplied by the page so the menu markup and
 * the picker can never drift apart.
 */
export class NationPicker {
  private entries: NationPickerEntry[] = [];
  private value = '';
  private open = false;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLDivElement;
  private readonly onDocumentPointer = (event: PointerEvent): void => {
    if (!this.host.contains(event.target as Node)) this.setOpen(false);
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange: (id: string) => void,
  ) {
    host.classList.add('nation-picker');
    host.innerHTML = `
      <button type="button" class="nation-picker-btn" aria-haspopup="listbox" aria-expanded="false">
        <span class="nation-picker-face"></span>
        <span class="nation-picker-caret" aria-hidden="true">▾</span>
      </button>
      <div class="nation-picker-list" role="listbox" hidden></div>`;
    this.button = host.querySelector<HTMLButtonElement>('.nation-picker-btn')!;
    this.list = host.querySelector<HTMLDivElement>('.nation-picker-list')!;
    this.button.addEventListener('click', () => this.setOpen(!this.open));
    this.button.addEventListener('keydown', (event) => this.onButtonKey(event));
    this.list.addEventListener('keydown', (event) => this.onListKey(event));
    this.list.addEventListener('click', (event) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
      if (option?.dataset.value) this.choose(option.dataset.value);
    });
  }

  /** Replace the offered nations and move the selection to `value`. */
  setOptions(entries: NationPickerEntry[], value: string): void {
    const signature = entries.map((entry) => `${entry.id}:${entry.name}:${entry.group}`).join('|');
    if (this.list.dataset.signature !== signature) {
      this.entries = entries;
      this.list.dataset.signature = signature;
      this.renderList();
    }
    this.setValue(value);
  }

  /** Move the selection without firing the change callback. */
  setValue(value: string): void {
    const next = this.entries.some((entry) => entry.id === value)
      ? value
      : (this.entries[0]?.id ?? '');
    if (next === this.value) return;
    this.value = next;
    this.renderFace();
    for (const option of this.list.querySelectorAll<HTMLElement>('[data-value]')) {
      option.setAttribute('aria-selected', String(option.dataset.value === this.value));
    }
  }

  /** The currently displayed nation id. */
  getValue(): string {
    return this.value;
  }

  private flagUrl(id: string): string | undefined {
    const nation = flagNationForFaction(id);
    return nation ? flagTextureUrl(nation) : undefined;
  }

  private flagImg(id: string): string {
    const url = this.flagUrl(id);
    return url ? `<img class="nation-picker-flag" src="${url}" alt="">` : '';
  }

  private renderFace(): void {
    const current = this.entries.find((entry) => entry.id === this.value);
    if (!current) {
      this.button.querySelector('.nation-picker-face')!.innerHTML = '';
      return;
    }
    this.button.querySelector('.nation-picker-face')!.innerHTML = `
      ${this.flagImg(current.id)}
      <span class="nation-picker-name">${escapeHtml(current.name)}</span>`;
    this.button.setAttribute('aria-label', `Nation: ${current.name}`);
  }

  private renderList(): void {
    const rows: string[] = [];
    let group = '';
    for (const entry of this.entries) {
      if (entry.group !== group) {
        group = entry.group;
        rows.push(`<div class="nation-picker-group" aria-hidden="true">${escapeHtml(group)}</div>`);
      }
      rows.push(`
        <button type="button" class="nation-picker-option" role="option" data-value="${entry.id}"
          aria-selected="${entry.id === this.value}">
          ${this.flagImg(entry.id)}
          <span class="nation-picker-option-name">${escapeHtml(entry.name)}</span>
        </button>`);
    }
    this.list.innerHTML = rows.join('');
    this.renderFace();
  }

  private choose(id: string): void {
    this.setOpen(false);
    this.button.focus();
    if (id === this.value) return;
    this.setValue(id);
    this.onChange(id);
  }

  private setOpen(next: boolean): void {
    if (next === this.open) return;
    this.open = next;
    this.list.hidden = !next;
    this.host.classList.toggle('open', next);
    this.button.setAttribute('aria-expanded', String(next));
    if (next) {
      document.addEventListener('pointerdown', this.onDocumentPointer, true);
      this.list.querySelector<HTMLButtonElement>(`[data-value="${this.value}"]`)?.focus();
    } else {
      document.removeEventListener('pointerdown', this.onDocumentPointer, true);
    }
  }

  private optionsInList(): HTMLButtonElement[] {
    return [...this.list.querySelectorAll<HTMLButtonElement>('[data-value]')];
  }

  private onButtonKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.setOpen(true);
      return;
    }
    if (event.key === 'Escape' && this.open) {
      event.preventDefault();
      this.setOpen(false);
    }
  }

  private onListKey(event: KeyboardEvent): void {
    const options = this.optionsInList();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.setOpen(false);
      this.button.focus();
      return;
    }
    if (event.key === 'Tab') {
      this.setOpen(false);
      return;
    }
    if (index < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      options[(index + delta + options.length) % options.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    }
  }
}
