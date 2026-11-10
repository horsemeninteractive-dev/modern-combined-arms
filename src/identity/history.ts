/**
 * A small undo/redo history over immutable snapshots.
 *
 * Values are cloned by the caller before being pushed, so the editor's live
 * draft can be mutated freely. The limit is a memory guard, not a policy: a flag
 * composition is a few hundred bytes, so forty steps is nothing.
 */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private readonly limit = 40) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  /** Record a step and invalidate the redo branch. */
  push(value: T): void {
    this.undoStack.push(value);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Return the previous value, or null when there is nothing to undo. */
  undo(current: T): T | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(current);
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
