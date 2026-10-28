# Phase 5 reviewer pack — administration

This folder contains the controlled review materials for the Phase 4 rifleman, ATGM gunner and
main battle tank. It does **not** contain reviewer results. The six-person panel has not been run in
the development environment, so the audit decision remains **inconclusive** until real independent
responses are collected.

## Contents

| File | Purpose |
| --- | --- |
| `review-pack.html` | Unlabeled test instrument. Open with `?set=1` … `?set=6`. |
| `ANSWER_KEY.md` | Coordinator-only mapping, randomisation, denominator and scoring. Do not show to reviewers. |
| `responses-template.csv` | Optional transcription sheet if responses are not collected as JSON. |
| `primary-{a,b,c}.png` | Stage A: one unit per image, real battle zoom and 1:1 pixels. |
| `close-{a,b,c}.png` | Stage B: closer inspection, scored separately. |
| `orientation-{a,b,c}.png` | Stage C: alternate heading at battle zoom; repeated samples. |
| `ui-{a,b,c}.png` | Stage D: normal selection ring and health bar; repeated samples. |

The mapping is intentionally not exposed by the page or image filenames.

## Fixed rendering conditions

Captured from the shipped renderer through `tools/readability-probe.js`, with the local-only
`tools/readability-capture.cjs` sink receiving the 1:1 crops:

- Kestrel Bay (`island-assault`) clear grass showroom, day, weather clear, fog off, effects off.
- One unit only, owner 0, stationary at world `(74, 58)`; no buildings or other entities in frame.
- Game canvas backing buffer **1919 × 1079 device pixels**; CSS viewport 2133 × 1200; renderer DPR
  0.9. The 640 × 360 / 640 × 480 crops are taken 1:1 from that buffer and are **not enlarged**.
- Camera: orthographic, pitch 30°, zoom **36** (the real `BATTLE_ZOOM`), centred on the unit.
- Stage A/B/C hides the HUD and overlay. Stage D restores only the ordinary selection ring and
  health bar.
- Primary tank has its hull facing west and its turret traversed 0.55 rad away from the hull. Stage
  C moves all three units to representative alternate headings, with the tank turret traversed
  1.65 rad from its hull.

The Phase 4 captures used camera zoom 22, the closest permitted gameplay zoom, and labelled that
“default battle zoom.” Zoom 22 is **not** the opening battle zoom (36). This pack corrects that for
the primary test. The earlier frames remain useful close comparison, but they are not the primary
evidence for the ≥ 90 % criterion.

## Administration

1. Recruit six independent reviewers who have not seen the Phase 4 report, the answer key, or the
   model source. Assign sets 1–6, one per reviewer, and do not reuse a reviewer across sets.
2. Use a desktop browser at 100 % page zoom. Do not enlarge or crop the images further. Record the
   reviewer identifier and display in the form.
3. Show the pack one sample at a time. Do not name, hint at, or confirm a role. Do not comment on a
   previous answer.
4. Complete Stage A first. It is the only stage that counts for the primary criterion. Stages B–D
   are secondary/repeated diagnostics and must not be mixed into the primary denominator.
5. After the last sample, download the response JSON and place it in a coordinator-only folder. The
   instrument never reveals correct answers or gives feedback.
6. Score only after all six sets have been collected. Use `ANSWER_KEY.md`.

## Pre-registered decision rule

- Primary population: 3 roles × 6 reviewers = **18 first-exposure observations**.
- Pass: **17/18 or better** (94.4 %), the smallest count satisfying the audit’s ≥ 90 % criterion.
- Fail: 16/18 or worse (88.9 %), with the misidentifications recorded by role and stage.
- Inconclusive: fewer than six reviewers, missing primary responses, or a reviewer who saw answers
  or role labels before testing.

Raw counts must be reported alongside percentages. A repeated Stage C or D observation is not an
independent participant and cannot repair a failed primary count.

## Limitations

- No silhouette-only, neutral-material set was produced. It would require a renderer material
  override or destructive image processing, both outside this validation-only phase. Stage A uses
  the real Phase 3 terrain and materials.
- The capture environment is desktop Chromium/ANGLE on one GPU. No mobile, other-GPU or GPU-timing
  claim is made.
- The pack tests role recognition, not selection accuracy. The existing 26 px unit-centre picking
  contract is untouched; the audit’s separate 6 px selection-accuracy criterion is not part of this
  test.
- Team tint is applied to the shoulder patch and vehicle trim, and the Stage D ring is team-blue.
  At battle zoom the ring is the more legible team cue; the pack does not separately test team-colour
  discrimination.
- The developer’s own reading of the images is not reviewer evidence.
