# Cross-browser determinism spike

**Date:** 14 November 2026  
**Build:** 0.8.2 BETA  
**Result:** **PASS for this scenario** — all 72 sampled state hashes matched across
Chromium, Firefox and WebKit.

## Method

The probe is isolated from the game shell in `tools/determinism/`. It uses
`createIslandAssault()` (scenario seed `773311`) and runs both sides through the
real `AIController` with AI seed `0x5eed1234` on the Veteran setting. The game's
built-in single-AI hook is disabled, so both controllers run through the public
command API exactly as the matchup harness does.

- Simulated length: **7,200 ticks** (six minutes at 20 Hz).
- State hash: `Game.stateHash()` after every **100 ticks**, giving 72 samples.
- Browser driver: Playwright 1.65.1.
- Engines: Chromium build 1255, Firefox build 1572, WebKit build 2388.
- The harness reports page errors and a final victory/entity count alongside the
  hashes.

## Result

| Engine | Samples | Elapsed | Page errors | Final state |
| --- | ---: | ---: | ---: | --- |
| Chromium 1255 | 72 | 4.7 s | 0 | playing, 29 entities |
| Firefox 1572 | 72 | 5.0 s | 0 | playing, 29 entities |
| WebKit 2388 | 72 | 4.3 s | 0 | playing, 29 entities |

There was no first divergent tick and therefore no divergent subsystem. All
three engines produced byte-identical hashes at every sampled tick, not just at
the final tick. The full hash trace is written to `tmp/determinism-spike.json`
when the probe runs.

## Reproduce

```bash
npm install
npx playwright install chromium firefox webkit
npm run determinism:spike
```

The script starts an isolated Vite server on `127.0.0.1:5174`, loads
`tools/determinism/`, runs each engine headlessly and compares the samples.
`MCA_ENGINES=chromium` limits the run during development; by default it runs all
three.

## Interpretation

This is evidence for the P0-4 decision, not a proof of determinism for every
simulation path. It covers one authored scenario, one seed, one AI difficulty,
no human commands and six simulated minutes. The simulation still calls
`Math.sin/cos/atan2/hypot/pow` at roughly 65 sites, and ECMAScript permits engines
to approximate those functions differently; a different browser version, map or
code path can still diverge.

The result therefore supports proceeding with the lockstep plan, but it does not
remove the need for the deterministic math module and its ban test (roadmap
P2-1). Re-run this probe after that change and add the spike to the nightly
measurement set when the browser install cost is acceptable.
