/**
 * The menu's multiplayer deck: host or join a room, choose nation and colour,
 * ready up, and start the match as host.
 *
 * Presentation only. Every rule that matters — who may start, what is a legal
 * nation or colour, whether both seats are ready — is decided by the room and
 * arrived at through `LobbyClient`. When the room refuses something, the panel
 * shows the room's own code and message instead of guessing.
 */
import { NATIONS, PLAYABLE_NATION_IDS } from '../data/factions';
import { BUILTIN_SCENARIOS } from '../data/scenarios';
import { LOBBY_COLORS, MAX_MATCH_DURATION_MS, MIN_MATCH_DURATION_MS } from '../multiplayer/lobbyConfig';
import { LobbyClient, type LobbyView } from '../multiplayer/lobbyClient';
import { NationPicker, type NationPickerEntry } from './nationPicker';
import { escapeHtml } from './modal';

export interface MultiplayerPanelOptions {
  /** Worker origin, e.g. https://mca-multiplayer-staging.example.workers.dev */
  origin: string;
  onChange?: (view: LobbyView) => void;
  /**
   * Called once when the room confirms the match started. The host screen
   * hands the seat's stream to the battle view here; the deck keeps the socket
   * and stops drawing lobby markup while the battlefield owns the screen.
   */
  onMatchStart?: (client: LobbyClient, view: LobbyView) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Offered match lengths. The room reserves the match plus a lobby allowance,
 * and caps that reservation at the 30-minute hard limit, so a duration equal to
 * the cap would leave no window to start in. The longest offered length keeps
 * the whole lobby allowance available.
 */
const DURATIONS: Array<{ label: string; ms: number }> = [
  { label: '5 MIN', ms: 5 * 60_000 },
  { label: '10 MIN', ms: 10 * 60_000 },
  { label: '20 MIN', ms: 20 * 60_000 },
  { label: '25 MIN', ms: 25 * 60_000 },
];

const NATION_ENTRIES: NationPickerEntry[] = PLAYABLE_NATION_IDS.map((id) => ({
  id,
  name: NATIONS[id]?.name ?? id,
  group: NATIONS[id]?.allianceId ?? 'other',
}));

function mapName(mapId: string | null): string {
  const entry = BUILTIN_SCENARIOS.find((scenario) => scenario.id === mapId);
  return entry?.name ?? mapId ?? 'Unknown theatre';
}

function minutes(ms: number): string {
  if (!ms) return '—';
  const value = Math.round(ms / 60_000);
  return `${value} MIN`;
}

function nationName(id: string | null): string {
  if (!id) return '—';
  return NATIONS[id]?.name ?? id;
}

export class MultiplayerPanel {
  private readonly host: HTMLElement;
  private readonly clientInstance: LobbyClient | null;
  private readonly options: MultiplayerPanelOptions;
  private picker: NationPicker | null = null;
  private durationIndex = 1;
  private mounted = false;
  private matchHandedOff = false;
  private view: LobbyView;

  /** The seat's connection, once the deck has one; null before hosting/joining. */
  get client(): LobbyClient | null {
    return this.clientInstance;
  }

  constructor(host: HTMLElement, options: MultiplayerPanelOptions) {
    this.host = host;
    this.options = options;
    this.clientInstance = options.origin
      ? new LobbyClient({
          origin: options.origin,
          fetch: options.fetchImpl,
          onChange: (view) => this.render(view),
        })
      : null;
    this.view = emptyView();
    this.render(this.view);
  }

  /** Called whenever the menu switches to the multiplayer view. */
  show(): void {
    this.mounted = true;
    // Coming back from a battle or another menu level re-renders whatever the
    // room last said; the socket keeps running while the deck is hidden.
    this.render(this.view);
  }

  hide(): void {
    this.mounted = false;
  }

  destroy(): void {
    this.clientInstance?.leave();
  }

