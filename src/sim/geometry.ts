/** Wrap a coordinate into [0, size) for the toroidal world. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Shortest signed distance from a to b along one wrapped axis. */
export function wrappedDelta(a: number, b: number, size: number): number {
  let d = (b - a) % size;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

/**
 * Wrap a coordinate into [0, size), as `value - Math.floor(value / size) * size`
 * does, but without the division for a value within one world of the edge, the
 * usual case for a point a short way from a creature.
 */
export function wrapNear(value: number, size: number): number {
  if (value < 0) return value >= -size ? value + size : value - Math.floor(value / size) * size;
  if (value >= size) return value < size * 2 ? value - size : value - Math.floor(value / size) * size;
  return value;
}
