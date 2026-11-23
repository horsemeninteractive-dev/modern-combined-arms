/**
 * The Outbreak leaderboard screen.
 *
 * It owns only presentation: which board is open (map, solo or duo, difficulty),
 * and how a fetched board is laid out. Every number, name and rank comes from
 * the account service, and a failed or unavailable service is a stated condition
 * on the screen rather than an empty table that reads as "no one has ever
 * played".
 *
 * A board is the ground as much as the mode: the maps ask different things of a
 * defence, so each keeps its own table. The map picker therefore sits first —
 * the reader chooses where the run happened, then who it was and how hard.
 */
import type { HttpAccountApi } from '../accounts/client';
import { AccountApiError } from '../accounts/client';
import {
  DEFAULT_OUTBREAK_BOARD_MAP,
  OUTBREAK_BOARD_DIFFICULTIES,
  OUTBREAK_BOARD_MAPS,
  type OutbreakBoard,
  type OutbreakBoardDifficulty,
  type OutbreakBoardEntry,
  type OutbreakBoardMode,
} from '../accounts/outbreakBoard';
import { OUTBREAK_MAPS } from '../outbreak/maps';

const MODE_LABEL: Record<OutbreakBoardMode, string> = {
  solo: 'Solo',
  coop: 'Duo',
};

const MODE_BLURB: Record<OutbreakBoardMode, string> = {
  solo: 'One commander, one defence.',
  coop: 'Two commanders sharing the post.',
};

