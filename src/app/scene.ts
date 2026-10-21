/**
 * Renderer, camera, lights, floor and orbit controls.
 *
 * Units are metres and +Y is up, matching WebXR, so the same scene works on a
 * monitor and in a headset. The floor sits at y = 0 and the default drawing
 * area floats at roughly chest height (y ≈ 1.2 m).
 *
 * The sky itself is a CSS gradient behind a transparent canvas: cheap,
 * smooth, and trivially themeable. (In VR there is no page behind the canvas,
 * so the XR module sets a solid scene background instead.)
 */
import {
  AmbientLight,
  CircleGeometry,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Theme } from './state';

export const DEFAULT_CAMERA_POS = new Vector3(0, 1.55, 3.2);
export const DEFAULT_TARGET = new Vector3(0, 1.2, 0);

export interface SceneContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  setTheme(theme: Theme): void;
  /** Move the camera along its view direction (used for Ctrl/pinch zoom). */
  dolly(amount: number): void;
  /** Call once per frame: lowers/raises render resolution to hold ~60 fps. */
  adaptResolution(dt: number): void;
}

/**
 * Adaptive resolution. On a slow GPU the cost of drawing is mostly
 * per-pixel, so rendering fewer pixels is the most effective way to hold the
 * frame rate. We average frame times over ~1 s and step the pixel ratio down
 * (never below 1, i.e. never blurrier than a standard screen) when frames are
 * slow, and back up when there is headroom. Hysteresis (different up/down
 * thresholds) stops it from flickering between two levels.
 */
class ResolutionGovernor {
  private readonly max = Math.min(window.devicePixelRatio || 1, 2);
  private ratio = this.max;
  private sum = 0;
  private frames = 0;

  constructor(private readonly renderer: WebGLRenderer) {
    renderer.setPixelRatio(this.ratio);
  }

  update(dt: number): void {
    // Ignore gaps from background tabs / throttled windows: they are not GPU load.
    if (dt <= 0 || dt > 0.1 || this.renderer.xr.isPresenting) return;
    this.sum += dt;
    this.frames++;
    if (this.sum < 1) return;
    const avgMs = (this.sum / this.frames) * 1000;
    this.sum = 0;
    this.frames = 0;
    let next = this.ratio;
    if (avgMs > 19) next = Math.max(1, this.ratio - 0.25);
    else if (avgMs < 13) next = Math.min(this.max, this.ratio + 0.25);
    if (next !== this.ratio) {
      this.ratio = next;
      this.renderer.setPixelRatio(next);
    }
  }
}

export function createScene(container: HTMLElement): SceneContext {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 0); // transparent: the CSS sky shows through
  container.appendChild(renderer.domElement);

  const scene = new Scene();

  const camera = new PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.01, 100);
  camera.position.copy(DEFAULT_CAMERA_POS);

  // Soft, shadowless lighting: a sky/ground hemisphere plus one key light
  // gives tubes a readable 3D shape without the cost of real shadows.
  scene.add(new HemisphereLight(0xffffff, 0x8899bb, 1.6));
  scene.add(new AmbientLight(0xffffff, 0.35));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 5, 3);
  scene.add(sun);

  // Floor: a soft disc plus a grid, both semi-transparent so they read as "ground"
  // without competing with the drawing.
  const floor = new Mesh(
    new CircleGeometry(6, 64),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  scene.add(floor);

  const grid = new GridHelper(12, 24, 0x4a6fa5, 0x4a6fa5);
  const gridMat = grid.material as LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  gridMat.depthWrite = false;
  grid.position.y = 0.001; // avoid z-fighting with the disc
  scene.add(grid);

  // Orbit camera: right-drag rotates, middle-drag pans. Left button is reserved
  // for drawing, and the scroll wheel is reserved for pushing the drawing plane,
  // so OrbitControls' own zoom is disabled (we provide Ctrl+scroll / pinch zoom).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(DEFAULT_TARGET);
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
  // Touch: one finger draws, two fingers orbit + zoom.
  controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
  controls.minDistance = 0.5;
  controls.maxDistance = 15;
  controls.maxPolarAngle = Math.PI * 0.495; // never orbit below the floor
  controls.update();

  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  const governor = new ResolutionGovernor(renderer);
  const tmp = new Vector3();
  return {
    renderer,
    scene,
    camera,
    controls,
    setTheme(theme) {
      const dark = theme === 'dark';
      gridMat.color.set(dark ? 0x9fb7ff : 0x4a6fa5);
      gridMat.opacity = dark ? 0.28 : 0.35;
      (floor.material as MeshBasicMaterial).color.set(dark ? 0x2a3566 : 0xffffff);
    },
    adaptResolution: (dt) => governor.update(dt),
    dolly(amount) {
      // Move camera towards/away from the orbit target, respecting min/max distance.
      tmp.subVectors(camera.position, controls.target);
      const dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, tmp.length() * (1 + amount)));
      tmp.setLength(dist);
      camera.position.copy(controls.target).add(tmp);
    },
  };
}
