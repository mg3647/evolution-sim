import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ToolKind } from '../sim/world';
import { CREATURE_STRIDE, type Snapshot } from '../worker/protocol';

const BACKGROUND_COLOR = 0x0b0f14;
const GRID_COLOR = 0xffffff;
const GRID_ALPHA = 0.05;
const BORDER_COLOR = 0x6b8296;
const GRID_SPACING = 100;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;
/** Fraction of the view the world fills when fitted. */
const FIT_MARGIN = 0.9;

/** Ground colour with no plants and with a full cell, as [r, g, b]. */
const SOIL_COLOR = [28, 24, 20] as const;
const PLANT_COLOR = [64, 158, 60] as const;

type Rgb = readonly [number, number, number];
/**
 * Soil and plant colours at the four points of the year, starting in spring.
 * The ground is drawn in a blend of the two nearest, so the map shows the
 * season: fresh green, deep green, gold, then frost.
 */
const SEASON_PALETTE: readonly { soil: Rgb; plant: Rgb }[] = [
  { soil: [30, 26, 20], plant: [104, 184, 72] },
  { soil: [28, 24, 20], plant: [52, 148, 58] },
  { soil: [36, 27, 18], plant: [184, 146, 54] },
  { soil: [44, 47, 54], plant: [132, 150, 142] },
];

/** The ground colours for a point in the year, where 0 and 1 are both the start of spring. */
function seasonColors(yearFraction: number): { soil: number[]; plant: number[] } {
  const at = (((yearFraction % 1) + 1) % 1) * SEASON_PALETTE.length;
  const from = SEASON_PALETTE[Math.floor(at) % SEASON_PALETTE.length]!;
  const to = SEASON_PALETTE[(Math.floor(at) + 1) % SEASON_PALETTE.length]!;
  const t = at - Math.floor(at);
  const blend = (a: Rgb, b: Rgb) => a.map((value, c) => value + (b[c]! - value) * t);
  return { soil: blend(from.soil, to.soil), plant: blend(from.plant, to.plant) };
}
/**
 * How each biome's ground is drawn: its bare and fully grown colours, and how
 * far the seasonal colours are pulled toward them. Indexed by Biome;
 * grassland keeps the plain seasonal colours.
 */
export const BIOME_GROUND: readonly { soil: Rgb; plant: Rgb; pull: number }[] = [
  { soil: [28, 24, 20], plant: [64, 158, 60], pull: 0 },
  { soil: [22, 26, 18], plant: [28, 104, 50], pull: 0.75 },
  { soil: [16, 30, 26], plant: [14, 128, 96], pull: 0.8 },
  { soil: [168, 142, 92], plant: [150, 164, 78], pull: 0.85 },
  { soil: [150, 162, 172], plant: [112, 158, 128], pull: 0.8 },
];

