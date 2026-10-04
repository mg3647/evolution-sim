import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
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
/** Creature tint when starving and when full. */
const HUNGRY_COLOR = [150, 70, 60] as const;
const FED_COLOR = [255, 214, 130] as const;
const CREATURE_TEXTURE_SIZE = 64;

function lerpColor(from: readonly number[], to: readonly number[], t: number): number {
  const r = from[0]! + (to[0]! - from[0]!) * t;
  const g = from[1]! + (to[1]! - from[1]!) * t;
  const b = from[2]! + (to[2]! - from[2]!) * t;
  return (r << 16) | (g << 8) | b;
}

/** A white disc with a dark spot at the front, tinted per creature. */
function createCreatureTexture(): Texture {
  const size = CREATURE_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#202020';
  ctx.beginPath();
  ctx.arc(size * 0.78, size / 2, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}

/** Draws the world onto a PixiJS canvas and handles the pan/zoom camera. */
export class WorldRenderer {
  private app = new Application();
  private camera = new Container();
  private plantSprite = new Sprite();
  private overlay = new Graphics();
  private creatureLayer = new Container();
  private creatureSprites: Sprite[] = [];
  private creatureTexture = Texture.EMPTY;
  private plantCanvas = document.createElement('canvas');
  private plantImage: ImageData | null = null;
  private hostObserver: ResizeObserver | null = null;
  private worldWidth = 0;
  private worldHeight = 0;
  private dragging = false;
  private cameraMoved = false;
  private lastPointer = { x: 0, y: 0 };

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: BACKGROUND_COLOR,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(this.app.canvas);
    this.creatureTexture = createCreatureTexture();
    this.camera.addChild(this.plantSprite, this.overlay, this.creatureLayer);
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
    this.setWorldSize(snapshot.config.worldWidth, snapshot.config.worldHeight);
    this.drawPlants(snapshot);
    this.drawCreatures(snapshot);
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
    const { plantCols: cols, plantRows: rows, plants } = snapshot;
    const canvas = this.plantCanvas;
    const ctx = canvas.getContext('2d')!;
    if (!this.plantImage || canvas.width !== cols || canvas.height !== rows) {
      canvas.width = cols;
      canvas.height = rows;
      this.plantImage = ctx.createImageData(cols, rows);
      this.plantSprite.texture = Texture.from(canvas, true);
      this.plantSprite.texture.source.scaleMode = 'linear';
    }

    const pixels = this.plantImage.data;
    for (let i = 0; i < plants.length; i++) {
      const t = plants[i]! / 255;
      const o = i * 4;
      pixels[o] = SOIL_COLOR[0] + (PLANT_COLOR[0] - SOIL_COLOR[0]) * t;
      pixels[o + 1] = SOIL_COLOR[1] + (PLANT_COLOR[1] - SOIL_COLOR[1]) * t;
      pixels[o + 2] = SOIL_COLOR[2] + (PLANT_COLOR[2] - SOIL_COLOR[2]) * t;
      pixels[o + 3] = 255;
    }
    ctx.putImageData(this.plantImage, 0, 0);
    this.plantSprite.texture.source.update();
    this.plantSprite.setSize(this.worldWidth, this.worldHeight);
  }

  private drawCreatures(snapshot: Snapshot): void {
    const { creatures, population } = snapshot;
    const sprites = this.creatureSprites;
    const scale = (snapshot.config.creatureRadius * 2) / CREATURE_TEXTURE_SIZE;

    while (sprites.length < population) {
      const sprite = new Sprite(this.creatureTexture);
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
      sprite.scale.set(scale);
      sprite.tint = lerpColor(HUNGRY_COLOR, FED_COLOR, Math.min(1, creatures[o + 3]! * 2));
    }
  }

  private attachCameraControls(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.cameraMoved = true;
      this.camera.position.x += event.clientX - this.lastPointer.x;
      this.camera.position.y += event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    const endDrag = (event: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

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
      },
      { passive: false },
    );
  }
}