/** The catalogue name of a board's map, falling back to its id. */
function mapName(id: string): string {
  return OUTBREAK_MAPS.find((map) => map.id === id)?.name ?? id;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

function messageFor(error: unknown): string {
  if (error instanceof AccountApiError) {
    if (error.status === 401) return 'Sign in under Account to see your own standing.';
    if (error.status === 503) return 'Leaderboards are not configured on this deployment.';
    if (error.code === 'network') return 'The leaderboard service could not be reached.';
    return error.message;
  }
  return 'The leaderboard service could not be reached.';
}

export class OutbreakLeaderboardView {
  private mode: OutbreakBoardMode = 'solo';
  private map: string = DEFAULT_OUTBREAK_BOARD_MAP;
  private difficulty: OutbreakBoardDifficulty = 'normal';
  private board: OutbreakBoard | null = null;
  private error: string | null = null;
  private loading = false;
  /** Only the newest request may paint, so fast tab clicks cannot cross over. */
  private requestSeq = 0;
  private readonly onApi: () => HttpAccountApi | null;

  constructor(
    private readonly host: HTMLElement,
    options: { api: () => HttpAccountApi | null },
  ) {
    this.onApi = options.api;
  }

  /**
   * Open the screen on a board, re-reading it so a new run has already landed.
   * With no arguments it reopens the board the reader last chose.
   */
  show(mode?: OutbreakBoardMode, map?: string): void {
    if (mode) this.mode = mode;
    if (map && OUTBREAK_BOARD_MAPS.includes(map)) this.map = map;
    this.mount();
    this.refresh();
  }

  /** Read the current board again (used when the deck returns to this route). */
  refresh(): void {
    const seq = ++this.requestSeq;
    const api = this.onApi();
    this.error = null;
    if (!api) {
      this.loading = false;
      this.board = null;
      this.error = 'Leaderboards are not available in this build.';
      this.render();
      return;
    }
    this.loading = true;
    this.render();
    api
      .outbreakBoard(this.mode, this.difficulty, this.map)
      .then((board) => {
        if (seq !== this.requestSeq) return;
        this.board = board;
        this.loading = false;
        this.render();
      })
      .catch((error: unknown) => {
        if (seq !== this.requestSeq) return;
        this.board = null;
        this.loading = false;
        this.error = messageFor(error);
        this.render();
      });
  }

  /** Build the fixed chrome once and delegate its clicks. */
  private mount(): void {
    if (this.host.dataset.mounted === 'true') return;
    this.host.dataset.mounted = 'true';
    this.host.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const mapButton = target?.closest<HTMLButtonElement>('[data-board-map]');
      if (mapButton) {
        const map = mapButton.dataset.boardMap;
        if (!map || !OUTBREAK_BOARD_MAPS.includes(map) || map === this.map) return;
        this.map = map;
        this.refresh();
        return;
      }
      const modeButton = target?.closest<HTMLButtonElement>('[data-board-mode]');
      if (modeButton) {
        const mode = modeButton.dataset.boardMode;
        if (mode !== 'solo' && mode !== 'coop') return;
        if (mode === this.mode) return;
        this.mode = mode;
        this.refresh();
        return;
      }
      const difficultyButton = target?.closest<HTMLButtonElement>('[data-board-difficulty]');
      if (difficultyButton) {
        const difficulty = difficultyButton.dataset.boardDifficulty;
        if (!OUTBREAK_BOARD_DIFFICULTIES.includes(difficulty as OutbreakBoardDifficulty)) return;
        if (difficulty === this.difficulty) return;
        this.difficulty = difficulty as OutbreakBoardDifficulty;
        this.refresh();
      }
    });
    this.render();
  }

  private render(): void {
    const maps = OUTBREAK_BOARD_MAPS.map((id) => {
      const on = id === this.map;
      return `<button type="button" class="difficulty-btn${on ? ' on' : ''}"
        data-board-map="${escape(id)}" aria-pressed="${on}">${escape(mapName(id).toUpperCase())}</button>`;
    }).join('');
    const modes = (['solo', 'coop'] as const)
      .map(
        (mode) => `
          <button type="button" class="board-tab${mode === this.mode ? ' on' : ''}"
            data-board-mode="${mode}" aria-pressed="${mode === this.mode}">
            <b>${MODE_LABEL[mode]}</b>
            <small>${MODE_BLURB[mode]}</small>
          </button>`,
      )
      .join('');
    const difficulties = OUTBREAK_BOARD_DIFFICULTIES.map((id) => {
      const on = id === this.difficulty;
      return `<button type="button" class="difficulty-btn${on ? ' on' : ''}"
        data-board-difficulty="${id}" aria-pressed="${on}">${escape(nameOfDifficulty(id))}</button>`;
    }).join('');

    this.host.innerHTML = `
      <div class="outbreak-board-top">
        <div class="outbreak-board-map" role="group" aria-label="Board battlefield">${maps}</div>
        <div class="outbreak-board-modes" role="group" aria-label="Outbreak board">${modes}</div>
        <div class="outbreak-board-difficulty" role="group" aria-label="Board difficulty">${difficulties}</div>
      </div>
      <p class="outbreak-board-status" role="status" aria-live="polite">${escape(this.statusLine())}</p>
      ${this.ownRow()}
      ${this.table()}
      <p class="outbreak-board-note">A finished run posts your best wave to the board for its map, mode and difficulty. Sign in under Account to appear by name; guests can read every board.</p>
    `;
  }

  private statusLine(): string {
    if (this.loading) return 'Reading the network…';
    if (this.error) return this.error;
    if (!this.board) return '';
    const count = this.board.entries.length;
    const where = mapName(this.board.map);
    if (count === 0) return `${where} · no runs on this board yet. Be the first to hold a wave.`;
    return `${where} · ${MODE_LABEL[this.board.mode]} · ${nameOfDifficulty(this.board.difficulty)} · ${count} of the longest holds.`;
  }

  private ownRow(): string {
    const board = this.board;
    if (!board || this.loading) return '';
    if (!board.signedIn) return '';
    if (!board.own) {
      return `<div class="outbreak-board-own empty"><span>YOUR BEST</span><b>No run posted yet</b></div>`;
    }
    const own = board.own;
    return `
      <div class="outbreak-board-own">
        <span>YOUR BEST</span>
        <b>#${own.rank} · wave ${own.wave} · ${own.zombiesKilled} kills · ${clock(own.durationSeconds)}</b>
      </div>`;
  }

  private table(): string {
    const board = this.board;
    if (!board || this.loading || board.entries.length === 0) return '';
    const rows = board.entries.map((entry) => this.row(entry)).join('');
    return `
      <div class="outbreak-board-table">
        <div class="outbreak-board-head" aria-hidden="true">
          <span>#</span><span>COMMANDER</span><span>WAVE</span><span>KILLS</span><span>SURVIVED</span>
        </div>
        ${rows}
      </div>`;
  }

  private row(entry: OutbreakBoardEntry): string {
    const seconds = clock(entry.durationSeconds);
    return `
      <div class="outbreak-board-row${entry.you ? ' you' : ''}">
        <span class="board-rank">${entry.rank}</span>
        <span class="board-name">${escape(entry.callsign)}${entry.you ? '<i>YOU</i>' : ''}</span>
        <span class="board-wave">${entry.wave}</span>
        <span class="board-kills">${entry.zombiesKilled}</span>
        <span class="board-time">${seconds}</span>
      </div>`;
  }
}

function nameOfDifficulty(id: OutbreakBoardDifficulty): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
