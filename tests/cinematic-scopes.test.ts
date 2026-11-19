import { describe, expect, it } from 'vitest';
import {
  CINEMATIC_SCOPE_DEFAULT,
  cinematicScopeFor,
  normaliseCinematicScopes,
} from '../src/settings';

describe('cinematic context scopes', () => {
  it('groups every authored context into one switchable scope', () => {
    expect(cinematicScopeFor('campaignIntro')).toBe('campaign');
    expect(cinematicScopeFor('intermission')).toBe('campaign');
    expect(cinematicScopeFor('campaignFinale')).toBe('campaign');
    expect(cinematicScopeFor('briefing')).toBe('briefing');
    for (const kind of ['opening', 'inMission', 'ending', 'debrief']) {
      expect(cinematicScopeFor(kind)).toBe('battle');
    }
  });

  it('keeps every group on when a settings record is missing or malformed', () => {
    expect(normaliseCinematicScopes(undefined)).toEqual(CINEMATIC_SCOPE_DEFAULT);
    expect(normaliseCinematicScopes(null)).toEqual(CINEMATIC_SCOPE_DEFAULT);
    expect(normaliseCinematicScopes('briefing')).toEqual(CINEMATIC_SCOPE_DEFAULT);
    expect(normaliseCinematicScopes({ briefing: false })).toEqual({
      campaign: true,
      briefing: false,
      battle: true,
    });
    expect(normaliseCinematicScopes({ campaign: false, briefing: false, battle: false })).toEqual({
      campaign: false,
      briefing: false,
      battle: false,
    });
    // A hand-edited truthy value is not a deliberate off: only `false` is.
    expect(normaliseCinematicScopes({ battle: 0, campaign: 'no' })).toEqual(CINEMATIC_SCOPE_DEFAULT);
  });
});
