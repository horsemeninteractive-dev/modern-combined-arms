/**
 * Persisted, remappable battle hotkeys.
 *
 * Bindings are stored by action id, not by keycap, so a settings blob written
 * before an action existed gains that action's default without losing the
 * player's other choices. Every normaliser is total: an unknown, reserved or
 * duplicate saved key falls back to a free default instead of throwing or
 * leaving two actions on the same key.
 */

export const BINDABLE_ACTIONS = [
  { id: 'attackMove', label: 'Attack-move' },
  { id: 'patrol', label: 'Patrol' },
  { id: 'guard', label: 'Guard' },
  { id: 'stop', label: 'Stop' },
  { id: 'hold', label: 'Hold position' },
  { id: 'capture', label: 'Capture objective' },
  { id: 'garrison', label: 'Garrison / board' },
  { id: 'return', label: 'Return to base' },
  { id: 'dive', label: 'Dive / surface' },
  { id: 'pause', label: 'Pause' },
  { id: 'eventLog', label: 'Field reports' },
  { id: 'build', label: 'Construction' },
  { id: 'productionTab', label: 'Production tabs' },
  { id: 'centerBase', label: 'Centre on base' },
  { id: 'toggleHud', label: 'Hide HUD' },
] as const;

export type BindableActionId = (typeof BINDABLE_ACTIONS)[number]['id'];
export type KeyBindings = Record<BindableActionId, string>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  attackMove: 'KeyA',
  patrol: 'KeyT',
  guard: 'KeyF',
  stop: 'KeyS',
  hold: 'KeyH',
  capture: 'KeyC',
  garrison: 'KeyG',
  return: 'KeyR',
  dive: 'KeyD',
  pause: 'KeyP',
  eventLog: 'KeyL',
  build: 'KeyB',
  productionTab: 'Tab',
  centerBase: 'Space',
  toggleHud: 'KeyU',
};

/**
 * Keys the game reserves for navigation, groups and system actions. Keeping
 * these out of the action map means a rebind can never remove Escape, the
 * camera arrows, control groups, bookmarks or the function-key shortcuts.
 */
const RESERVED_KEY_CODES = new Set([
  'Escape',
  'Enter',
  'NumpadEnter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  // Speed controls keep their fixed keys; a rebind must not shadow them.
  'Equal',
  'Minus',
  'NumpadAdd',
  'NumpadSubtract',
  'CapsLock',
  'ContextMenu',
  'NumLock',
  'ScrollLock',
  'Pause',
  'PrintScreen',
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'OSLeft',
  'OSRight',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
  ...Array.from({ length: 10 }, (_, index) => `Numpad${index}`),
]);

/** A saved or captured code the player may assign to an action. */
const BINDABLE_CODE_PATTERN =
  /^(?:Key[A-Z]|Space|Tab|Backquote|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Numpad(?:Add|Subtract|Multiply|Divide|Decimal))$/;

export function isBindableKeyCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    BINDABLE_CODE_PATTERN.test(code) &&
    !RESERVED_KEY_CODES.has(code)
  );
}

/** Human-readable keycap text for a `KeyboardEvent.code`. */
export function keyLabel(code: string): string {
  if (code === 'Space') return 'SPACE';
  if (code === 'Tab') return 'TAB';
  if (code === 'Backquote') return '`';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return "'";
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Slash') return '/';
  if (code === 'Backslash') return '\\';
  if (code === 'NumpadAdd') return 'NUM +';
  if (code === 'NumpadSubtract') return 'NUM -';
  if (code === 'NumpadMultiply') return 'NUM *';
  if (code === 'NumpadDivide') return 'NUM /';
  if (code === 'NumpadDecimal') return 'NUM .';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `NUM ${code.slice(6)}`;
  return code;
}

export function actionForKey(
  bindings: KeyBindings,
  code: string,
): BindableActionId | null {
  for (const action of BINDABLE_ACTIONS) {
    if (bindings[action.id] === code) return action.id;
  }
  return null;
}

export function actionLabel(action: BindableActionId): string {
  return BINDABLE_ACTIONS.find((entry) => entry.id === action)?.label ?? action;
}

export type BindingConflict =
  | { kind: 'reserved' }
  | { kind: 'conflict'; action: BindableActionId };

export type AssignBindingResult =
  | { ok: true; bindings: KeyBindings }
  | { ok: false; conflict: BindingConflict };

/**
 * Assign one action's key without ever producing a duplicate. The caller can
 * show the conflicting action by name instead of silently stealing its key.
 */
export function assignKeyBinding(
  bindings: KeyBindings,
  action: BindableActionId,
  code: string,
): AssignBindingResult {
  const current = normaliseKeyBindings(bindings);
  if (!isBindableKeyCode(code)) {
    return { ok: false, conflict: { kind: 'reserved' } };
  }
  const owner = actionForKey(current, code);
  if (owner && owner !== action) {
    return { ok: false, conflict: { kind: 'conflict', action: owner } };
  }
  return { ok: true, bindings: { ...current, [action]: code } };
}

const FALLBACK_CODES = Array.from({ length: 26 }, (_, index) =>
  `Key${String.fromCharCode(65 + index)}`,
);

function freeDefault(action: BindableActionId, used: Set<string>): string {
  const preferred = DEFAULT_KEY_BINDINGS[action];
  if (isBindableKeyCode(preferred) && !used.has(preferred)) return preferred;
  for (const code of FALLBACK_CODES) {
    if (!used.has(code)) return code;
  }
  // Fifteen bindable actions cannot exhaust 26 letters. This is only a total
  // fallback for a future action list that outgrows the alphabet.
  return preferred;
}

/** Total migration for an older or hand-edited settings blob. */
export function normaliseKeyBindings(value: unknown): KeyBindings {
  const raw =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const used = new Set<string>();
  const out = {} as KeyBindings;
  for (const action of BINDABLE_ACTIONS) {
    const saved = raw[action.id];
    const code =
      typeof saved === 'string' && isBindableKeyCode(saved) && !used.has(saved)
        ? saved
        : freeDefault(action.id, used);
    out[action.id] = code;
    used.add(code);
  }
  return out;
}

export function resetKeyBindings(): KeyBindings {
  return { ...DEFAULT_KEY_BINDINGS };
}
