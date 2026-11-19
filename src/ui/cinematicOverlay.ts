/**
 * Cinematic caption and skip chrome.
 *
 * The overlay is presentation only: it binds no simulation action. Skip calls
 * back into the app, which ends the player and lets the ordinary campaign or
 * battle flow continue. Captions are real DOM text, so they are readable by a
 * screen reader and can be selected instead of being painted into the canvas.
 */
import type { CinematicCardFrame, CinematicFrame } from './cinematics';

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
  /** Preview shows pause/resume and step controls; a played scene does not. */
  preview?: boolean;
}

export class CinematicOverlay {
  private readonly root: HTMLDivElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly noticeHeading: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly caption: HTMLElement;
  private readonly veil: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardHeading: HTMLElement;
  private readonly cardSub: HTMLElement;
  private readonly cardBody: HTMLElement;
  private readonly skip: HTMLButtonElement;
  private readonly skipAll: HTMLButtonElement;
  private readonly pause: HTMLButtonElement;
  private readonly step: HTMLButtonElement;
  private readonly progress: HTMLElement;
  private onSkip: (() => void) | null = null;
  private onSkipAll: (() => void) | null = null;
  private onTogglePause: (() => void) | null = null;
  private onNextStep: (() => void) | null = null;
  private lastCaption = '';
  private lastNotice = '';
  private lastHeading = '';
  private lastPortrait = '';
  private lastCard = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'cinematic-root';
    this.root.className = 'cinematic-root hidden';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Mission cinematic');
    this.root.innerHTML = `
      <div class="cinematic-vignette" aria-hidden="true"></div>
      <div class="cinematic-veil" aria-hidden="true"></div>
      <div class="cinematic-card" hidden>
        <span class="cinematic-card-sub"></span>
        <h2 class="cinematic-card-heading"></h2>
        <p class="cinematic-card-body"></p>
      </div>
      <div class="cinematic-head">
        <span class="cinematic-eyebrow"></span>
        <b class="cinematic-title"></b>
      </div>
      <div class="cinematic-caption" aria-live="polite">
        <img class="cinematic-portrait" alt="" hidden>
        <div class="cinematic-copy">
          <span class="cinematic-speaker"></span>
          <p class="cinematic-line"></p>
          <span class="cinematic-notice-heading"></span>
          <p class="cinematic-notice"></p>
        </div>
      </div>
      <div class="cinematic-controls">
        <button type="button" class="btn btn-ghost cinematic-pause" data-cinematic="pause" hidden>
          PAUSE
        </button>
        <button type="button" class="btn btn-ghost cinematic-next" data-cinematic="next" hidden>
          NEXT BEAT
        </button>
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
    this.noticeHeading = this.root.querySelector('.cinematic-notice-heading')!;
    this.portrait = this.root.querySelector('.cinematic-portrait')!;
    this.caption = this.root.querySelector('.cinematic-caption')!;
    this.veil = this.root.querySelector('.cinematic-veil')!;
    this.card = this.root.querySelector('.cinematic-card')!;
    this.cardHeading = this.root.querySelector('.cinematic-card-heading')!;
    this.cardSub = this.root.querySelector('.cinematic-card-sub')!;
    this.cardBody = this.root.querySelector('.cinematic-card-body')!;
    this.skip = this.root.querySelector('.cinematic-skip')!;
    this.skipAll = this.root.querySelector('.cinematic-skip-all')!;
    this.pause = this.root.querySelector('.cinematic-pause')!;
    this.step = this.root.querySelector('.cinematic-next')!;
    this.progress = this.root.querySelector('.cinematic-progress i')!;
    this.skip.addEventListener('click', () => this.onSkip?.());
    this.skipAll.addEventListener('click', () => this.onSkipAll?.());
    this.pause.addEventListener('click', () => this.onTogglePause?.());
    this.step.addEventListener('click', () => this.onNextStep?.());
  }

  bind(handlers: {
    onSkip: () => void;
    onSkipAll: () => void;
    onTogglePause?: () => void;
    onNextStep?: () => void;
  }): void {
    this.onSkip = handlers.onSkip;
    this.onSkipAll = handlers.onSkipAll;
    this.onTogglePause = handlers.onTogglePause ?? null;
    this.onNextStep = handlers.onNextStep ?? null;
  }

  show(options: CinematicOverlayOptions): void {
    this.eyebrow.textContent = options.eyebrow;
    this.title.textContent = options.title;
    this.speaker.textContent = '';
    this.line.textContent = '';
    this.notice.textContent = '';
    this.noticeHeading.textContent = '';
    this.portrait.hidden = true;
    this.portrait.removeAttribute('src');
    this.lastCaption = '';
    this.lastNotice = '';
    this.lastHeading = '';
    this.lastPortrait = '';
    this.lastCard = '';
    this.veil.style.opacity = '0';
    this.card.hidden = true;
    this.skip.hidden = !options.skippable;
    this.skip.disabled = !options.skippable;
    this.pause.hidden = !options.preview;
    this.step.hidden = !options.preview;
    this.pause.textContent = 'PAUSE';
    this.root.classList.remove('hidden');
    document.body.classList.toggle('cinematic-active', options.framing);
    if (options.skippable) this.skip.focus({ preventScroll: true });
  }

  render(frame: CinematicFrame): void {
    const caption = frame.line
      ? `${frame.speaker ?? ''}\u0000${frame.line}\u0000${frame.portrait ?? ''}\u0000${frame.radio ? 'radio' : 'scene'}`
      : '';
    if (caption !== this.lastCaption) {
      this.lastCaption = caption;
      this.speaker.textContent = frame.line ? (frame.speaker ?? '') : '';
      this.line.textContent = frame.line ?? '';
      this.caption.classList.toggle('radio', frame.line !== null && frame.radio);
      // The line element is the live region; clear it when the beat ends so a
      // reader does not announce stale dialogue between lines.
      this.line.setAttribute('aria-hidden', frame.line ? 'false' : 'true');
    }
    const portrait = frame.line ? (frame.portrait ?? '') : '';
    if (portrait !== this.lastPortrait) {
      this.lastPortrait = portrait;
      if (portrait) {
        this.portrait.src = portrait;
        this.portrait.alt = frame.speaker ?? '';
        this.portrait.hidden = false;
      } else {
        this.portrait.hidden = true;
        this.portrait.removeAttribute('src');
        this.portrait.alt = '';
      }
    }
    if ((frame.noticeHeading ?? '') !== this.lastHeading) {
      this.lastHeading = frame.noticeHeading ?? '';
      this.noticeHeading.textContent = frame.noticeHeading ?? '';
    }
    if ((frame.notice ?? '') !== this.lastNotice) {
      this.lastNotice = frame.notice ?? '';
      this.notice.textContent = frame.notice ?? '';
    }
    this.renderCard(frame.card);
    this.veil.style.opacity = frame.veil <= 0.001 ? '0' : frame.veil.toFixed(3);
    this.pause.textContent = frame.paused ? 'RESUME' : 'PAUSE';
    this.progress.style.width = `${(frame.progress * 100).toFixed(2)}%`;
  }

  private renderCard(card: CinematicCardFrame | null): void {
    const key = card ? `${card.heading}\u0000${card.subheading ?? ''}\u0000${card.body ?? ''}` : '';
    if (key === this.lastCard) return;
    this.lastCard = key;
    this.card.hidden = !card;
    if (!card) {
      this.cardHeading.textContent = '';
      this.cardSub.textContent = '';
      this.cardBody.textContent = '';
      return;
    }
    this.cardHeading.textContent = card.heading;
    this.cardSub.textContent = card.subheading ?? '';
    this.cardBody.textContent = card.body ?? '';
  }

  hide(): void {
    this.root.classList.add('hidden');
    document.body.classList.remove('cinematic-active');
    this.veil.style.opacity = '0';
    this.card.hidden = true;
    this.lastCard = '';
    this.lastCaption = '';
    this.lastNotice = '';
    this.lastHeading = '';
    this.lastPortrait = '';
    this.portrait.removeAttribute('src');
  }
}