/** Ground colour where meat lies thick. */
const MEAT_COLOR = [190, 60, 70] as const;
const WALL_COLOR = [120, 126, 134] as const;
const WATER_COLOR = [34, 78, 128] as const;
/** How much darker the ground is drawn at midnight than at noon. */
const NIGHT_DIMMING = 0.55;
/** Darkness shown when days pass too fast to draw one by one. */
const STEADY_DARK = 0.2;
const SCENT_COLOR = [170, 120, 255] as const;
/** Tints of the temperature overlay, and how strongly the hottest and coldest places are covered. */
const HOT_COLOR = [255, 96, 48] as const;
const COLD_COLOR = [96, 176, 255] as const;
const TEMPERATURE_OPACITY = 0.75;
/** How strongly full scent covers the ground when the scent overlay is on. */
const SCENT_OPACITY = 0.7;
/** How strongly a cell full of meat covers the ground colour. */
const MEAT_OPACITY = 0.85;
const CREATURE_SATURATION = 0.7;
/** Brightness of a starving creature; a well-fed one is at 1. */
const DIMMEST = 0.45;
const CREATURE_TEXTURE_SIZE = 64;
/** A click selects the nearest creature within this many screen pixels. */
const PICK_RADIUS = 14;
/** A press that moves less than this many pixels is a click, not a drag. */
const CLICK_SLOP = 4;
const SELECTION_COLOR = 0xffffff;
/** Tools that keep applying as the pointer is dragged; the others apply once per click. */
const DRAG_TOOLS: ReadonlySet<ToolKind> = new Set(['wall', 'erase', 'fertilise', 'blight', 'fire']);
/** Colours of fire (it flickers between the two), of fresh ash, and of branches and stones on the ground. */
const FIRE_COLORS: readonly Rgb[] = [
  [255, 150, 40],
  [255, 214, 90],
];
const ASH_COLOR = [58, 54, 52] as const;
const ASH_OPACITY = 0.7;
const BRANCH_COLOR = [146, 100, 54] as const;
const STONE_COLOR = [176, 176, 182] as const;
const STORE_COLOR = [232, 214, 120] as const;
const ITEM_OPACITY = 0.45;
/** Colour of the outline showing where each tool would act. */
const TOOL_COLORS: Record<ToolKind, number> = {
  meteor: 0xff7a3c,
  plague: 0xb6ff3c,
  wall: 0xc8ced6,
  erase: 0xc8ced6,
  fertilise: 0x5fd35f,
  blight: 0xb08a5a,
  fire: 0xff9628,
};
/** Ring drawn around creatures infected with the plague. */
const SICK_COLOR = 0xb6ff3c;
/** Ring drawn around creatures that are calling. */
const CALL_COLOR = 0x9fd8ff;
/** Ring drawn around creatures with defenses, and the least defense that shows one. */
const DEFENSE_COLOR = 0xffffff;
const DEFENSE_SHOWN = 0.25;
/** Smallest radius a creature is drawn at, in screen pixels. */
const MIN_SCREEN_RADIUS = 2.5;

/**
 * A hue for a species id. Successive ids land far apart on the colour wheel
 * (steps of the golden ratio), so neighbouring species are easy to tell apart.
 */
export function speciesHue(id: number): number {
  return (id * 0.618034) % 1;
}

