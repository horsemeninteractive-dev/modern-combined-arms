import { musicTrack } from './musicCatalogue';
import {
  MUSIC_REPEAT_LABELS,
  MUSIC_REPEAT_MODES,
  type MusicPlaylistPreferences,
} from './musicPlaylist';
import type { MatchMusicSnapshot } from './matchMusic';
import { escapeHtml } from './modal';

/**
 * The battle playlist editor, shared by the menu Settings view and the
 * in-battle settings modal. Markup is generated once; syncMusicPanel updates
 * the live state in place so opening settings never restarts the current track.
 */

function stateLabel(enabled: boolean, current: boolean, state: MatchMusicSnapshot): string {
  if (current) {
    if (state.paused) return 'Current · paused';
    if (state.preview) return 'Current · preview';
    return 'Current · playing';
  }
  return enabled ? 'In playlist' : 'Excluded';
}

function nowStatus(state: MatchMusicSnapshot): string {
  if (state.preview) return 'Preview';
  if (state.paused) return 'Paused';
  if (state.running && state.playing) return 'In battle';
  if (state.running) return 'Standby';
  if (state.playing) return 'Preview';
  return 'Idle';
}

function trackRows(preferences: MusicPlaylistPreferences, state: MatchMusicSnapshot): string {
  const enabled = new Set(preferences.enabled);
  const currentId = state.trackId;
  return preferences.order
    .map((id) => {
      const track = musicTrack(id);
      if (!track) return '';
      const isEnabled = enabled.has(id);
      const isCurrent = currentId === id;
      const first = preferences.order[0] === id;
      const last = preferences.order[preferences.order.length - 1] === id;
      return `
        <li class="music-track${isCurrent ? ' is-current' : ''}${isEnabled ? '' : ' is-off'}"
          data-music-track="${escapeHtml(track.id)}"
          aria-current="${isCurrent ? 'true' : 'false'}">
          <button type="button" class="music-track-toggle" role="switch"
            data-music-toggle="${escapeHtml(track.id)}"
            aria-checked="${isEnabled ? 'true' : 'false'}"
            aria-label="${isEnabled ? 'Remove' : 'Add'} ${escapeHtml(track.title)} ${isEnabled ? 'from' : 'to'} the battle playlist"
            title="${isEnabled ? 'Exclude from playlist' : 'Include in playlist'}"><span aria-hidden="true"></span></button>
          <div class="music-track-text">
            <strong>${escapeHtml(track.title)}</strong>
            <small>${escapeHtml(track.subtitle)}</small>
            <span class="music-track-state" data-music-state>${stateLabel(isEnabled, isCurrent, state)}</span>
          </div>
          <div class="music-track-order" role="group" aria-label="Reorder ${escapeHtml(track.title)}">
            <button type="button" data-music-move="${escapeHtml(track.id)}" data-direction="-1"
              aria-label="Move ${escapeHtml(track.title)} up" title="Move up"${first ? ' disabled' : ''}>↑</button>
            <button type="button" data-music-move="${escapeHtml(track.id)}" data-direction="1"
              aria-label="Move ${escapeHtml(track.title)} down" title="Move down"${last ? ' disabled' : ''}>↓</button>
          </div>
          <div class="music-track-actions">
            <button type="button" class="music-track-preview" data-music-preview="${escapeHtml(track.id)}"
              aria-label="Preview ${escapeHtml(track.title)}" title="Preview without changing your playlist">Preview</button>
            ${track.local ? `<button type="button" class="music-track-remove" data-music-remove="${escapeHtml(track.id)}"
              aria-label="Remove ${escapeHtml(track.title)} from this device" title="Remove this local file">✕</button>` : ''}
          </div>
        </li>`;
    })
    .join('');
}

