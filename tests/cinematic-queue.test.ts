import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MissionCinematicContext, MissionCinematicDoc } from '../src/mission';
import {
  CinematicChainQueue,
  type QueuedCinematic,
  type CinematicQueueHost,
} from '../src/ui/cinematicQueue';

function doc(id: string, kind: MissionCinematicContext = 'opening'): MissionCinematicDoc {
  return {
    id,
    kind,
    skippable: true,
    steps: [{ kind: 'line', speaker: 'Command', text: id, durationSeconds: 1 }],
    dialogue: [],
  };
}

function item(id: string, kind: MissionCinematicContext = 'opening'): QueuedCinematic {
  return { doc: doc(id, kind), context: kind, eyebrow: 'EYEBROW', title: 'TITLE' };
}

/**
 * A single-frame host, mirroring the app's contract: `finish()` runs the
 * playing scene's hand-off and then drains the queue, exactly as
 * `endCinematic` does.
 */
class FrameHost implements CinematicQueueHost {
  queue!: CinematicChainQueue;
  current: QueuedCinematic | null = null;
  readonly started: string[] = [];
  /** Contexts the player has switched off since the scene was queued. */
  readonly off = new Set<MissionCinematicContext>();
  /** Refuse every start, modelling a scene that lost the frame. */
  blocked = false;

  playingId(): string | null {
    return this.current?.doc.id ?? null;
  }

  enabled(context: MissionCinematicContext): boolean {
    return !this.off.has(context);
  }

  play(next: QueuedCinematic): boolean {
    if (this.current || this.blocked) return false;
    this.current = next;
    this.started.push(next.doc.id);
    return true;
  }

  /** End the scene on screen: its own hand-off, then the next chain. */
  finish(): void {
    const playing = this.current;
    this.current = null;
    playing?.after?.();
    this.queue.drain();
  }
}

function harness(): { host: FrameHost; queue: CinematicChainQueue } {
  const host = new FrameHost();
  host.queue = new CinematicChainQueue(host);
  return { host, queue: host.queue };
}

describe('cinematic chain queue', () => {
  it('keeps a chain hand-off when a second chain is queued during the first', () => {
    const { host, queue } = harness();
    const ran: string[] = [];
    // A launch: opening then briefing, deploying only once both are done.
    expect(
      queue.chain([item('launch-opening'), item('launch-briefing')], () => ran.push('deploy')),
    ).toBe(true);
    expect(host.started).toEqual(['launch-opening']);
    expect(queue.pendingCount).toBe(1);

    // Before the launch finishes, a deck replay queues a second chain with its
    // own follow-up. The old shared slot let this replace the deployment.
    expect(
      queue.chain([item('deck-intro', 'campaignIntro')], () => ran.push('deck')),
    ).toBe(true);
    expect(host.started).toEqual(['launch-opening']);

    host.finish();
    // The briefing starts; the deployment still waits for the chain to end.
    expect(host.started).toEqual(['launch-opening', 'launch-briefing']);
    expect(ran).toEqual([]);

    host.finish();
    expect(ran).toEqual(['deploy']);
    expect(host.started).toEqual(['launch-opening', 'launch-briefing', 'deck-intro']);

    host.finish();
    // Each chain's follow-up ran once, in chain order, and neither was lost.
    expect(ran).toEqual(['deploy', 'deck']);
    expect(queue.pendingCount).toBe(0);
  });

  it('runs every piled-up chain hand-off exactly once, in queue order', () => {
    const { host, queue } = harness();
    const ran: string[] = [];
    queue.chain([item('a1')], () => ran.push('A'));
    queue.chain([item('b1'), item('b2')], () => ran.push('B'));
    queue.chain([item('c1')], () => ran.push('C'));
    expect(host.started).toEqual(['a1']);
    while (host.current) host.finish();
    expect(ran).toEqual(['A', 'B', 'C']);
    expect(host.started).toEqual(['a1', 'b1', 'b2', 'c1']);
  });

  it('runs a chain hand-off even when that chain can no longer start', () => {
    const { host, queue } = harness();
    const ran: string[] = [];
    queue.chain([item('live')], () => ran.push('live'));
    queue.chain([item('stale')], () => ran.push('stale'));
    host.blocked = true;
    host.finish();
    // The live chain hands off first, then the stale scene never takes the
    // frame, but its chain still hands off before anything else is considered.
    expect(host.started).toEqual(['live']);
    expect(ran).toEqual(['live', 'stale']);
    expect(queue.pendingCount).toBe(0);
  });

  it('runs the hand-off immediately when nothing in a chain may play', () => {
    const { host, queue } = harness();
    const ran: string[] = [];
    host.off.add('opening');
    host.off.add('briefing');
    expect(
      queue.chain([item('opening-short'), item('briefing', 'briefing')], () => ran.push('done')),
    ).toBe(false);
    expect(ran).toEqual(['done']);
    expect(host.started).toEqual([]);
    expect(queue.pendingCount).toBe(0);
  });

  it('force plays a chain even when its group is switched off', () => {
    const { host, queue } = harness();
    host.off.add('campaignIntro');
    expect(queue.chain([item('intro', 'campaignIntro')], null, false)).toBe(false);
    expect(queue.chain([item('intro', 'campaignIntro')], null, true)).toBe(true);
    expect(host.started).toEqual(['intro']);
    expect(host.current?.force).toBe(true);
  });

  it('never replaces an authored per-scene hand-off with the chain hand-off', () => {
    const { host, queue } = harness();
    const ran: string[] = [];
    queue.chain(
      [
        item('first'),
        { ...item('last'), after: () => ran.push('scene') },
      ],
      () => ran.push('chain'),
    );
    host.finish();
    host.finish();
    expect(ran).toEqual(['scene']);
  });

  it('refuses a duplicate of the scene on screen or one already waiting', () => {
    const { host, queue } = harness();
    queue.chain([item('playing')]);
    queue.chain([item('waiting')]);
    expect(queue.push(item('playing'))).toBe(false);
    expect(queue.push(item('waiting'))).toBe(false);
    expect(queue.push(item('fresh'))).toBe(true);
    expect(queue.pendingCount).toBe(2);
    expect(host.started).toEqual(['playing']);
  });

  it('drops pending scenes and their hand-offs on clear', () => {
    const { host, queue } = harness();
    const ran: string[] = [];
    queue.chain([item('playing')]);
    queue.chain([item('stale-1'), item('stale-2')], () => ran.push('stale'));
    queue.clear();
    expect(queue.pendingCount).toBe(0);
    host.finish();
    // The cleared chain never hands off, and nothing behind it starts.
    expect(ran).toEqual([]);
    expect(host.started).toEqual(['playing']);
  });
});

