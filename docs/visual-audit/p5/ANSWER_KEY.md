# Phase 5 review pack — coordinator answer key

**Do not show this file to reviewers.** The pack page (`review-pack.html`) contains no role labels,
no correct-answer data and no feedback.

## Hidden mapping

| Sample id | Unit |
| --- | --- |
| `a` | ATGM gunner (`atgm`) |
| `b` | Main battle tank (`tank`) |
| `c` | Rifleman (`rifle`) |

The same id mapping is used in every stage: `primary-*`, `close-*`, `orientation-*`, `ui-*`.

## Randomised order sets

| Set | Order shown |
| --- | --- |
| 1 | a, b, c |
| 2 | a, c, b |
| 3 | b, a, c |
| 4 | b, c, a |
| 5 | c, a, b |
| 6 | c, b, a |

Assign one set per reviewer, all six different. Each reviewer therefore sees one first view of each
unit at battle zoom, in a different order. The pack repeats that order in the secondary stages.

## Pre-registered primary denominator

- **Population:** six independent reviewers, one primary response per unit type.
- **Primary observations:** 3 unit types × 6 reviewers = **18**.
- **Pass rule from the visual audit:** at least 90 % correct.
- Because 16/18 = 88.9 % and 17/18 = 94.4 %, the smallest passing count is **17 of 18**.
- A reviewer who has already seen a unit in the primary stage cannot contribute another independent
  observation of that unit. Do not count repeated stages as extra participants.
- If fewer than six reviewers are available, or any primary response is missing, the result is
  **inconclusive**, not a pass or fail.

## Scoring

Score only the first exposure in Stage A for the primary criterion. Use the `stage: "primary"`
records in each downloaded JSON file.

- Per unit: correct / 6.
- Overall: total correct / 18; report raw counts and percentage.
- **Close stage (B):** 18 observations, report separately. It is not the battle-zoom criterion.
- **Orientation (C) and overlay (D):** repeated samples. Report raw counts as diagnostics only; do
  not treat them as independent evidence.
- **Orientation error:** record whether the failure was the weapon/turret orientation or the role
  silhouette.
- **Overlay error:** record whether the ring/bar/team cue helped or obscured the silhouette.
- **Confidence:** report the distribution but do not discard low-confidence correct answers or
  high-confidence errors.

## Failure handling

If the primary criterion fails, do not convert the rest of the roster. Identify the specific
unit(s) and orientation(s) that were misread, then propose the smallest model-specific correction.
If the primary criterion passes, the next representative model or visual-slice gap may be chosen
from the audit evidence; roster-wide conversion still needs its own scope.

## Known limitations to record

- The review pack is static. Six independent humans must actually be recruited; the developer's
  own reading of the images is not a substitute.
- A silhouette-only, neutral-material set was not produced. Producing one would require a
  renderer material override or destructive image processing, which this validation phase does not
  authorise. Stage A uses the real terrain and materials at 1:1 pixels.
- The capture environment is desktop Chromium/ANGLE at a 1920×1080 window with a 0.9 browser scale
  (1919×1079 device buffer). Mobile and other GPUs are untested.
