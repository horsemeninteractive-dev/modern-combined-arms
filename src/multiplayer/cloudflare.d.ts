/**
 * Minimal Cloudflare Workers/Durable Object declarations used by the Phase 2A
 * server modules. The browser application never imports these modules.
 */

declare class WebSocketPair {
  readonly 0: WebSocket;
  readonly 1: WebSocket;
}

interface WebSocket {
  accept(): void;
}

interface ResponseInit {
  webSocket?: WebSocket;
}

interface DurableObjectId {
  readonly name?: string;
  toString(): string;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  /** Immediately reset this object; storage and alarms are preserved. */
  abort(reason?: string): void;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
