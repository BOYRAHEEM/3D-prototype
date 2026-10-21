/**
 * SkyDoodle entry point: builds the scene, creates each module, connects them,
 * and runs the render loop.
 *
 * Data flow (desktop):
 *
 *   DesktopInput ──tip positions──▶ DrawingController ──strokes──▶ StrokeStore
 *        │                                │                              │
 *   DrawingPlane (ray target)       live preview mesh          SpatialIndex, StrokeShadows
 *                                         │                              │
 *                                         └──── tip ────▶ DepthGuides ◀──┘
 *
 *   Snapper filters tip positions (pull onto nearby endpoints);
 *   Beautifier inspects each finished stroke and may offer a clean shape.
 */
import './styles.css';
import { MeshLambertMaterial, Timer, Vector3 } from 'three';
import { AdaptiveHelper } from './adaptive/AdaptiveHelper';
import { MISS_MAX, computeStrokeMetrics, type StrokeMetrics } from './adaptive/metrics';
import { createScene } from './app/scene';
import { currentRadius, settings, type AssistToggles } from './app/state';
import { pathLength } from './beautify/fit';
import { randomStrokes } from './dev/stress';
import { DesktopInput } from './drawing/DesktopInput';
import { DrawingController, type StrokeEndInfo } from './drawing/DrawingController';
import { DrawingPlane } from './drawing/DrawingPlane';
import { exportGlb } from './drawing/exportGlb';
import { BRUSH_SIZE_ORDER, PALETTE } from './drawing/palette';
import { StrokeBatch } from './drawing/StrokeBatch';
import { StrokeStore } from './drawing/StrokeStore';
import { Beautifier } from './beautify/Beautifier';
import { DepthGuides } from './guides/DepthGuides';
import { SpatialIndex } from './guides/SpatialIndex';
import { StrokeShadows } from './guides/StrokeShadows';
import { Snapper } from './snapping/Snapper';
import { CONDITION_LABEL, InteractionLog } from './logging/InteractionLog';
import { StudyMode } from './study/StudyMode';
import type { Actions } from './ui/actions';
import { AdaptiveIndicator } from './ui/AdaptiveIndicator';
import { createAssistPanel, toggleAssist, type AssistPanelHandle } from './ui/AssistPanel';
import { fileStamp } from './ui/download';
import { FpsMeter } from './ui/FpsMeter';
import { createOnboarding } from './ui/Onboarding';
import { createResultsPage, type ResultsHandle } from './ui/ResultsPage';
import { buildShortcuts, createHelpPanel, installShortcuts } from './ui/shortcuts';
import { createStudyPanel, type StudyPanelHandle } from './ui/StudyPanel';
import { mirrorToasts, toast } from './ui/toast';
import { createToolbar, toolButton } from './ui/Toolbar';
import { SkyDome } from './xr/SkyDome';
import { VRMode } from './xr/VRMode';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const ui = document.getElementById('ui')!;

// --- 3D core -------------------------------------------------------------------
const ctx = createScene(stage);
const plane = new DrawingPlane();
ctx.scene.add(plane.object);

// The store's group holds one Mesh per stroke. It is *not* added to the
// scene: it is the clean export root for .glb. What the user sees is the
// batched copy below, which draws all strokes in a single draw call.
const store = new StrokeStore();
// Lambert shading looks almost the same as PBR under our soft lights but is
// ~20% cheaper per pixel, which matters on integrated GPUs and headsets.
const strokeBatch = new StrokeBatch(new MeshLambertMaterial(), 'strokes');
ctx.scene.add(strokeBatch.mesh);

const drawing = new DrawingController(ctx.scene, store);
const input = new DesktopInput(ctx, plane, drawing);

// --- assistance: depth guides ------------------------------------------------------
const index = new SpatialIndex();
const shadows = new StrokeShadows();
const guides = new DepthGuides(index);
ctx.scene.add(shadows.object, guides.object);

// Keep the rendered batch, spatial index and floor shadows in sync with the strokes.
store.onChange((changes) => {
  for (const { kind, stroke } of changes) {
    if (kind === 'add') {
      strokeBatch.add(stroke.id, stroke.mesh.geometry, stroke.color);
      index.insert(stroke.id, stroke.points);
    } else {
      strokeBatch.remove(stroke.id);
      index.remove(stroke.id);
    }
  }
  shadows.apply(changes);
});

