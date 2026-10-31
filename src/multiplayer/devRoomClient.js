// Development-only transport probe for the isolated Phase 2A staging Worker.
// This is intentionally not a game UI. It exercises seat assignment, the v2
// WebSocket protocol (sync + delta), the shared reconstruction reducer, neutral
// results, keepalive and resynchronisation.

import { SnapshotAssembler } from './assembler.js';

const $ = (id) => document.getElementById(id);
const roomInput = $('room');
const adminInput = $('admin');
const durationInput = $('duration');
const response = $('response');
const sockets = [null, null];
const assemblers = [null, null];
const lastResyncAt = [0, 0];
let room = null;
const PROTOCOL = 2;

function logSeat(seat, text) {
  const el = $('s' + seat + '-log');
  el.textContent = (el.textContent ? el.textContent + '\n' : '') + text;
  el.scrollTop = el.scrollHeight;
}

function setSeatState(seat, text, ok) {
  const el = $('s' + seat + '-state');
  el.textContent = text;
  el.className = ok ? 'ok' : 'bad';
}

function setRoom(handle) {
  room = handle;
  for (const seat of [0, 1]) {
    $('s' + seat + '-connect').disabled = !handle;
    if (!sockets[seat]) setSeatState(seat, 'disconnected', false);
  }
  $('status').disabled = !handle;
  $('shutdown').disabled = !handle;
}

function show(value) {
  response.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function api(path, init) {
  const headers = new Headers(init?.headers || {});
  if (adminInput.value) headers.set('Authorization', 'Bearer ' + adminInput.value);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({ ok: false, code: 'bad-json' }));
  return { status: res.status, data };
}

function describeState(snap) {
  if (!snap) return 'no reconstructed state';
  const own = snap.entities.filter((e) => e.team === snap.team).length;
  const visible = snap.entities.length - own;
  const ownUnits = snap.entities.filter((e) => e.team === snap.team && e.kind === 'unit');
  const selected = ownUnits.slice(0, 8).map((e) => `${e.defId}@${Math.round(e.x)},${Math.round(e.z)}`);
  const player = snap.players.find((p) => p.team === snap.team);
  return [
    `tick ${snap.tick} phase ${snap.result?.phase ?? '?'} team ${snap.team}`,
    `own ${own} visible-enemy ${visible} materials ${Math.round(player?.mats ?? 0)}/${Math.round(player?.req ?? 0)}`,
    selected.length ? `units ${selected.join(' ')}` : 'units none',
    `events ${snap.events.length} projectiles ${snap.projectiles.length}`,
  ].join('\n');
}

function requestResync(seat, reason) {
  const socket = sockets[seat];
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (now - lastResyncAt[seat] < 5000) {
    logSeat(seat, 'resync suppressed (rate limit) after ' + reason);
    return;
  }
  lastResyncAt[seat] = now;
  logSeat(seat, 'requesting full sync: ' + reason);
  socket.send(JSON.stringify({ type: 'resync', v: PROTOCOL }));
}

function connectSeat(seat) {
  if (!room || sockets[seat]) return;
  const token = room.seats.find((s) => s.seatId === seat)?.token;
  if (!token) {
    logSeat(seat, 'No seat token in the room response.');
    return;
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}/api/multiplayer/rooms/${encodeURIComponent(room.roomId)}/ws?seat=${seat}`;
  setSeatState(seat, 'connecting', false);
  const socket = new WebSocket(url, ['mca.v2', 'mca.token.' + token]);
  sockets[seat] = socket;
  assemblers[seat] = new SnapshotAssembler({ roomId: room.roomId, team: seat });

  // Application keepalive: works with no controllable units and no commands.
  // It is not a gameplay message and never reaches the command gate. If the
  // server stops acknowledging (~2.25 intervals) the socket is treated as dead
  // and closed, so a half-open connection cannot look healthy in the UI.
  let keepalive = null;
  let lastAckAt = 0;
  socket.addEventListener('open', () => {
    setSeatState(seat, 'connected', true);
    logSeat(seat, 'open');
    lastAckAt = Date.now();
    keepalive = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastAckAt > 45_000) {
        logSeat(seat, 'no keepalive ack for 45s; closing the socket');
        clearInterval(keepalive);
        keepalive = null;
        socket.close(4001, 'keepalive-timeout');
        return;
      }
      socket.send(JSON.stringify({ type: 'keepalive', v: PROTOCOL }));
    }, 20_000);
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      logSeat(seat, 'unparseable message');
      return;
    }
    if (message.type === 'sync' || message.type === 'delta') {
      const assembler = assemblers[seat];
      const applied = assembler.apply(message);
      if (!applied.ok) {
        logSeat(seat, `rejected ${message.type}: ${applied.reason} (${applied.detail})`);
        requestResync(seat, applied.reason);
        return;
      }
      const suffix = applied.empty ? ' (no changes)' : '';
      logSeat(
        seat,
        `${applied.kind} seq ${applied.seq} epoch ${assembler.epoch} tick ${applied.tick}${suffix}\n` +
          describeState(assembler.state()),
      );
    } else if (message.type === 'keepaliveAck') {
      lastAckAt = Date.now();
      logSeat(seat, 'keepalive ack');
    } else if (message.type === 'result') {
      logSeat(seat, 'RESULT ' + JSON.stringify(message.result));
    } else if (message.type === 'error') {
      logSeat(seat, 'ERROR ' + message.code + ': ' + message.message);
    } else if (message.type === 'hello') {
      logSeat(
        seat,
        `seat ${message.seat} player ${message.playerId} team ${message.team} keepalive ${message.keepaliveMs}ms`,
      );
    } else if (message.type === 'roomClosed') {
      logSeat(seat, 'CLOSED ' + message.reason);
    } else {
      logSeat(seat, JSON.stringify(message));
    }
  });
  socket.addEventListener('close', (event) => {
    if (keepalive) clearInterval(keepalive);
    keepalive = null;
    sockets[seat] = null;
    assemblers[seat] = null;
    setSeatState(seat, 'closed ' + event.code, false);
    logSeat(seat, 'close ' + event.code + ' ' + event.reason);
  });
  socket.addEventListener('error', () => {
    setSeatState(seat, 'socket error', false);
  });
}

$('create').addEventListener('click', async () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return show('Enter a room id.');
  const seconds = Number(durationInput.value);
  const { status, data } = await api('/api/multiplayer/rooms/' + encodeURIComponent(roomId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, mode: '1v1', matchDurationMs: seconds * 1000 }),
  });
  show({ status, data });
  if (data.ok) setRoom(data);
});

$('status').addEventListener('click', async () => {
  if (!room) return;
  const { status, data } = await api(
    '/api/multiplayer/rooms/' + encodeURIComponent(room.roomId) + '/status',
  );
  show({ status, data });
});

$('shutdown').addEventListener('click', async () => {
  if (!room) return;
  const { status, data } = await api(
    '/api/multiplayer/rooms/' + encodeURIComponent(room.roomId) + '/shutdown',
    { method: 'POST' },
  );
  show({ status, data });
});

for (const seat of [0, 1]) {
  $('s' + seat + '-connect').addEventListener('click', () => connectSeat(seat));
}