/**
 * The unit above cannot see the app adapter. These pin the two places where a
 * reordering would silently undo the per-chain hand-off: the teardown that runs
 * `after` against the queue drain, and the wiring that puts a queued scene's
 * `after` into the player in the first place.
 */
describe('app adapter for the chain queue', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

  it('runs the finished scene hand-off before it drains the queue', () => {
    const start = app.indexOf('  private endCinematic(): void {');
    const end = app.indexOf('  /**', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = app.slice(start, end);
    const followUp = body.indexOf('after?.()');
    const drain = body.indexOf('this.advanceCinematicQueue()');
    // The hand-off may start the battle that clears the queue, so it has to run
    // while this chain still owns the frame and before the next chain begins.
    expect(followUp).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(followUp);
    expect(body.split('this.advanceCinematicQueue()')).toHaveLength(2);
    // The follow-up is claimed before it runs: a scene it starts cannot see the
    // slot and re-run it, and only the last scene of a chain carries one.
    expect(body.indexOf('const after = this.cinematicAfter;')).toBeGreaterThan(-1);
    expect(body.indexOf('this.cinematicAfter = null;')).toBeGreaterThan(-1);
    expect(body.indexOf('this.cinematicAfter = null;')).toBeLessThan(followUp);
    // The frame is free before the hand-off: a follow-up that plays the next
    // scene must not be refused because this one still looks on screen.
    expect(body.indexOf('this.cinematic = null;')).toBeGreaterThan(-1);
    expect(body.indexOf('this.cinematic = null;')).toBeLessThan(followUp);
  });

  it('passes a queued scene hand-off through to the player', () => {
    const wired = app.slice(
      app.indexOf('private readonly cinematicChains = new CinematicChainQueue({'),
    );
    const block = wired.slice(0, wired.indexOf('});') + 3);
    // The host reads the real frame, honours the player's switches and hands the
    // scene's own follow-up to `playCinematic`; dropping it here would leave the
    // queue correct and the deployment behind it still stranded.
    expect(block).toContain('playingId: () => this.cinematic?.doc.id ?? null');
    expect(block).toContain('enabled: (context) => this.cinematicsEnabled(context)');
    expect(block).toContain('item.after ?? null');
    // And the two delegating methods stay delegations rather than re-growing a
    // rival copy of the scheduling rules next to the tested unit.
    expect(app).toContain('return this.cinematicChains.chain(items, onDone, force);');
    const advance = app.slice(app.indexOf('  private advanceCinematicQueue(): void {'));
    expect(advance.slice(0, 160)).toContain('this.cinematicChains.drain();');
  });
});