export function musicPanelMarkup(
  preferences: MusicPlaylistPreferences,
  state: MatchMusicSnapshot,
): string {
  const current = state.trackId ? musicTrack(state.trackId) : undefined;
  const enabledCount = preferences.enabled.length;
  // Local files join the same list, so the counter follows the rows on screen
  // rather than the authored catalogue.
  const trackTotal = preferences.order.filter((id) => musicTrack(id)).length;
  const canPlay = enabledCount > 0 || !!state.trackId;
  const repeatOptions = MUSIC_REPEAT_MODES.map(
    (mode) =>
      `<option value="${mode}"${preferences.repeat === mode ? ' selected' : ''}>${MUSIC_REPEAT_LABELS[mode]}</option>`,
  ).join('');
  return `
    <div class="music-panel" data-music-panel>
      <section class="music-now${state.preview ? ' is-preview' : ''}" aria-label="Currently playing">
        <div class="music-now-head">
          <span class="music-now-kicker">Battle soundtrack</span>
          <span class="music-now-status" data-music-status>${nowStatus(state)}</span>
        </div>
        <div class="music-now-title" data-music-now-title aria-live="polite">${escapeHtml(
          current?.title ?? 'No track playing',
        )}</div>
        <div class="music-now-sub" data-music-now-sub>${escapeHtml(
          current?.subtitle ?? 'Start a battle or preview a track to hear the playlist.',
        )}</div>
        <div class="music-transport" role="group" aria-label="Playback controls">
          <button type="button" data-music-transport="previous" aria-label="Previous track"
            title="Previous track"${canPlay ? '' : ' disabled'}>◀◀</button>
          <button type="button" data-music-transport="toggle" aria-label="${
            state.playing ? 'Pause' : 'Play'
          } battle soundtrack" title="${state.playing ? 'Pause' : 'Play'}"${canPlay ? '' : ' disabled'}>${
            state.playing ? '❚❚' : '▶'
          }</button>
          <button type="button" data-music-transport="next" aria-label="Next track"
            title="Next track"${canPlay ? '' : ' disabled'}>▶▶</button>
        </div>
      </section>

      <div class="music-list-head">
        <span>Playlist</span>
        <span data-music-summary>${enabledCount} of ${trackTotal} enabled</span>
      </div>
      <ul class="music-list" data-music-list role="list">
        ${trackRows(preferences, state)}
      </ul>

      <section class="music-local" aria-label="Local tracks">
        <label class="music-add-file" title="Choose audio files stored on this device">
          <input type="file" accept="audio/*,.mp3,.ogg,.oga,.opus,.wav,.m4a,.aac,.flac,.webm"
            multiple data-music-add aria-label="Add local audio files to the battle playlist">
          <span>Add local tracks</span>
        </label>
        <small>Your own files stay on this device and join the battle playlist.</small>
      </section>

      <section class="music-options" aria-label="Playback options">
        <div class="music-option">
          <span class="music-option-label">Order</span>
          <div class="music-mode" role="group" aria-label="Playback order">
            <button type="button" data-music-mode="sequential"
              aria-pressed="${preferences.shuffle ? 'false' : 'true'}">Sequential</button>
            <button type="button" data-music-mode="shuffle"
              aria-pressed="${preferences.shuffle ? 'true' : 'false'}">Shuffle</button>
          </div>
        </div>
        <label class="music-option music-repeat">
          <span class="music-option-label">Repeat</span>
          <select data-music-repeat aria-label="Repeat mode">${repeatOptions}</select>
        </label>
        <button type="button" class="music-defaults" data-music-defaults
          title="Restore the authored playlist and order">Restore defaults</button>
      </section>
      <p class="music-note" data-music-note>${
        enabledCount === 0
          ? 'All tracks are excluded. The battle soundtrack is silent until one is enabled.'
          : 'Preview hearings do not change your playlist. Changes are saved on this device.'
      }</p>
    </div>`;
}

/**
 * Update an already-rendered panel without replacing its DOM nodes. Reordering
 * is done by moving the existing rows so keyboard focus stays on the control
 * the player just used.
 */