// --- assistance: snapping + beautification -------------------------------------------
const snapper = new Snapper(store, drawing);
ctx.scene.add(snapper.object);
const beautifier = new Beautifier(ctx.scene, store, strokeBatch, ctx.camera, ui);

// Starting a new stroke quietly keeps the original of any pending offer;
// finishing a stroke checks whether it is close to a clean shape.
drawing.events.on('strokeStart', () => beautifier.dismiss());

// --- assistance: adaptive help ---------------------------------------------------------
const adaptive = new AdaptiveHelper();
let indicator: AdaptiveIndicator;

const viewCamera = () => (ctx.renderer.xr.isPresenting ? ctx.renderer.xr.getCamera() : ctx.camera);

/** Measure a finished stroke (used by adaptive help now, and logging in Step 5). */
function measure(info: StrokeEndInfo): StrokeMetrics {
  const pts = info.stroke.points;
  const gap = (p: Vector3, which: 'start' | 'end') => {
    let best = snapper.nearestEndpoint(p, MISS_MAX, false, info.stroke.id)?.distance ?? null;
    // The end of a long stroke may also be trying to close onto its own start.
    if (which === 'end' && pathLength(pts) > 0.3) {
      const own = p.distanceTo(pts[0]);
      if (own < MISS_MAX && (best === null || own < best)) best = own;
    }
    return best;
  };
  return computeStrokeMetrics({
    points: pts,
    durationMs: info.endTime - info.startTime,
    endGaps: [gap(pts[0], 'start'), pts.length > 1 ? gap(pts[pts.length - 1], 'end') : null],
    brushRadius: info.stroke.radius,
    // In VR the viewer is the headset, not the desktop camera.
    eye: viewCamera().getWorldPosition(new Vector3()),
    viewDir: viewCamera().getWorldDirection(new Vector3()),
  });
}

// --- logging + study mode ------------------------------------------------------------------
const log = new InteractionLog();
const study = new StudyMode(log, store, ctx.scene, snapper);

drawing.events.on('strokeEnd', (info) => {
  const metrics = measure(info);
  // Log with the helpers that were in effect *while* this stroke was drawn.
  log.logStroke({
    strokeId: info.stroke.id,
    metrics,
    snaps: { ...snapper.strokeSnaps },
    assist: effectiveAssist(),
    inputMode: vr.presenting ? 'vr' : 'desktop',
  });
  if (effectiveAssist().adaptive) {
    const changes = adaptive.record(metrics);
    if (changes.length) {
      if (study.trial) study.trial.smartHelpChanges += changes.length;
      applyAssist({ adaptiveFade: true });
      indicator.report(changes, adaptive.state);
      vr.showMessage(changes.map((c) => c.reason).join(' '), 7);
    }
  }
  beautifier.consider(info.stroke);
});

// --- VR mode (WebXR) -------------------------------------------------------------------
const skyDome = new SkyDome();
ctx.scene.add(skyDome.mesh);
const vr = new VRMode(ctx, {
  drawing,
  snapper,
  beautifier,
  get actions() {
    return actions;
  },
  onPresentingChange(presenting) {
    // In VR the drawing wall, mouse input and orbit camera are not used.
    plane.setVisible(!presenting);
    input.enabled = !presenting;
    ctx.controls.enabled = !presenting;
    skyDome.mesh.visible = presenting;
    drawing.setTip(null);
    document.body.classList.toggle('in-vr', presenting);
    vrButton.querySelector('.tool-label')!.textContent = presenting ? 'Exit VR' : 'VR';
  },
  trialText: () => studyUi.trialText(),
  finishTrial: () => studyUi.finish(true),
});
mirrorToasts((m) => vr.showMessage(m, 3));

beautifier.events.on('offered', ({ original, fit }) =>
  log.updateBeautify(original.id, { beautifyOffered: fit.kind, beautifyFitError: fit.error }),
);
beautifier.events.on('resolved', ({ offer, outcome }) => log.updateBeautify(offer.original.id, { beautifyOutcome: outcome }));


// --- panels ------------------------------------------------------------------------
let helpPanel: HTMLElement;
let assistPanel: HTMLElement;
let assistUi: AssistPanelHandle;
let studyUi: StudyPanelHandle;
let resultsUi: ResultsHandle;
const panels = () => [helpPanel, assistPanel, studyUi.panel, resultsUi.panel];

