import { Application, Container, Graphics } from 'pixi.js';

const BACKGROUND_COLOR = 0x0b0f14;
const WORLD_COLOR = 0x121a22;
const GRID_COLOR = 0x1e2a36;
const BORDER_COLOR = 0x4a6072;
const GRID_SPACING = 100;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;
/** Fraction of the view the world fills when fitted. */
const FIT_MARGIN = 0.9;

/** Draws the world onto a PixiJS canvas and handles the pan/zoom camera. */
export class WorldRenderer {
  private app = new Application();
  private camera = new Container();
  private ground = new Graphics();
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
    this.camera.addChild(this.ground);
    this.app.stage.addChild(this.camera);
    this.attachCameraControls(this.app.canvas);
    // Keep the world fitted through window resizes until the user moves the camera.
    this.app.renderer.on('resize', () => {
      if (!this.cameraMoved) this.applyFit();
    });
  }

  /** Set the world size; redraws the ground and fits it to the view. */
  setWorldSize(width: number, height: number): void {
    if (width === this.worldWidth && height === this.worldHeight) return;
    this.worldWidth = width;
    this.worldHeight = height;
    this.drawGround();
    this.fitToView();
  }

  fitToView(): void {
    this.cameraMoved = false;
    // The canvas only tracks its host on the next frame; size it now.
    this.app.resize();
    this.applyFit();
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

  destroy(): void {
    this.app.destroy(true, { children: true });
  }

  private drawGround(): void {
    const g = this.ground;
    g.clear();
    g.rect(0, 0, this.worldWidth, this.worldHeight).fill(WORLD_COLOR);
    for (let x = GRID_SPACING; x < this.worldWidth; x += GRID_SPACING) {
      g.moveTo(x, 0).lineTo(x, this.worldHeight);
    }
    for (let y = GRID_SPACING; y < this.worldHeight; y += GRID_SPACING) {
      g.moveTo(0, y).lineTo(this.worldWidth, y);
    }
    g.stroke({ color: GRID_COLOR, pixelLine: true });
    g.rect(0, 0, this.worldWidth, this.worldHeight).stroke({ color: BORDER_COLOR, pixelLine: true });
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
