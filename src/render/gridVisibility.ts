export type GridScreen = 'menu' | 'battle' | 'editor';
export type GridMode =
  | 'none'
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'capture'
  | 'repair'
  | 'garrison'
  | 'box'
  | 'place';

/**
 * The terrain shader grid is construction guidance, not a permanent map
 * overlay. The editor draws its own surface-following grid in the 2D overlay.
 */
export function constructionGridVisible(screen: GridScreen, mode: GridMode): boolean {
  return screen === 'battle' && mode === 'place';
}
