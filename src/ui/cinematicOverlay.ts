/**
 * Cinematic caption and skip chrome.
 *
 * The overlay is presentation only: it binds no simulation action. Skip calls
 * back into the app, which ends the player and lets the ordinary campaign or
 * battle flow continue. Captions are real DOM text, so they are readable by a
 * screen reader and can be selected instead of being painted into the canvas.
 */
import type { CinematicFrame } from './cinematics';

export interface CinematicOverlayOptions {
  /** Operation or campaign title shown above the caption. */
  eyebrow: string;
  title: string;
  skippable: boolean;
  /**
   * True for framing scenes (opening, intermission, ending), which hide the
   * battle HUD. An in-mission sequence leaves the HUD readable.
   */
  framing: boolean;
}

export class CinematicOverlay {
  private readonly root: HTMLDivElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly skip: HTMLButtonElement;
  private readonly skipAll: HTMLButtonElement;
  private readonly progress: HTMLElement;
  private onSkip: (() => void) | null = null;
  private onSkipAll: (() => void) | null = null;
  private lastCaption = '';
  private lastNotice = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'cinematic-root';
    this.root.className = 'cinematic-root hidden';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Mission cinematic');
    this.root.innerHTML = `
      <div class="cinematic-vignette" aria-hidden="true"></div>
      <div class="cinematic-head">
        <span class="cinematic-eyebrow"></span>
        <b class="cinematic-title"></b>
      </div>
      <div class="cinematic-caption" aria-live="polite">
        <span class="cinematic-speaker"></span>
        <p class="cinematic-line"></p>
        <p class="cinematic-notice"></p>
      </div>
      <div class="cinematic-controls">
        <button type="button" class="btn btn-primary cinematic-skip" data-cinematic="skip">
          SKIP SCENE
        </button>
        <button type="button" class="btn btn-ghost cinematic-skip-all" data-cinematic="skip-all">
          SKIP ALL CINEMATICS
        </button>
        <span class="cinematic-hint">SPACE / ESC</span>
      </div>
      <div class="cinematic-progress" aria-hidden="true"><i></i></div>
    `;
    document.body.appendChild(this.root);
    this.eyebrow = this.root.querySelector('.cinematic-eyebrow')!;
    this.title = this.root.querySelector('.cinematic-title')!;
    this.speaker = this.root.querySelector('.cinematic-speaker')!;
    this.line = this.root.querySelector('.cinematic-line')!;
    this.notice = this.root.querySelector('.cinematic-notice')!;
    this.skip = this.root.querySelector('.cinematic-skip')!;
    this.skipAll = this.root.querySelector('.cinematic-skip-all')!;
    this.progress = this.root.querySelector('.cinematic-progress i')!;
    this.skip.addEventListener('click', () => this.onSkip?.());
    this.skipAll.addEventListener('click', () => this.onSkipAll?.());
  }

  bind(handlers: { onSkip: () => void; onSkipAll: () => void }): void {
    this.onSkip = handlers.onSkip;
    this.onSkipAll = handlers.onSkipAll;
  }

  show(options: CinematicOverlayOptions): void {
    this.eyebrow.textContent = options.eyebrow;
    this.title.textContent = options.title;
    this.speaker.textContent = '';
    this.line.textContent = '';
    this.notice.textContent = '';
    this.lastCaption = '';
    this.lastNotice = '';
    this.skip.hidden = !options.skippable;
    this.skip.disabled = !options.skippable;
    this.root.classList.remove('hidden');
    document.body.classList.toggle('cinematic-active', options.framing);
    if (options.skippable) this.skip.focus({ preventScroll: true });
  }

  render(frame: CinematicFrame): void {
    const caption = frame.line ? `${frame.speaker ?? ''}\u0000${frame.line}` : '';
    if (caption !== this.lastCaption) {
      this.lastCaption = caption;
      this.speaker.textContent = frame.line ? (frame.speaker ?? '') : '';
      this.line.textContent = frame.line ?? '';
      // The line element is the live region; clear it when the beat ends so a
      // reader does not announce stale dialogue between lines.
      this.line.setAttribute('aria-hidden', frame.line ? 'false' : 'true');
    }
    if ((frame.notice ?? '') !== this.lastNotice) {
      this.lastNotice = frame.notice ?? '';
      this.notice.textContent = frame.notice ?? '';
    }
    this.progress.style.width = `${(frame.progress * 100).toFixed(2)}%`;
  }

  hide(): void {
    this.root.classList.add('hidden');
    document.body.classList.remove('cinematic-active');
    this.lastCaption = '';
    this.lastNotice = '';
  }
}
