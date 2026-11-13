/** Solar declination in degrees (Cooper 1969, accurate to ~0.5°). Enough
 *  for the ratio-based cloud check and the day-length estimate; "is the
 *  sun up" uses the NOAA model in `moon.ts` instead. */
export function declinationDeg(dayOfYear: number): number {
  return 23.45 * Math.sin(((360 * (284 + dayOfYear)) / 365) * Math.PI / 180);
}