/** Convert hue, saturation and value in [0, 1] to a 0xRRGGBB colour. */
function hsvToRgb(h: number, s: number, v: number): number {
  const channel = (offset: number) => {
    const k = (offset + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return (channel(5) << 16) | (channel(3) << 8) | channel(1);
}

/**
 * A white body with a dark spot at the front, tinted per creature. Plant-eaters
 * are discs; meat-eaters are pointed, so the two can be told apart at a glance.
 */
function createCreatureTexture(pointed: boolean): Texture {
  const size = CREATURE_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (pointed) {
    ctx.moveTo(size - 1, size / 2);
    ctx.lineTo(size * 0.12, size * 0.06);
    ctx.lineTo(size * 0.3, size / 2);
    ctx.lineTo(size * 0.12, size * 0.94);
    ctx.closePath();
  } else {
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = '#202020';
  ctx.beginPath();
  ctx.arc(size * (pointed ? 0.66 : 0.78), size / 2, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}

/** Draws the world onto a PixiJS canvas and handles the pan/zoom camera. */
export class WorldRenderer {
  /** Called with a world position and radius when the user clicks the world. */
  onPick: ((x: number, y: number, radius: number) => void) | null = null;
  /** Called when the tool in hand is applied: at a point, or along a drag from one point to the next. */
  onTool: ((tool: ToolKind, x: number, y: number, fromX: number, fromY: number) => void) | null = null;
  /** Whether to tint the ground with the scent creatures have left. */
  showScent = false;
  /** Whether to tint the ground blue where it is cold and red where it is hot. */
  showTemperature = false;
  /** Colour creatures by their inherited hue, or by the species they are grouped into. */
  colorBy: 'family' | 'species' = 'family';
  /** Keep the selected creature in the middle of the view. */
  follow = false;

  private app = new Application();
  private camera = new Container();
  private plantSprite = new Sprite();
  private overlay = new Graphics();
  private creatureLayer = new Container();
  private selectionRing = new Graphics();
  private toolCursor = new Graphics();
  private tool: ToolKind | null = null;
  private lastToolPoint = { x: 0, y: 0 };
  private creatureSprites: Sprite[] = [];
  private plantEaterTexture = Texture.EMPTY;
  private meatEaterTexture = Texture.EMPTY;
  private plantCanvas = document.createElement('canvas');
  private plantImage: ImageData | null = null;
  private hostObserver: ResizeObserver | null = null;
  private lastSnapshot: Snapshot | null = null;
  private worldWidth = 0;
  private worldHeight = 0;
  private dragging = false;
  private cameraMoved = false;
  private lastPointer = { x: 0, y: 0 };
  private pressPoint = { x: 0, y: 0 };

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: BACKGROUND_COLOR,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(this.app.canvas);
    this.plantEaterTexture = createCreatureTexture(false);
    this.meatEaterTexture = createCreatureTexture(true);
    this.camera.addChild(
      this.plantSprite,
      this.overlay,
      this.creatureLayer,
      this.selectionRing,
      this.toolCursor,
    );
    this.app.stage.addChild(this.camera);
    this.attachCameraControls(this.app.canvas);
    // Keep the world fitted through window resizes until the user moves the camera.
    this.app.renderer.on('resize', () => {
      if (!this.cameraMoved) this.applyFit();
    });
    // PixiJS only follows window resizes; the host also changes size when the toolbar wraps.
    this.hostObserver = new ResizeObserver(() => this.app.resize());
    this.hostObserver.observe(host);
  }

  /** Draw the world as of this snapshot. */
  update(snapshot: Snapshot): void {
    // With drawing off the snapshot has no map; the last frame stays on screen.
    if (!snapshot.rendered) return;
    this.lastSnapshot = snapshot;
    this.setWorldSize(snapshot.config.worldWidth, snapshot.config.worldHeight);
    if (this.follow && snapshot.selected) {
      const o = snapshot.selected.index * CREATURE_STRIDE;
      const zoom = this.camera.scale.x;
      this.camera.position.set(
        this.app.screen.width / 2 - snapshot.creatures[o]! * zoom,
        this.app.screen.height / 2 - snapshot.creatures[o + 1]! * zoom,
      );
      this.cameraMoved = true;
    }
    this.drawPlants(snapshot);
    this.drawCreatures(snapshot);
  }

  /** Redraw the last snapshot, after a display option changed. */
  redraw(): void {
    if (this.lastSnapshot) this.update(this.lastSnapshot);
  }

  /** Creature draw size depends on zoom, so redraw them when it changes. */
  private onZoomChanged(): void {
    if (this.lastSnapshot) this.drawCreatures(this.lastSnapshot);
  }

  fitToView(): void {
    this.cameraMoved = false;
    // The canvas only tracks its host on the next frame; size it now.
    this.app.resize();
    this.applyFit();
  }

  destroy(): void {
    this.hostObserver?.disconnect();
    this.app.destroy(true, { children: true });
  }

  private setWorldSize(width: number, height: number): void {
    if (width === this.worldWidth && height === this.worldHeight) return;
    this.worldWidth = width;
    this.worldHeight = height;
    this.drawOverlay();
    this.fitToView();
  }

  private applyFit(): void {
    if (this.worldWidth === 0) return;
    const { width, height } = this.app.screen;
    const zoom = Math.min(width / this.worldWidth, height / this.worldHeight) * FIT_MARGIN;
    this.camera.scale.set(zoom);
    this.camera.position.set(
      (width - this.worldWidth * zoom) / 2,
      (height - this.worldHeight * zoom) / 2,
    );
    this.onZoomChanged();
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    for (let x = GRID_SPACING; x < this.worldWidth; x += GRID_SPACING) {
      g.moveTo(x, 0).lineTo(x, this.worldHeight);
    }
    for (let y = GRID_SPACING; y < this.worldHeight; y += GRID_SPACING) {
      g.moveTo(0, y).lineTo(this.worldWidth, y);
    }
    g.stroke({ color: GRID_COLOR, alpha: GRID_ALPHA, pixelLine: true });
    g.rect(0, 0, this.worldWidth, this.worldHeight).stroke({ color: BORDER_COLOR, pixelLine: true });
  }

  /** One pixel per plant cell, stretched over the world. */
  private drawPlants(snapshot: Snapshot): void {
    const { plantCols: cols, plantRows: rows, plants, meat, scent, walls, water, temperature, biome } = snapshot;
    const { fire, ash, items } = snapshot;
    const scentOpacity = this.showScent ? SCENT_OPACITY / 255 : 0;
    const canvas = this.plantCanvas;
    const ctx = canvas.getContext('2d')!;
    if (!this.plantImage || canvas.width !== cols || canvas.height !== rows) {
      canvas.width = cols;
      canvas.height = rows;
      this.plantImage = ctx.createImageData(cols, rows);
      this.plantSprite.texture = Texture.from(canvas, true);
      this.plantSprite.texture.source.scaleMode = 'linear';
    }

    // With seasons off the ground keeps its plain colours.
    const { config, environment } = snapshot;
    const seasonal = config.seasonLength > 0 && config.seasonStrength > 0;
    const { soil, plant } = seasonal
      ? seasonColors(environment.yearFraction)
      : { soil: SOIL_COLOR, plant: PLANT_COLOR };

    // Night dims the ground and cools it toward blue. Walls stay as they are.
    // Run fast enough and whole days pass in a blink: rather than strobe, the
    // dimming fades out to a steady half-light as a day drops under two seconds.
    const daySeconds = snapshot.measuredTps > 0 ? config.dayLength / snapshot.measuredTps : Infinity;
    const steadiness = Math.min(1, Math.max(0, (daySeconds - 0.5) / 1.5));
    const dark = (1 - environment.daylight) * steadiness + STEADY_DARK * (1 - steadiness);
    const dim: Rgb = [1 - NIGHT_DIMMING * dark, 1 - NIGHT_DIMMING * dark, 1 - NIGHT_DIMMING * 0.6 * dark];

    // Each biome's bare and grown colours for this point in the year.
    const grounds = BIOME_GROUND.map((ground) => ({
      soil: soil.map((value, c) => value + (ground.soil[c]! - value) * ground.pull),
      plant: plant.map((value, c) => value + (ground.plant[c]! - value) * ground.pull),
    }));

    const pixels = this.plantImage.data;
    for (let i = 0; i < plants.length; i++) {
      const t = plants[i]! / 255;
      const land = grounds[biome[i]!] ?? grounds[0]!;
      // Meat shows as red over whatever grows beneath it.
      const m = (meat[i]! / 255) * MEAT_OPACITY;
      const o = i * 4;
      const s = scent[i]! * scentOpacity;
      // The overlay reads -1 where it is coldest and 1 where it is hottest.
      const heat = this.showTemperature ? Math.max(-1, Math.min(1, ((temperature[i]! / 255) * 3 - 1.5) / 1.2)) : 0;
      const tint = heat > 0 ? HOT_COLOR : COLD_COLOR;
      const tintOpacity = Math.abs(heat) * TEMPERATURE_OPACITY;
      const flame = fire[i] ? FIRE_COLORS[(i + snapshot.tick) & 1]! : null;
      const sooty = (ash[i]! / 255) * ASH_OPACITY;
      const item = items[i]! & 2 ? STONE_COLOR : items[i]! & 1 ? BRANCH_COLOR : items[i]! & 4 ? STORE_COLOR : null;
      for (let c = 0; c < 3; c++) {
        if (walls[i]) {
          pixels[o + c] = WALL_COLOR[c]!;
          continue;
        }
        if (flame) {
          // Fire glows through the night.
          pixels[o + c] = flame[c]!;
          continue;
        }
        if (tintOpacity > 0) {
          // The overlay replaces the ground's colour but keeps water a little darker, so lakes still show.
          const base = water[i] ? WATER_COLOR[c]! : land.soil[c]! + (land.plant[c]! - land.soil[c]!) * t * 0.5;
          pixels[o + c] = base + (tint[c]! - base) * tintOpacity;
          continue;
        }
        if (water[i]) {
          // Meat and scent still show on water, so a floating body can be seen.
          const withMeat = WATER_COLOR[c]! + (MEAT_COLOR[c]! - WATER_COLOR[c]!) * m;
          pixels[o + c] = (withMeat + (SCENT_COLOR[c]! - withMeat) * s) * dim[c]!;
          continue;
        }
        let ground = land.soil[c]! + (land.plant[c]! - land.soil[c]!) * t;
        ground += (ASH_COLOR[c]! - ground) * sooty;
        if (item) ground += (item[c]! - ground) * ITEM_OPACITY;
        const withMeat = ground + (MEAT_COLOR[c]! - ground) * m;
        pixels[o + c] = (withMeat + (SCENT_COLOR[c]! - withMeat) * s) * dim[c]!;
      }
      pixels[o + 3] = 255;
    }
    ctx.putImageData(this.plantImage, 0, 0);
    this.plantSprite.texture.source.update();
    this.plantSprite.setSize(this.worldWidth, this.worldHeight);
  }

  private drawCreatures(snapshot: Snapshot): void {
    const { creatures, population } = snapshot;
    const sprites = this.creatureSprites;
    // Zoomed out, true-size creatures would be under a pixel; keep them visible.
    const minRadius = MIN_SCREEN_RADIUS / this.camera.scale.x;

    while (sprites.length < population) {
      const sprite = new Sprite(this.plantEaterTexture);
      sprite.anchor.set(0.5);
      sprites.push(sprite);
      this.creatureLayer.addChild(sprite);
    }

    for (let i = 0; i < sprites.length; i++) {
      const sprite = sprites[i]!;
      sprite.visible = i < population;
      if (!sprite.visible) continue;
      const o = i * CREATURE_STRIDE;
      sprite.position.set(creatures[o]!, creatures[o + 1]!);
      sprite.rotation = creatures[o + 2]!;
      sprite.texture = creatures[o + 6]! > 0.5 ? this.meatEaterTexture : this.plantEaterTexture;
      sprite.scale.set((Math.max(creatures[o + 4]!, minRadius) * 2) / CREATURE_TEXTURE_SIZE);
      // Hue is inherited, so relatives share a colour; hungry creatures are dimmer.
      const fed = Math.min(1, creatures[o + 3]! * 2);
      const hue = this.colorBy === 'species' ? speciesHue(creatures[o + 8]!) : creatures[o + 5]!;
      sprite.tint = hsvToRgb(hue, CREATURE_SATURATION, DIMMEST + (1 - DIMMEST) * fed);
    }

    const ring = this.selectionRing;
    ring.clear();
    let anySick = false;
    for (let i = 0; i < population; i++) {
      const o = i * CREATURE_STRIDE;
      if (creatures[o + 7]! <= 0) continue;
      const radius = Math.max(creatures[o + 4]!, minRadius) + 2 / this.camera.scale.x;
      ring.circle(creatures[o]!, creatures[o + 1]!, radius);
      anySick = true;
    }
    if (anySick) ring.stroke({ color: SICK_COLOR, pixelLine: true });

    // A close white ring around each creature with defenses worth noticing.
    let anyDefended = false;
    for (let i = 0; i < population; i++) {
      const o = i * CREATURE_STRIDE;
      if (creatures[o + 10]! < DEFENSE_SHOWN) continue;
      const radius = Math.max(creatures[o + 4]!, minRadius) * 1.25;
      ring.circle(creatures[o]!, creatures[o + 1]!, radius);
      anyDefended = true;
    }
    if (anyDefended) ring.stroke({ color: DEFENSE_COLOR, alpha: 0.8, pixelLine: true });

    // A wider, fainter ring around each creature that is calling.
    let anyCalling = false;
    for (let i = 0; i < population; i++) {
      const o = i * CREATURE_STRIDE;
      if (creatures[o + 9]! === 0) continue;
      const radius = Math.max(creatures[o + 4]!, minRadius) * 2.2;
      ring.circle(creatures[o]!, creatures[o + 1]!, radius);
      anyCalling = true;
    }
    if (anyCalling) ring.stroke({ color: CALL_COLOR, alpha: 0.55, pixelLine: true });
    if (snapshot.selected) {
      const o = snapshot.selected.index * CREATURE_STRIDE;
      const radius = Math.max(creatures[o + 4]!, minRadius) + 4 / this.camera.scale.x;
      ring.circle(creatures[o]!, creatures[o + 1]!, radius).stroke({ color: SELECTION_COLOR, pixelLine: true });
    }
  }

  /** Pick up a tool, or put it down with null. */
  setTool(tool: ToolKind | null): void {
    this.tool = tool;
    this.toolCursor.clear();
  }

  /** Outline the area the tool in hand would affect at a world position. */
  private drawToolCursor(x: number, y: number): void {
    const config = this.lastSnapshot?.config;
    const cursor = this.toolCursor;
    cursor.clear();
    if (!config || !this.tool) return;
    const radius =
      this.tool === 'meteor'
        ? config.meteorRadius
        : this.tool === 'plague'
          ? config.plagueToolRadius
          : this.tool === 'wall' || this.tool === 'erase' || this.tool === 'fire'
            ? config.plantCellSize
            : config.brushRadius;
    cursor.circle(x, y, radius).stroke({ color: TOOL_COLORS[this.tool], pixelLine: true });
  }

  private attachCameraControls(canvas: HTMLCanvasElement): void {
    /** World position under a pointer event. */
    const worldPoint = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const zoom = this.camera.scale.x;
      return {
        x: (event.clientX - rect.left - this.camera.position.x) / zoom,
        y: (event.clientY - rect.top - this.camera.position.y) / zoom,
      };
    };

    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.pressPoint = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      if (this.tool) {
        const point = worldPoint(event);
        this.lastToolPoint = point;
        this.onTool?.(this.tool, point.x, point.y, point.x, point.y);
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.tool) {
        // With a tool in hand, a drag applies the tool instead of moving the camera.
        const point = worldPoint(event);
        this.drawToolCursor(point.x, point.y);
        if (this.dragging && DRAG_TOOLS.has(this.tool)) {
          this.onTool?.(this.tool, point.x, point.y, this.lastToolPoint.x, this.lastToolPoint.y);
          this.lastToolPoint = point;
        }
        return;
      }
      if (!this.dragging) return;
      this.camera.position.x += event.clientX - this.lastPointer.x;
      this.camera.position.y += event.clientY - this.lastPointer.y;
      if (Math.hypot(event.clientX - this.pressPoint.x, event.clientY - this.pressPoint.y) > CLICK_SLOP) {
        this.cameraMoved = true;
      }
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    const endDrag = (event: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', (event) => {
      endDrag(event);
      if (this.tool) return;
      const moved = Math.hypot(event.clientX - this.pressPoint.x, event.clientY - this.pressPoint.y);
      if (moved > CLICK_SLOP) return;
      const point = worldPoint(event);
      this.onPick?.(point.x, point.y, PICK_RADIUS / this.camera.scale.x);
    });
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => this.toolCursor.clear());

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.cameraMoved = true;
        const rect = canvas.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const oldZoom = this.camera.scale.x;
        const factor = Math.exp(-event.deltaY * ZOOM_PER_WHEEL_PIXEL);
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
        // Keep the world point under the cursor fixed while zooming.
        const worldX = (px - this.camera.position.x) / oldZoom;
        const worldY = (py - this.camera.position.y) / oldZoom;
        this.camera.scale.set(zoom);
        this.camera.position.set(px - worldX * zoom, py - worldY * zoom);
        this.onZoomChanged();
      },
      { passive: false },
    );
  }
}
