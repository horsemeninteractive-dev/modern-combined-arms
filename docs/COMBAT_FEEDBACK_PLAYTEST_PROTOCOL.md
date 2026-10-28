# MCA — Combat Feedback Playtest Protocol

**Status: not performed.** This document defines the procedure and the evidence a
facilitator needs. It contains no human results.

Build under test: `0.1.1 BETA` plus the uncommitted Phase 4 working tree. Record
the exact commit/build string from the pause screen for every session.

## 1. Purpose

Automated tests prove that effects are connected to simulation events. They do
not prove that a player can read a firefight. This protocol measures:

1. weapon-class recognition;
2. hit / miss / destruction recognition;
3. infantry presence and facing at battle zoom;
4. spatial-audio direction and distance;
5. battlefield awareness in a dense engagement;
6. whether hidden enemy fire stays unobservable under fog.

It also separates a rendering defect from an unfamiliarity or UX problem.

## 2. Equipment and environment

- Desktop browser at 1600 × 900 or larger, device pixel ratio 1, 100 % page zoom.
- Headphones for the audio block; system volume fixed for the whole session.
- Music and voice at their normal defaults; effects at the default (0.8).
- Each reviewer tested alone. No implementation notes, model IDs or class
  descriptions shown before a trial.
- Record browser, GPU, frame rate, game speed and the build string.

## 3. Facilitator setup (deterministic clips)

The dev-only probe produces repeatable scenes without AI or a live opponent:

```js
// Development build only, browser console.
const probe = await import('/tools/combat-probe.js');

await probe.stage('rifle',      { zoom: 36 });
await probe.stage('tank',       { zoom: 36 });
await probe.stage('atgm',       { zoom: 36 });
await probe.stage('artillery',  { zoom: 36 });
await probe.stage('antiAir',    { zoom: 30 });
await probe.stage('miss',       { zoom: 36 });
await probe.stage('destruction',{ zoom: 36 });
await probe.stage('dense',      { zoom: 36 });
await probe.stage('fog',        { zoom: 36 });
```

For each clip: hide the HUD, step until the shot or impact, record two seconds at
normal speed, then reset the scene. The existing matched captures in
`docs/visual-audit/` show the expected framing and can be used as a checklist.
Do not label clips with the weapon class.

The facilitator must not tell reviewers which effect was changed in Phase 4.

## 4. Block A — Weapon recognition

Present 24 clips, four per class, in a fixed shuffled order:

- small arms (rifle / machine gun)
- tank main gun
- ATGM / guided missile
- artillery
- air-defence missile
- static anti-tank or coastal launch

Question: **"Which weapon class fired?"** (six options, one answer).

Correct = the intended class. A reviewer who says "cannon" for a tank gun is
correct; "missile" for an ATGM is correct; "gun" for artillery is not.

Pass: ≥ 85 % correct per class and ≥ 90 % overall, six reviewers, 144
observations.

## 5. Block B — Hit, miss, destruction

Present 12 matched clips, two per reviewer per outcome:

- direct hit on a vehicle;
- ground miss beside the target;
- vehicle destruction;
- building loss.

Question: **"What happened to the target?"** (hit / miss / destroyed / no
contact).

Pass: ≥ 90 % correct across 72 observations. Destruction must not be confused
with a normal hit more than once per reviewer.

## 6. Block C — Infantry at battle zoom

Use an unedited 15-second clip of a normal skirmish at camera zoom 36 (the
opening battle zoom), not a staged showroom. Freeze on three frames, one
friendly and one enemy group per frame.

Questions:

1. **"How many infantry are inside the marked box?"** (0–8).
2. **"Which way is each section facing?"** (eight compass points, or "static").
3. **"Which side owns each section?"** (friendly / enemy / cannot tell).

Pass: count within ±1 for each group; facing within one compass point; ownership
correct in ≥ 90 % of observations. Record whether the ground pool or helmet was
what the reviewer used; that separates "small but readable" from "unreadable".

## 7. Block D — Spatial audio

Camera fixed; HUD hidden; music muted at the source but effects unchanged.
Play eight single cues per listener:

- left, right, front, rear, and two diagonal positions;
- one visible enemy shot and one fog-hidden enemy shot at equal distance.

Questions: **"Which side?"**, **"near or far?"**, **"did you hear anything?"**

Pass: ≥ 90 % correct side, ≥ 80 % correct distance band, and 100 % silence for
the hidden shot. Any audible hidden cue is a release blocker, not a score.

## 8. Block E — Dense battlefield awareness

Play a 30-second dense engagement (infantry, tanks, artillery, air defence,
static weapons, destruction, fog). Then pause and ask the reviewer to mark on a
still frame:

1. the three most important engagements;
2. where friendly infantry are;
3. where enemy fire is coming from;
4. one event they could not identify.

Score engagement locations within one screen inch of the facilitator's ground
truth. Pass: ≥ 85 % of marked engagements, no identification of hidden enemy
positions, and no more than one "could not identify" for visible fire.

## 9. Block F — Fog engagement

Use `stage('fog')` plus a hidden enemy battery and a visible friendly target:

1. hidden battery fires; the impact is visible on the friendly unit;
2. move the target into vision; the same battery becomes visible and fires;
3. move it back out; fire is hidden again;
4. turn the visual fog texture off and repeat step 3.

Ask: **"Can you see or hear the firing position? Mark it if yes."**

Pass: no reviewer marks the hidden battery, all reviewers mark it when visible,
and the visual fog toggle changes nothing. This block reuses the measurements in
`docs/COMBAT_FEEDBACK_PHASE_4.md` section 6.

## 10. Recording sheet

| Field | Value |
|---|---|
| Reviewer ID | |
| Session date / build | |
| Block / trial ID | |
| Clip or scene | |
| Answer | |
| Confidence (1–5) | |
| What the reviewer says they saw or heard | |
| Facilitator note (defect suspected?) | |

Store one row per observation. Do not collapse confidence into the pass count.

## 11. Defect or unfamiliarity?

When a reviewer fails a class:

1. replay one labelled training clip of that class;
2. retest two unlabelled clips;
3. pass after training → unfamiliarity, not a rendering defect;
4. repeated failure with correct labels → suspected rendering defect;
5. inspect the matched capture, the event/visibility logic and the audio
   parameters before changing any effect.

Never fix a recognition failure by adding an off-screen marker, disabling fog or
changing weapon data. Those are design decisions outside this protocol.

## 12. Evidence set

Facilitators should use the matched Phase 4 captures as the reference framing:

- `docs/visual-audit/phase4-combat-infantry-before-36-1000.png`
- `docs/visual-audit/phase4-combat-infantry-after-36-1000.png`
- `docs/visual-audit/phase4-combat-infantry-before-crop.png`
- `docs/visual-audit/phase4-combat-infantry-after-crop.png`
- `docs/visual-audit/phase4-combat-infantry-enemy-crop.png`
- `docs/visual-audit/phase4-combat-artillery-arc-36.png`
- `docs/visual-audit/phase4-combat-wrecks-36.png`
- `docs/visual-audit/phase4-combat-building-loss-36.png`

The protocol is complete when six reviewers have produced 144 weapon, 72
hit/miss, 72 infantry, 48 audio and 36 fog observations, with the raw sheet
attached. Until then human validation is **pending**.
