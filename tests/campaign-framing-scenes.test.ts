import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMPAIGNS } from '../src/data/campaign';
import { validateCampaignDefinition } from '../src/campaign';
import { cinematicStepSeconds } from '../src/ui/cinematics';
import { MUSIC_TRACKS_BY_ID } from '../src/ui/musicCatalogue';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

describe('shipped campaign framing scenes', () => {
  it('authored an introduction, an intermission and a finale for both campaigns', () => {
    for (const def of CAMPAIGNS) {
      const scenes = def.cinematics ?? [];
      const kinds = scenes.map((doc) => doc.kind);
      expect(kinds, `${def.id} framing scenes`).toContain('campaignIntro');
      expect(kinds).toContain('intermission');
      expect(kinds).toContain('campaignFinale');
      // One scene per act: three acts, three scenes, each in its own context.
      expect(scenes).toHaveLength(3);
      expect(new Set(kinds).size).toBe(scenes.length);
      expect(new Set(scenes.map((doc) => doc.id)).size).toBe(scenes.length);
    }
  });

  it('keeps every shipped campaign clean under campaign validation', () => {
    for (const def of CAMPAIGNS) {
      const errors = validateCampaignDefinition(def).filter(
        (issue) => issue.severity === 'error',
      );
      expect(errors, `${def.id} campaign errors`).toEqual([]);
    }
  });

  it('keeps every framing scene skippable, scored and short', () => {
    for (const def of CAMPAIGNS) {
      for (const doc of def.cinematics ?? []) {
        expect(doc.skippable, `${def.id}/${doc.id} must be skippable`).toBe(true);
        expect(doc.transition?.in?.kind).toBe('fade');
        expect(doc.transition?.out?.kind).toBe('fade');
        expect(doc.steps.some((step) => step.kind === 'card')).toBe(true);
        expect(doc.steps.filter((step) => step.kind === 'line').length).toBeGreaterThan(0);
        const music = doc.steps.filter(
          (step): step is Extract<(typeof doc.steps)[number], { kind: 'music' }> =>
            step.kind === 'music',
        );
        expect(music.length).toBeGreaterThan(0);
        for (const beat of music) expect(MUSIC_TRACKS_BY_ID.has(beat.track)).toBe(true);
        const seconds = doc.steps.reduce((total, step) => total + cinematicStepSeconds(step), 0);
        expect(seconds, `${def.id}/${doc.id} length`).toBeLessThanOrEqual(40);
      }
    }
  });

  it('frames command posts every operation authors, so a scene plays on all twelve theatres', () => {
    for (const def of CAMPAIGNS) {
      for (const mission of def.missions) {
        const keys = new Set(mission.mission.entities.map((entity) => entity.key));
        for (const doc of def.cinematics ?? []) {
          for (const step of doc.steps) {
            if (step.kind !== 'camera' || step.target.kind !== 'entity') continue;
            expect(
              keys.has(step.target.entity),
              `${def.id}/${doc.id} frames "${step.target.entity}", missing on ${mission.id}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('keeps the intermission reusable after any accepted operation', () => {
    for (const def of CAMPAIGNS) {
      const intermission = (def.cinematics ?? []).find((doc) => doc.kind === 'intermission')!;
      const spoken = intermission.steps
        .filter(
          (step): step is Extract<(typeof intermission.steps)[number], { kind: 'line' }> =>
            step.kind === 'line',
        )
        .map((step) => step.text)
        .join(' ')
        .toLowerCase();
      for (const mission of def.missions) {
        expect(spoken, `${def.id} intermission names ${mission.name}`).not.toContain(
          mission.name.toLowerCase(),
        );
      }
    }
  });
});

describe('campaign deck scene replay', () => {
  it('mounts the replay control on the campaign deck', () => {
    expect(html).toContain('id="btn-campaign-replay"');
    expect(app).toContain("on('btn-campaign-replay', () => this.replayCampaignFramingScenes());");
  });

  it('replays the authored framing scenes without touching campaign state', () => {
    const start = app.indexOf('  private playCampaignFramingScenes(');
    const end = app.indexOf('  private captureCampaignResult(', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = app.slice(start, end);
    // The deck action is presentation only: it must not launch, accept, retry or
    // write a run, and it must not suppress the launch introduction either.
    expect(body).not.toContain('launchCampaignMission');
    expect(body).not.toContain('setCampaignState');
    expect(body).not.toContain('acceptCampaignResult');
    expect(body).not.toContain('retryCampaignMission');
    expect(body).not.toContain('campaignIntroShown');
    expect(body).toContain('playCinematicChain');
  });
});
