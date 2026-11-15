# Next Task Prompt — Make the Result Screen Usable on Mobile

**Status: completed 2026-11-15.** HUD-11 is fixed. The current 844×390 card ends
at 376.6 px, the 667×374 card ends at 361.5 px, both keep 44 px actions outside
the scrolling report, and neither creates document scroll. HUD-10/HUD-12 were
fixed in the follow-up change: a rebuilt shell restores the result and pause
overlays. The original brief is retained below as history. Evidence is in
[AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) §9.4, `tests/modal-layout.test.ts` and
`tests/hud-shell.test.ts`.

```text
You are implementing one focused change in the Modern Combined Arms (MCA) RTS
repository. Read docs/AUDIT_FINDINGS.md §9.4 (HUD-11), the result-screen markup
and CSS, and the existing HUD layout tests before editing.

GOAL
A player who wins or loses on a phone in landscape must be able to read the
result and reach every action without reloading. Keep the desktop result screen
visually unchanged except for shared structure needed by the responsive case.

CONFIRMED CURRENT STATE (re-measure before changing; do not trust stale counts)
At 844×390 the result card is 467.5 px tall in a 390 px viewport; its action
buttons span y=405.5–442.4. At 667×374 the card is 499 px in a 374 px viewport;
actions span y=392.2–473.9. The page does not scroll, `.end-screen` is
`overflow: visible`, and the action buttons are 36.9 px high.

REQUIREMENTS
1. The result card fits inside the visual viewport at 844×390 and 667×374, or
   its contents scroll inside a bounded card. The outcome headline and actions
   must both be reachable.
2. Every action is at least 44×44 CSS px with visible focus. Actions must not be
   covered by the card's own scroll region or the bottom safe area.
3. The layout must not create document-level horizontal or vertical scrolling;
   the battlefield shell stays fixed as it does today.
4. Preserve the existing desktop composition at 1280×720 and 1920×1080, and
   preserve current result copy, restart/save/editor/menu behaviour.
5. Do not change simulation, AI, economy, scenario or save code.
6. This change deliberately left the separate HUD-10/HUD-12 lifecycle bugs for
   a follow-up; that follow-up is now complete.

EXPECTED TOUCH POINTS
- The result-screen markup and styles (`.end-screen`, result card, action row).
- `src/ui/hud.ts` where the end state is mounted.
- Focused layout tests under `tests/` if the existing HUD tests can express the
  constraint; otherwise add a small test for the computed layout contract.

VERIFICATION
- `npm run typecheck`
- `npm test`
- `npm run build`
- In a browser or the existing preview harness, measure at 844×390 and
  667×374: card top/bottom inside the viewport, action row inside the card,
  every action at least 44 px high, no document scroll, and click RESTART to
  confirm a fresh battle starts.
- Re-check 1280×720 and 1920×1080 for no visual regression.

REPORT
State what changed, the measured card/action rects at both mobile sizes, the
desktop re-check, and any size or hardware case you could not exercise.
```
