import { describe, expect, it } from 'vitest';
import { identityBannerMarkup } from '../src/ui/careerView';

describe('Phase 4B identity presentation', () => {
  it('resolves equipped catalogue ids to their render classes', () => {
    const html = identityBannerMarkup(
      { callsign: 'Sable', avatar: 'eagle' },
      'Corporal',
      'NCO',
      1_250,
      { frame: 'frame-brass', background: 'bg-deep' },
    );
    expect(html).toContain('identity-frame-brass');
    expect(html).toContain('identity-bg-deep');
    // The catalogue id is not a CSS class of its own.
    expect(html).not.toContain('identity-frame-frame-brass');
    expect(html).not.toContain('identity-bg-bg-deep');
    expect(html).toContain('Sable');
  });

  it('uses safe defaults for missing and invalid cosmetics', () => {
    const html = identityBannerMarkup(
      { callsign: 'Sable', avatar: 'eagle' },
      'Corporal',
      'NCO',
      0,
      { frame: 'frame-not-real', background: 'bg-not-real' },
    );
    expect(html).toContain('Sable');
    expect(html).not.toContain('frame-not-real');
    expect(html).not.toContain('bg-not-real');
    expect(html).toContain('identity-banner');
  });
});
