
/**
 * Uniform grid over the wrapping world for fast "who is near this point"
 * queries. Rebuild it after positions change; it holds indices, not copies.
 */
export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  /** cellStart[c]..cellStart[c + 1] is the slice of `items` in cell c. */
  private cellStart: Uint32Array;
  private items = new Uint32Array(0);
  private xs: Float32Array = new Float32Array(0);
  private ys: Float32Array = new Float32Array(0);

  constructor(
    private readonly worldWidth: number,
    private readonly worldHeight: number,
    cellSize: number,
  ) {
    this.cols = Math.max(1, Math.floor(worldWidth / cellSize));
    this.rows = Math.max(1, Math.floor(worldHeight / cellSize));
    this.cellWidth = worldWidth / this.cols;
    this.cellHeight = worldHeight / this.rows;
    this.cellStart = new Uint32Array(this.cols * this.rows + 1);
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.floor(x / this.cellWidth));
    const cy = Math.min(this.rows - 1, Math.floor(y / this.cellHeight));
    return cy * this.cols + cx;
  }

  /**
   * Index the first `count` points. Positions must lie inside the world. They
   * are copied, so queries see them as they were at build time even if the
   * caller moves points, or reallocates its arrays, afterwards.
   */
  build(xs: Float32Array, ys: Float32Array, count: number): void {
    if (this.items.length < count) {
      const size = Math.max(count, this.items.length * 2);
      this.items = new Uint32Array(size);
      this.xs = new Float32Array(size);
      this.ys = new Float32Array(size);
    }
    this.xs.set(xs.subarray(0, count));
    this.ys.set(ys.subarray(0, count));

    // Counting sort: count per cell, prefix-sum into end offsets, then fill backwards.
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < count; i++) start[this.cellOf(xs[i]!, ys[i]!)]!++;
    let sum = 0;
    for (let c = 0; c < start.length; c++) {
      sum += start[c]!;
      start[c] = sum;
    }
    for (let i = count - 1; i >= 0; i--) {
      const c = this.cellOf(xs[i]!, ys[i]!);
      this.items[--start[c]!] = i;
    }
  }

  /**
   * Call `visit` with the index of every point within `radius` of (x, y),
   * measuring distance across the world's wrapped edges.
   */
  query(x: number, y: number, radius: number, visit: (index: number) => void): void {
    const { cols, rows, worldWidth, worldHeight, cellStart, items, xs, ys } = this;
    const r2 = radius * radius;
    const halfWidth = worldWidth / 2;
    const halfHeight = worldHeight / 2;

    // The cells the circle's bounding box touches. If that covers a whole
    // axis, scan each cell once rather than wrapping onto repeats.
    let xFrom = Math.floor((x - radius) / this.cellWidth);
    let xTo = Math.floor((x + radius) / this.cellWidth);
    let yFrom = Math.floor((y - radius) / this.cellHeight);
    let yTo = Math.floor((y + radius) / this.cellHeight);
    if (xTo - xFrom + 1 >= cols) {
      xFrom = 0;
      xTo = cols - 1;
    }
    if (yTo - yFrom + 1 >= rows) {
      yFrom = 0;
      yTo = rows - 1;
    }

    for (let gy = yFrom; gy <= yTo; gy++) {
      // The box reaches at most one world-width past either edge, so one step wraps it.
      const row = (gy < 0 ? gy + rows : gy >= rows ? gy - rows : gy) * cols;
      for (let gx = xFrom; gx <= xTo; gx++) {
        const cell = row + (gx < 0 ? gx + cols : gx >= cols ? gx - cols : gx);
        for (let k = cellStart[cell]!; k < cellStart[cell + 1]!; k++) {
          const i = items[k]!;
          // Shortest way round the wrapped world, for two points inside it.
          let dx = xs[i]! - x;
          if (dx > halfWidth) dx -= worldWidth;
          else if (dx < -halfWidth) dx += worldWidth;
          let dy = ys[i]! - y;
          if (dy > halfHeight) dy -= worldHeight;
          else if (dy < -halfHeight) dy += worldHeight;
          if (dx * dx + dy * dy <= r2) visit(i);
        }
      }
    }
  }
}
