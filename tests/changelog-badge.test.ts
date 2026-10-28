import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import html from '../index.html?raw';
import app from '../src/app.ts?raw';
import {
  CHANGELOG_ACK_KEY,
  buildKey,
  hasUnseenChangelog,
  markAcknowledged,
  readAcknowledged,
  type KeyValueStore,
} from '../src/ui/changelog';
import { currentBuildStamp } from '../src/version';

const running = currentBuildStamp();
// CSS imports resolve to an empty module in the Node suite; read the source.
const style = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function memoryStore(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('changelog badge', () => {
  it('is unseen until the running build has been acknowledged', () => {
    expect(hasUnseenChangelog(running, null)).toBe(true);
    expect(hasUnseenChangelog(running, buildKey(running))).toBe(false);
  });

  it('returns after any part of the build identity changes', () => {
    const acknowledged = buildKey(running);
    expect(hasUnseenChangelog({ ...running, commit: 'deadbee' }, acknowledged)).toBe(true);
    expect(hasUnseenChangelog({ ...running, build: running.build + 1 }, acknowledged)).toBe(true);
    expect(hasUnseenChangelog({ ...running, version: '0.2.0' }, acknowledged)).toBe(true);
    expect(hasUnseenChangelog({ ...running, stage: 'RC' }, acknowledged)).toBe(true);
  });

  it('persists the acknowledgement under one device-local key', () => {
    const store = memoryStore();
    expect(readAcknowledged(store)).toBeNull();

    const key = markAcknowledged(store, running);
    expect(key).toBe(buildKey(running));
    expect(store.data[CHANGELOG_ACK_KEY]).toBe(key);
    expect(readAcknowledged(store)).toBe(key);
    expect(hasUnseenChangelog(running, readAcknowledged(store))).toBe(false);
  });

  it('survives storage that refuses to read or write', () => {
    const hostile: KeyValueStore = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(readAcknowledged(hostile)).toBeNull();
    expect(() => markAcknowledged(hostile, running)).not.toThrow();
    expect(readAcknowledged(null)).toBeNull();
    expect(markAcknowledged(null, running)).toBe(buildKey(running));
  });

  it('creates the badge only when notes are unseen', () => {
    expect(html).toContain('id="btn-changelog"');
    // No first-paint flash for a returning player: the markup starts without it.
    expect(html).not.toContain('menu-footer-badge');
    expect(app).toContain('this.changelogAck = readAcknowledged(this.localStore());');
    expect(app).toContain('this.refreshChangelogBadge();');
    expect(app).toContain('markAcknowledged(this.localStore(), currentBuildStamp())');
    expect(app).toContain("btn.classList.toggle('has-new', unseen)");
    expect(app).toContain('new notes since your last visit');
    expect(style).toContain('.menu-footer-badge');
    expect(style).toContain('.menu-footer-link.has-new');
  });
});
