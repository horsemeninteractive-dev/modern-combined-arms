import { describe, expect, it } from 'vitest';
import {
  dismissEditorSheet,
  editorSheetHeight,
  editorSheetOffset,
  resolveEditorLayout,
} from '../src/ui/editorLayout';

describe('editor layout selection', () => {
  it('keeps the workstation composition at the desktop reference size', () => {
    expect(resolveEditorLayout(1280, 720, false)).toBe('desktop');
    expect(resolveEditorLayout(1920, 1080, false)).toBe('desktop');
  });

  it('uses the touch composition at both landscape phone sizes', () => {
    expect(resolveEditorLayout(844, 390, false)).toBe('touch');
    expect(resolveEditorLayout(667, 375, false)).toBe('touch');
  });

  it('uses the touch composition on a coarse-pointer tablet', () => {
    expect(resolveEditorLayout(1024, 768, true)).toBe('touch');
    expect(resolveEditorLayout(1024, 768, false)).toBe('desktop');
  });

  it('switches a narrow pointer window and a short viewport to touch', () => {
    expect(resolveEditorLayout(880, 900, false)).toBe('touch');
    expect(resolveEditorLayout(1200, 460, false)).toBe('touch');
  });
});

describe('editor bottom sheet', () => {
  it('stays readable on the landscape phone sizes without covering the topbar', () => {
    expect(editorSheetHeight(375)).toBe(255);
    expect(editorSheetHeight(390)).toBe(265);
    expect(editorSheetHeight(720)).toBe(460);
  });

  it('clamps the height for very short and very tall viewports', () => {
    expect(editorSheetHeight(200)).toBe(220);
    expect(editorSheetHeight(1600)).toBe(460);
  });

  it('follows downward drags only and dismisses on a deliberate pull', () => {
    expect(editorSheetOffset(-40, 265)).toBe(0);
    expect(editorSheetOffset(120, 265)).toBe(120);
    expect(editorSheetOffset(900, 265)).toBe(265);
    expect(dismissEditorSheet(40, 265)).toBe(false);
    expect(dismissEditorSheet(80, 265)).toBe(true);
    expect(dismissEditorSheet(60, 220)).toBe(true);
  });
});