export function syncMusicPanel(
  root: HTMLElement,
  preferences: MusicPlaylistPreferences,
  state: MatchMusicSnapshot,
): void {
  const list = root.querySelector<HTMLElement>('[data-music-list]');
  const rows = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-music-track]').forEach((row) => {
    const id = row.dataset.musicTrack;
    if (id) rows.set(id, row);
  });
  if (list) {
    for (const id of preferences.order) {
      const row = rows.get(id);
      if (row) list.appendChild(row);
    }
  }

  const enabled = new Set(preferences.enabled);
  for (const [id, row] of rows) {
    const track = musicTrack(id);
    if (!track) continue;
    const isEnabled = enabled.has(id);
    const isCurrent = state.trackId === id;
    row.classList.toggle('is-off', !isEnabled);
    row.classList.toggle('is-current', isCurrent);
    row.setAttribute('aria-current', isCurrent ? 'true' : 'false');

    const toggle = row.querySelector<HTMLButtonElement>('[data-music-toggle]');
    if (toggle) {
      toggle.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
      toggle.setAttribute(
        'aria-label',
        `${isEnabled ? 'Remove' : 'Add'} ${track.title} ${isEnabled ? 'from' : 'to'} the battle playlist`,
      );
      toggle.title = isEnabled ? 'Exclude from playlist' : 'Include in playlist';
    }
    const label = row.querySelector<HTMLElement>('[data-music-state]');
    if (label) label.textContent = stateLabel(isEnabled, isCurrent, state);
    const preview = row.querySelector<HTMLButtonElement>('[data-music-preview]');
    if (preview) preview.textContent = isCurrent && state.playing ? 'Playing' : 'Preview';
  }

  const current = state.trackId ? musicTrack(state.trackId) : undefined;
  const now = root.querySelector<HTMLElement>('.music-now');
  now?.classList.toggle('is-preview', state.preview);
  const title = root.querySelector<HTMLElement>('[data-music-now-title]');
  if (title) title.textContent = current?.title ?? 'No track playing';
  const subtitle = root.querySelector<HTMLElement>('[data-music-now-sub]');
  if (subtitle) {
    subtitle.textContent =
      current?.subtitle ?? 'Start a battle or preview a track to hear the playlist.';
  }
  const status = root.querySelector<HTMLElement>('[data-music-status]');
  if (status) status.textContent = nowStatus(state);

  const canPlay = preferences.enabled.length > 0 || !!state.trackId;
  root.querySelectorAll<HTMLButtonElement>('[data-music-transport]').forEach((button) => {
    const action = button.dataset.musicTransport;
    if (action === 'toggle') {
      const label = state.playing ? 'Pause' : 'Play';
      button.textContent = state.playing ? '❚❚' : '▶';
      button.setAttribute('aria-label', `${label} battle soundtrack`);
      button.title = label;
    }
    button.disabled = action === 'toggle' ? !canPlay : preferences.enabled.length === 0;
  });

  const summary = root.querySelector<HTMLElement>('[data-music-summary]');
  if (summary) {
    const total = preferences.order.filter((id) => musicTrack(id)).length;
    summary.textContent = `${preferences.enabled.length} of ${total} enabled`;
  }
  const note = root.querySelector<HTMLElement>('[data-music-note]');
  if (note) {
    note.textContent =
      preferences.enabled.length === 0
        ? 'All tracks are excluded. The battle soundtrack is silent until one is enabled.'
        : 'Preview hearings do not change your playlist. Changes are saved on this device.';
  }
  root.querySelectorAll<HTMLButtonElement>('[data-music-mode]').forEach((button) => {
    const shuffled = button.dataset.musicMode === 'shuffle';
    button.setAttribute('aria-pressed', shuffled === preferences.shuffle ? 'true' : 'false');
  });
  const repeat = root.querySelector<HTMLSelectElement>('[data-music-repeat]');
  if (repeat) repeat.value = preferences.repeat;
}
