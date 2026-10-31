const status = document.querySelector('#status');
const log = document.querySelector('#log');
const token = 'phase0-local-token';
const room = 'phase0-probe';
const seat = new URLSearchParams(location.search).get('seat') ?? '0';

function line(text) {
  log.textContent += `${new Date().toISOString()} ${text}\n`;
  log.scrollTop = log.scrollHeight;
}

async function main() {
  const cookieResponse = await fetch('/api/phase0/cookie', { cache: 'no-store' });
  line(`cookie route: ${cookieResponse.status} ${await cookieResponse.text()}`);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/api/phase0/room/${room}/ws?seat=${seat}&token=${encodeURIComponent(token)}`;
  line(`connecting ${url}`);
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    status.textContent = 'connected';
    line('websocket open');
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'hello') {
      status.textContent = `seat ${message.seat} · team ${message.team} · cookie ${message.cookieSeen} · origin ${message.originSeen}`;
      line(`hello ${JSON.stringify(message)}`);
      return;
    }
    if (message.type === 'snapshot') {
      socket.send(JSON.stringify({ type: 'ack', seq: message.tick }));
      if (message.tick % 20 === 0) {
        line(
          `snapshot tick=${message.tick} team=${message.team} entities=${message.entities.length} bytes≈${event.data.length}`,
        );
      }
      return;
    }
    line(`message ${event.data}`);
  });
  socket.addEventListener('close', (event) => {
    status.textContent = `closed ${event.code} ${event.reason}`;
    line(`closed ${event.code} ${event.reason}`);
  });
  socket.addEventListener('error', () => {
    status.textContent = 'websocket error';
    line('websocket error');
  });
}

main().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  line(`failed ${error.stack ?? error.message}`);
});