/** Show one panel (hiding the others), or hide it if it is already open. */
function togglePanel(panel: HTMLElement): void {
  const opening = panel.hidden;
  panels().forEach((p) => (p.hidden = true));
  panel.hidden = !opening;
  if (opening) panel.querySelector<HTMLElement>('button')?.focus();
}

// --- actions (shared by buttons + keyboard) ----------------------------------
const actions: Actions = {
  // Any pending "tidy shape" offer is closed first, so undo acts on what the user sees.
  undo: () => {
    beautifier.dismiss();
    if (study.trial && store.canUndo) study.trial.undoCount++;
    store.undo();
  },
  redo: () => {
    beautifier.dismiss();
    store.redo();
  },
  clear: () => {
    beautifier.dismiss();
    if (store.strokes.length === 0) return;
    store.clear();
    toast('Cleared! Press Undo to bring it back.');
  },
  exportGlb: async () => {
    if (store.strokes.length === 0) return toast('Draw something first!');
    try {
      await exportGlb(store.group, `skydoodle_${fileStamp()}.glb`);
      toast('Saved your 3D drawing as a .glb file');
    } catch (err) {
      console.error(err);
      toast('Sorry, saving failed.');
    }
  },
  toggleTheme: () => settings.set({ theme: settings.get().theme === 'dark' ? 'light' : 'dark' }),
  toggleHelp: () => togglePanel(helpPanel),
  toggleAssistPanel: () => togglePanel(assistPanel),
  openStudy: () => {
    if (study.trial) return toast('A study task is running. Use Done or Cancel at the top.');
    panels().forEach((p) => (p.hidden = true));
    studyUi.open();
  },
  toggleVR: async () => {
    if (vr.presenting) return vr.exit();
    if (!(await vr.checkSupport())) {
      toast('VR needs a headset. Open this page in the Meta Quest Browser and press VR.');
      return;
    }
    try {
      await vr.enter();
    } catch (err) {
      console.error(err);
      toast('Could not start VR. Is the headset awake?');
    }
  },
  openResults: () => {
    panels().forEach((p) => (p.hidden = true));
    resultsUi.open();
  },
  toggleAssist: (k) => {
    if (study.trial) {
      toast('Helpers are fixed during a study task.');
      return;
    }
    if (k !== 'adaptive' && settings.get().assist.adaptive) {
      toast('Smart help is choosing helpers right now. Turn it off (A) to choose yourself.');
      return;
    }
    toggleAssist(k);
  },
  setColorIndex: (i) => PALETTE[i] && settings.set({ color: PALETTE[i].hex }),
  cycleSize: (dir) => {
    const i = BRUSH_SIZE_ORDER.indexOf(settings.get().size);
    const next = BRUSH_SIZE_ORDER[Math.max(0, Math.min(BRUSH_SIZE_ORDER.length - 1, i + dir))];
    settings.set({ size: next });
  },
  planeRotate: (n) => plane.rotate(n),
  planeTilt: (n) => plane.tilt(n),
  planePush: (m) => plane.push(m, input.viewDirection()),
  planeToggleFlat: () => plane.toggleFlat(),
  planeFaceCamera: () => plane.faceDirection(input.viewDirection()),
  planeReset: () => plane.reset(),
};

// --- UI ------------------------------------------------------------------------
createToolbar(ui, actions, store);
const vrButton = toolButton('headset', 'VR', actions.toggleVR, { class: 'compact' });
vrButton.title = 'Draw in VR (needs a headset, e.g. Meta Quest Browser)';
vrButton.setAttribute('aria-label', 'Enter VR');
ui.querySelector('.top-right')!.prepend(vrButton);
void vr.checkSupport().then((ok) => vrButton.classList.toggle('vr-ready', ok));
const shortcuts = buildShortcuts(actions);
const onboarding = createOnboarding(ui);
helpPanel = createHelpPanel(ui, shortcuts, () => (helpPanel.hidden = true), () => {
  helpPanel.hidden = true;
  onboarding.open();
});
assistUi = createAssistPanel(ui, () => (assistPanel.hidden = true));
assistPanel = assistUi.panel;
indicator = new AdaptiveIndicator(ui);
studyUi = createStudyPanel(ui, study, log, {
  onClose: () => (studyUi.panel.hidden = true),
  beforeFinish: () => beautifier.dismiss(), // resolve any open offer so it is logged in this trial
});
resultsUi = createResultsPage(ui, log, () => (resultsUi.panel.hidden = true));

