// Minimal RFC 6455 client used by the Phase 2A deployed smoke test.
//
// Node's built-in WebSocket sends the handshake but does not expose the HTTP
// status when a Cloudflare 101 is rejected, which makes transport diagnosis
// impossible. This client exists only for that diagnostic surface; production
// clients use the browser WebSocket API.

import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

function maskedFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(Math.floor(data.length / 2 ** 32), 2);
    header.writeUInt32BE(data.length >>> 0, 6);
  }
  const mask = randomBytes(4);
  const body = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) body[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, body]);
}

export class RawSocket {
  constructor(socket, head) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.open = true;
    this.closeCode = null;
    this.closeReason = '';
    this.messages = [];
    this.messageHandlers = new Set();
    this.closeHandlers = new Set();
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
    if (head && head.length) this.receive(head);
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  send(text) {
    if (!this.open) return;
    this.socket.write(maskedFrame(0x1, text));
  }

  // Transport-level keepalive only. It does not touch the mca.v1 protocol; it
  // exists so a client with nothing to command does not leave a one-way idle
  // TCP flow that NAT or the edge can reclaim mid-match.
  ping() {
    if (!this.open) return;
    try {
      this.socket.write(maskedFrame(0x9, Buffer.alloc(0)));
    } catch {
      /* the socket is already gone */
    }
  }

  close() {
    if (!this.open) return;
    try {
      this.socket.write(maskedFrame(0x8, Buffer.from([0x03, 0xe8])));
    } catch {
      /* already gone */
    }
    this.socket.end();
    this.closed();
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        length = high * 2 ** 32 + low;
        offset = 10;
      }
      const masked = (b1 & 0x80) !== 0;
      let mask = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (masked) {
        const copy = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) copy[i] = payload[i] ^ mask[i % 4];
        payload = copy;
      }
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        this.messages.push(text);
        if (this.messages.length > 200) this.messages.shift();
        for (const handler of [...this.messageHandlers]) handler(text);
      } else if (opcode === 0x8) {
        if (payload.length >= 2) this.closeCode = payload.readUInt16BE(0);
        if (payload.length > 2) this.closeReason = payload.subarray(2).toString('utf8').slice(0, 120);
        this.closed();
        try {
          this.socket.end();
        } catch {
          /* already gone */
        }
        return;
      } else if (opcode === 0x9) {
        this.socket.write(maskedFrame(0xa, payload));
      }
    }
  }

  closed() {
    if (!this.open) return;
    this.open = false;
    for (const handler of [...this.closeHandlers]) handler();
  }
}

export function rawHandshake(base, roomId, seat, token, origin) {
  const url = new URL(base);
  const transport = url.protocol === 'https:' ? https : http;
  const headers = {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
    'Sec-WebSocket-Protocol': 'mca.v2, mca.token.' + token,
  };
  if (origin) headers.Origin = origin;
  return new Promise((resolve) => {
    const request = transport.request(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `/api/multiplayer/rooms/${encodeURIComponent(roomId)}/ws?seat=${seat}`,
        method: 'GET',
        headers,
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0, socket: null, body: '' });
      },
    );
    request.on('upgrade', (response, socket, head) => {
      if (response.statusCode !== 101) {
        socket.destroy();
        resolve({ status: response.statusCode ?? 0, socket: null, body: '' });
        return;
      }
      resolve({ status: 101, socket: new RawSocket(socket, head), body: '' });
    });
    request.on('error', () => resolve({ status: 0, socket: null, body: '' }));
    request.end();
  });
}

export function waitRawMessage(socket, predicate, timeoutMs = 5000) {
  for (const text of socket.messages) {
    try {
      const message = JSON.parse(text);
      if (predicate(message)) return Promise.resolve(message);
    } catch {
      /* ignore non-JSON */
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('raw websocket message timeout'));
    }, timeoutMs);
    const offMessage = socket.onMessage((text) => {
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    });
    const offClose = socket.onClose(() => {
      cleanup();
      reject(new Error('raw websocket closed'));
    });
    function cleanup() {
      clearTimeout(timer);
      offMessage();
      offClose();
    }
  });
}