  /** Give the seat back to the deck after a networked battle ends. */
  returnFromBattle(): void {
    this.matchHandedOff = false;
    this.render(this.view);
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  private render(view: LobbyView): void {
    this.view = view;
    this.options.onChange?.(view);
    if (!this.mounted) return;
    if (!this.clientInstance) {
      this.host.innerHTML = this.unavailableMarkup();
      return;
    }
    if (view.phase === 'playing') {
      if (!this.matchHandedOff) {
        this.matchHandedOff = true;
        this.options.onMatchStart?.(this.clientInstance, view);
        return;
      }
      this.renderMatch(view);
      return;
    }
    if (view.phase === 'lobby' || view.phase === 'closed') {
      this.renderLobby(view);
      return;
    }
    this.renderEntry(view);
  }

  private unavailableMarkup(): string {
    return `
      <div class="mp-shell">
        <div class="menu-view-head">
          <p class="eyebrow">NETWORK PLAY</p>
          <h2>Multiplayer <em>not configured</em></h2>
          <p class="lede">
            This build has no multiplayer worker address. Set
            <code>VITE_MULTIPLAYER_URL</code> to the staging room worker origin and rebuild,
            or run the worker locally on <code>http://127.0.0.1:8791</code> during development.
          </p>
        </div>
      </div>`;
  }

  private renderEntry(view: LobbyView): void {
    const busy = view.phase === 'creating' || view.phase === 'joining';
    const error = view.error
      ? `<p class="mp-error" role="alert">${escapeHtml(view.error.message)} <span class="mono">${escapeHtml(view.error.code)}</span></p>`
      : '';
    this.host.innerHTML = `
      <div class="mp-shell">
        <div class="menu-view-head">
          <p class="eyebrow">NETWORK PLAY · 1V1</p>
          <h2>Multiplayer</h2>
          <p class="lede">
            Two players, one authoritative room. Host a match and share the room code
            and join code, or join a room someone shared with you.
          </p>
        </div>
        ${error}
        <div class="mp-columns">
          <section class="mp-card">
            <span class="mp-card-head">HOST A MATCH</span>
            <label class="mp-field">
              <span>Match length</span>
              <select id="mp-duration" ${busy ? 'disabled' : ''}>
                ${DURATIONS.map(
                  (entry, index) =>
                    `<option value="${entry.ms}" ${index === this.durationIndex ? 'selected' : ''}>${entry.label}</option>`,
                ).join('')}
              </select>
            </label>
            <p class="mp-hint">
              The room reserves capacity — the match plus time to fill the lobby — before the
              first player joins.
            </p>
            <button class="btn btn-primary mp-action" id="mp-host" ${busy ? 'disabled' : ''}>
              ${view.phase === 'creating' ? 'OPENING ROOM…' : 'HOST A ROOM'}
            </button>
          </section>
          <section class="mp-card">
            <span class="mp-card-head">JOIN A ROOM</span>
            <label class="mp-field">
              <span>Room code</span>
              <input id="mp-room-code" autocomplete="off" spellcheck="false" maxlength="24"
                placeholder="e.g. kestrel-7" ${busy ? 'disabled' : ''} value="${escapeHtml(view.roomId ?? '')}">
            </label>
            <label class="mp-field">
              <span>Join code</span>
              <input id="mp-join-code" autocomplete="off" spellcheck="false" maxlength="24"
                placeholder="10 characters from your host" ${busy ? 'disabled' : ''}>
            </label>
            <button class="btn mp-action" id="mp-join" ${busy ? 'disabled' : ''}>
              ${view.phase === 'joining' ? 'JOINING…' : 'JOIN ROOM'}
            </button>
          </section>
        </div>
        <p class="mp-foot">
          Matches are timed and server-authoritative. A room holds its capacity slot for
          at most five minutes before the host starts.
        </p>
      </div>`;
    this.bindEntry();
  }

  private bindEntry(): void {
    const client = this.clientInstance;
    if (!client) return;
    const duration = this.host.querySelector<HTMLSelectElement>('#mp-duration');
    duration?.addEventListener('change', () => {
      this.durationIndex = Math.max(
        0,
        DURATIONS.findIndex((entry) => String(entry.ms) === duration.value),
      );
    });
    this.host.querySelector('#mp-host')?.addEventListener('click', () => {
      const chosen = DURATIONS[this.durationIndex] ?? DURATIONS[1];
      void client.createRoom(chosen.ms);
    });
    const join = () => {
      const roomCode = this.host.querySelector<HTMLInputElement>('#mp-room-code')?.value.trim();
      const joinCode = this.host.querySelector<HTMLInputElement>('#mp-join-code')?.value.trim();
      if (!roomCode || !joinCode) {
        this.render({
          ...this.view,
          phase: 'failed',
          error: { code: 'missing-code', message: 'Enter both the room code and the join code.' },
        });
        return;
      }
      void client.joinRoom(roomCode, joinCode);
    };
    this.host.querySelector('#mp-join')?.addEventListener('click', join);
    this.host.querySelectorAll<HTMLInputElement>('.mp-field input').forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') join();
      });
    });
  }

  private renderLobby(view: LobbyView): void {
    const seats = view.seats;
    const mine = view.seat ?? 0;
    const hostSeat = view.hostSeat;
    const seatCard = (index: number): string => {
      const seat = seats[index];
      const isYou = index === mine;
      const label = index === hostSeat ? 'HOST' : 'GUEST';
      if (!seat) {
        return `<section class="mp-card mp-seat"><span class="mp-card-head">${label}</span>
          <p class="mp-seat-name">Waiting for a player</p></section>`;
      }
      return `<section class="mp-card mp-seat ${isYou ? 'is-you' : ''}">
        <span class="mp-card-head">${label}${isYou ? ' · YOU' : ''}</span>
        <p class="mp-seat-name">
          <span class="mp-swatch" style="background:${escapeHtml(seat.color)}"></span>
          ${escapeHtml(nationName(seat.nation))}
        </p>
        <p class="mp-seat-state">
          <span class="${seat.connected ? 'mp-on' : 'mp-off'}">${seat.connected ? 'CONNECTED' : 'OFFLINE'}</span>
          <span class="${seat.ready ? 'mp-on' : 'mp-off'}">${seat.ready ? 'READY' : 'NOT READY'}</span>
        </p>
      </section>`;
    };

    const colourButtons = LOBBY_COLORS.map(
      (color) => `<button type="button" class="mp-color ${view.color === color ? 'on' : ''}"
        data-color="${color}" style="background:${color}" aria-label="Colour ${color}"
        ${view.phase !== 'lobby' ? 'disabled' : ''}></button>`,
    ).join('');

    const startDisabled = !view.isHost || !canStart(view);
    const notice = view.notice
      ? `<p class="mp-notice ${view.noticeKind === 'error' ? 'is-error' : ''}">${escapeHtml(view.notice)}</p>`
      : '';

    this.host.innerHTML = `
      <div class="mp-shell">
        <div class="menu-view-head">
          <p class="eyebrow">NETWORK PLAY · ${escapeHtml(mapName(view.mapId))}</p>
          <h2>Lobby <em>${escapeHtml(minutes(view.matchDurationMs))}</em></h2>
        </div>
        <div class="mp-lobby-bar">
          <div class="mp-code">
            <span class="mp-code-label">ROOM CODE</span>
            <strong id="mp-room-value">${escapeHtml(view.roomId ?? '')}</strong>
            <button class="btn btn-ghost mp-copy" id="mp-copy-room">COPY</button>
          </div>
          ${
            view.joinCode
              ? `<div class="mp-code">
                  <span class="mp-code-label">JOIN CODE</span>
                  <strong id="mp-join-value">${escapeHtml(view.joinCode)}</strong>
                  <button class="btn btn-ghost mp-copy" id="mp-copy-join">COPY</button>
                </div>`
              : '<div class="mp-code"><span class="mp-code-label">JOIN CODE</span><strong>••••••••••</strong></div>'
          }
        </div>
        ${notice}
        <div class="mp-columns">
          ${seatCard(0)}
          ${seatCard(1)}
        </div>
        <div class="mp-columns">
          <section class="mp-card">
            <span class="mp-card-head">YOUR NATION</span>
            <div class="mp-nation" id="mp-nation-host"></div>
            <p class="mp-hint">Changing nation or colour clears your ready state.</p>
            <span class="mp-card-head">YOUR COLOUR</span>
            <div class="mp-colors" role="group" aria-label="Player colour">${colourButtons}</div>
          </section>
          <section class="mp-card">
            <span class="mp-card-head">MATCH CONTROL</span>
            <p class="mp-hint">
              ${view.isHost
                ? 'You are the host: the match starts only when you confirm and both players are ready.'
                : 'The host starts the match once both players are ready.'}
            </p>
            <label class="mp-ready">
              <input type="checkbox" id="mp-ready" ${view.ready ? 'checked' : ''} ${view.phase !== 'lobby' ? 'disabled' : ''}>
              <span>Ready to deploy</span>
            </label>
            <button class="btn btn-primary mp-action" id="mp-start" ${startDisabled ? 'disabled' : ''}>START MATCH</button>
            <p class="mp-hint" id="mp-start-hint">${escapeHtml(startHint(view))}</p>
            <button class="btn btn-danger mp-action" id="mp-leave">LEAVE ROOM</button>
          </section>
        </div>
      </div>`;
    this.bindLobby();
  }

  private bindLobby(): void {
    const client = this.clientInstance;
    if (!client) return;

    const nationHost = this.host.querySelector<HTMLElement>('#mp-nation-host');
    if (nationHost) {
      this.picker = new NationPicker(nationHost, (id) => {
        client.setNation(id);
      });
      this.picker.setOptions(NATION_ENTRIES, this.view.nation ?? NATION_ENTRIES[0]?.id ?? '');
    }

    this.host.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => {
      button.addEventListener('click', () => {
        const color = button.dataset.color;
        if (color) client.setColor(color);
      });
    });
    this.host.querySelector<HTMLInputElement>('#mp-ready')?.addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      client.setReady(input.checked);
    });
    this.host.querySelector('#mp-start')?.addEventListener('click', () => {
      void client.startMatch();
    });
    this.host.querySelector('#mp-leave')?.addEventListener('click', () => client.leave());
    this.host.querySelector('#mp-copy-room')?.addEventListener('click', () => {
      void this.copy(this.view.roomId ?? '');
    });
    this.host.querySelector('#mp-copy-join')?.addEventListener('click', () => {
      void this.copy(this.view.joinCode ?? '');
    });
  }

  private renderMatch(view: LobbyView): void {
    const match = view.match;
    const opponent = view.seats[1 - (view.seat ?? 0)];
    this.host.innerHTML = `
      <div class="mp-shell">
        <div class="menu-view-head">
          <p class="eyebrow">MATCH LIVE · ${escapeHtml(mapName(view.mapId))}</p>
          <h2>Deployed <em>${escapeHtml(minutes(view.matchDurationMs))}</em></h2>
          <p class="lede">
            The room is authoritative and both seats are receiving the match stream.
          </p>
        </div>
        <div class="mp-columns">
          <section class="mp-card">
            <span class="mp-card-head">AUTHORITATIVE STATE</span>
            <dl class="mp-stats">
              <dt>Tick</dt><dd>${match?.tick ?? 0}</dd>
              <dt>Materials</dt><dd>${Math.round(match?.mats ?? 0)}</dd>
              <dt>Requisition</dt><dd>${Math.round(match?.req ?? 0)}</dd>
              <dt>Your units</dt><dd>${match?.units ?? 0}</dd>
              <dt>Your structures</dt><dd>${match?.ownStructureCount ?? 0}</dd>
              <dt>Visible contacts</dt><dd>${match?.visibleEnemies ?? 0}</dd>
            </dl>
          </section>
          <section class="mp-card">
            <span class="mp-card-head">OPPONENT</span>
            <p class="mp-seat-name">
              ${opponent ? `<span class="mp-swatch" style="background:${escapeHtml(opponent.color)}"></span>${escapeHtml(nationName(opponent.nation))}` : 'Unknown'}
            </p>
            <p class="mp-seat-state">
              <span class="${opponent?.connected ? 'mp-on' : 'mp-off'}">${opponent?.connected ? 'CONNECTED' : 'OFFLINE'}</span>
            </p>
            <p class="mp-hint">
              This is the live match stream: tick, economy and your team-visible contacts,
              reconstructed from the room's sync/delta messages.
            </p>
          </section>
        </div>
        <p class="mp-foot">
          The battlefield view for network matches is the next milestone. The room, the
          authority and both seats are running now.
        </p>
      </div>`;
  }

  private async copy(value: string): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* Clipboard may be blocked; the code is on screen either way. */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

export function canStart(view: LobbyView): boolean {
  if (!view.isHost) return false;
  if (view.seats.length !== 2) return false;
  return view.seats.every((seat) => seat.ready && seat.connected);
}

export function startHint(view: LobbyView): string {
  if (!view.isHost) return 'Waiting for the host to start.';
  if (view.seats.length !== 2) return 'Waiting for both seats.';
  if (view.seats.some((seat) => !seat.connected)) return 'Both players must be connected.';
  if (view.seats.some((seat) => !seat.ready)) return 'Both players must be ready.';
  return 'Ready when you are.';
}

export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return 10 * 60_000;
  return Math.min(MAX_MATCH_DURATION_MS, Math.max(MIN_MATCH_DURATION_MS, Math.round(ms)));
}

function emptyView(): LobbyView {
  return {
    phase: 'idle',
    socket: 'idle',
    roomId: null,
    seat: null,
    joinCode: null,
    mapId: null,
    matchDurationMs: 0,
    hostSeat: 0,
    seats: [],
    ready: false,
    nation: null,
    color: null,
    isHost: false,
    match: null,
    notice: null,
    noticeKind: 'info',
    error: null,
  };
}
