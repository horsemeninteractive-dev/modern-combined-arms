import { describe, expect, it } from 'vitest';
import {
  BINDABLE_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  actionForKey,
  actionLabel,
  assignKeyBinding,
  isBindableKeyCode,
  keyLabel,
  normaliseKeyBindings,
  resetKeyBindings,
} from '../src/inputBindings';

describe('battle key bindings', () => {
  it('starts with one unique, allowed key per action', () => {
    const codes = BINDABLE_ACTIONS.map((action) => DEFAULT_KEY_BINDINGS[action.id]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => isBindableKeyCode(code))).toBe(true);
    expect(actionForKey(DEFAULT_KEY_BINDINGS, 'KeyT')).toBe('patrol');
    expect(actionForKey(DEFAULT_KEY_BINDINGS, 'KeyF')).toBe('guard');
    expect(actionForKey(DEFAULT_KEY_BINDINGS, 'Escape')).toBeNull();
  });

  it('rebinds without stealing another action and refuses reserved keys', () => {
    const assigned = assignKeyBinding(DEFAULT_KEY_BINDINGS, 'guard', 'KeyJ');
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(actionForKey(assigned.bindings, 'KeyJ')).toBe('guard');
    expect(actionForKey(assigned.bindings, 'KeyF')).toBeNull();

    const conflict = assignKeyBinding(assigned.bindings, 'guard', 'KeyT');
    expect(conflict).toEqual({
      ok: false,
      conflict: { kind: 'conflict', action: 'patrol' },
    });
    expect(actionLabel('patrol')).toBe('Patrol');

    for (const reserved of ['Escape', 'ArrowUp', 'Digit1', 'F2', 'ShiftLeft']) {
      expect(assignKeyBinding(assigned.bindings, 'guard', reserved)).toEqual({
        ok: false,
        conflict: { kind: 'reserved' },
      });
    }
  });

  it('normalises an old or hand-edited save into a usable map', () => {
    const repaired = normaliseKeyBindings({
      attackMove: 'Escape',
      patrol: 'KeyA',
      guard: 'KeyA',
      stop: 'nonsense',
      hold: 42,
      capture: 'KeyK',
    });
    const codes = BINDABLE_ACTIONS.map((action) => repaired[action.id]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => isBindableKeyCode(code))).toBe(true);
    // A valid custom choice survives, while invalid and duplicate entries fall
    // back to free defaults rather than leaving two actions on one key.
    expect(repaired.capture).toBe('KeyK');
    expect(repaired.stop).toBe('KeyS');
    expect(repaired.attackMove).toBe('KeyA');
    expect(repaired.patrol).not.toBe(repaired.guard);
    expect(normaliseKeyBindings(undefined)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(resetKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
    expect(resetKeyBindings()).not.toBe(DEFAULT_KEY_BINDINGS);
  });

  it('prints stable keycap labels', () => {
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('Space')).toBe('SPACE');
    expect(keyLabel('Tab')).toBe('TAB');
    expect(keyLabel('NumpadAdd')).toBe('NUM +');
    expect(keyLabel('Digit4')).toBe('4');
  });
});
