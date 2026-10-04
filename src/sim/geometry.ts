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