study.events.on('started', (t) => {
  // Smart help starts each trial from scratch, so trials are comparable.
  adaptive.reset();
  assistUi.setLocked(`Study task running (${CONDITION_LABEL[t.condition]}): helpers are fixed until it ends.`);
  indicator.setEnabled(t.condition === 'smart');
  applyAssist();
});
study.events.on('finished', (r) => {
  assistUi.setLocked(null);
  adaptive.reset();
  indicator.setEnabled(settings.get().assist.adaptive);
  applyAssist();
  toast(r.completed ? `Saved: ${r.participantId}, ${r.durationS.toFixed(0)} s, ${r.strokeCount} strokes` : 'Trial cancelled (kept in the log as not completed)');
});
installShortcuts(shortcuts);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') panels().forEach((p) => (p.hidden = true));
});
const fps = new FpsMeter(ui, ctx.renderer, params.has('debug') || params.has('stress'));

// --- settings → scene ------------------------------------------------------------
const applyTheme = () => {
  const dark = settings.get().theme === 'dark';
  document.documentElement.dataset.theme = settings.get().theme;
  ctx.setTheme(settings.get().theme);
  plane.setTheme(dark);
  guides.setTheme(dark);
  shadows.setTheme(dark);
  skyDome.setTheme(dark);
};
/**
 * The helpers actually in effect: the user's own switches, or (with Smart
 * help on) the adaptive helper's choices.
 */
function effectiveAssist(): AssistToggles {
  // During a study trial, the condition decides, whatever the user's own switches say.
  const condition = study.trial?.condition;
  if (condition === 'off') return { depthGuides: false, snapping: false, beautify: false, adaptive: false };
  if (condition === 'on') return { depthGuides: true, snapping: true, beautify: true, adaptive: false };
  const smart = condition === 'smart' || (!condition && settings.get().assist.adaptive);
  return smart ? { ...adaptive.state, adaptive: true } : settings.get().assist;
}

function applyAssist(opts: { adaptiveFade?: boolean } = {}): void {
  const a = effectiveAssist();
  // Adaptive changes fade in over ~0.8 s and out slowly over ~2.5 s.
  guides.setActive(a.depthGuides, opts.adaptiveFade ? (a.depthGuides ? 0.8 : 2.5) : 0.4);
  snapper.enabled = a.snapping;
  beautifier.enabled = a.beautify;
  if (!a.beautify) beautifier.dismiss();
  assistUi.render(a, a.adaptive);
}
settings.subscribe((s, prev) => {
  if (s.theme !== prev.theme) applyTheme();
  if (s.assist.adaptive !== prev.assist.adaptive) {
    // Smart help starts each session from "no helpers" and adds them only when needed.
    adaptive.reset();
    indicator.setEnabled(s.assist.adaptive);
  }
  if (s.assist !== prev.assist) applyAssist();
});
applyTheme();
applyAssist();
// The stress test is for performance checks, so skip the tour there.
if (!params.has('stress')) onboarding.maybeShowFirstTime();
if (settings.get().assist.adaptive) indicator.setEnabled(true);

// --- stress test (?stress=500) ------------------------------------------------------
const stressCount = Number(params.get('stress'));
if (stressCount > 0) {
  randomStrokes(Math.min(stressCount, 2000)).forEach((s) => store.add(s));
  toast(`Stress test: ${stressCount} strokes`);
}

// --- render loop -------------------------------------------------------------------
// setAnimationLoop (rather than requestAnimationFrame) is required for WebXR,
// so we use it from the start.
const timer = new Timer();
ctx.renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1); // clamp so a background tab doesn't cause a jump
  ctx.adaptResolution(dt);
  ctx.controls.update();
  vr.update(); // feeds controller positions into the drawing pipeline while in VR
  drawing.update();
  guides.update(drawing.tip, drawing.tipVisible, currentRadius(), dt);
  shadows.setIntensity(guides.intensity);
  snapper.update(dt, drawing.tipVisible);
  beautifier.update(dt, ctx.renderer.domElement);
  ctx.renderer.render(ctx.scene, ctx.camera);
  fps.tick(store.strokes.length);
});

// Handy for debugging in the browser console.
Object.assign(window, { skydoodle: { ctx, plane, store, strokeBatch, drawing, index, guides, snapper, beautifier, adaptive, measure, log, study, vr } });
