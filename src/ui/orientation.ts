/**
 * MCA is played in landscape: the command deck, production rail and tactical
 * map only have room when the screen is wider than it is tall. Touch devices
 * held upright get a blocking prompt instead of a broken battlefield.
 */
export function needsLandscape(width: number, height: number, isTouch: boolean): boolean {
  return isTouch && height > width;
}
