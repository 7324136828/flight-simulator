import { approachStart, runwayStart, step } from './flight-model.js';
import { createUI, updateUI, showToast } from './ui.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createFlightAudio } from './audio.js';
import { loadManifest, loadMap, drawMinimap } from './scenery.js';
import { interpolateFlightState } from './render-stability.js';

const canvas = document.querySelector('#scene');
let state = approachStart();
let intro = true;
let paused = false;
let view = 'cockpit';
let mode = 'approach';
let lighting = 'day';
let sound = false;
let input;
let accumulator = 0;
let simulationTime = 0;
let world;
let catalog, map, selectedRunway, mapLoading = false;

try {
  catalog = await loadManifest();
  const entry = catalog.maps.find(entry => entry.id === new URLSearchParams(location.search).get('map')) || catalog.maps.find(entry => entry.id === catalog.defaultMap);
  map = await loadMap(entry);
  selectedRunway = map.runways.find(r => r.id === map.defaultRunway);
  state = approachStart(selectedRunway);
  world = createWorld(canvas, map, selectedRunway);
} catch (error) {
  console.error('Could not start the Three.js renderer', error);
  const panel = document.querySelector('#no-webgl');
  panel.textContent = `The game could not start: ${error.message}. Check that maps/ is served alongside the game and WebGL 2 is enabled, then reload.`;
  panel.classList.add('visible');
  throw error;
}

const audio = createFlightAudio();
const previousState = { ...state };
const renderState = { ...state };
const settings = () => ({ intro, paused, view, mode, lighting, sound, map, selectedRunway, mapLoading });
const active = () => !mapLoading && !intro && !paused && !document.hidden && !ui.helpOpen && !ui.assetsOpen &&
  !state.crashed && !(state.landed && !ui.dismissedLanding);

function start(nextMode) {
  mode = nextMode;
  if (mapLoading) return;
  state = mode === 'runway' ? runwayStart(selectedRunway) : approachStart(selectedRunway);
  intro = false;
  paused = false;
  accumulator = 0;
  simulationTime = 0;
  Object.assign(previousState, state);
  input?.reset();
  ui.helpOpen = ui.assetsOpen = false;
  ui.elements.help.hidden = ui.elements.assets.hidden = true;
  ui.dismissedLanding = ui.wasLanded = false;
  canvas.focus({ preventScroll: true });
  showToast(ui, mode === 'runway' ? 'Add full throttle, then pitch up at 53 knots' : 'Final approach · keep the wings level');
}

function action(name) {
  switch (name) {
    case 'start': if (intro) start('approach'); break;
    case 'restart': start('approach'); break;
    case 'runway': start('runway'); break;
    case 'pause': if (!intro && !state.crashed) paused = !paused; break;
    case 'view':
      view = view === 'cockpit' ? 'external' : 'cockpit';
      showToast(ui, view === 'cockpit' ? 'Cockpit view' : 'Chase view');
      break;
    case 'gear':
      if (active()) {
        state.gear = !state.gear;
        showToast(ui, `Landing gear ${state.gear ? 'down' : 'up'}`);
      }
      break;
    case 'flaps':
      if (active()) {
        state.flaps = !state.flaps;
        showToast(ui, `Flaps ${state.flaps ? 'extended' : 'retracted'}`);
      }
      break;
    case 'lighting':
      lighting = lighting === 'day' ? 'sunset' : 'day';
      world.setLighting(lighting);
      showToast(ui, lighting === 'day' ? 'Clear daylight' : 'Golden-hour flight');
      break;
    case 'sound':
      void audio.toggle().then(enabled => {
        sound = enabled;
        showToast(ui, sound ? 'Engine sound on' : 'Engine sound off');
        updateUI(ui, state, settings());
      }).catch(error => { console.warn('Audio could not start', error); showToast(ui, 'Audio is unavailable in this browser'); });
      break;
    case 'help':
    case 'assets': ui.root.querySelector(`[data-action="${name}"]`).click(); return;
    case 'escape':
      if (ui.helpOpen) ui.root.querySelector('[data-action="close-help"]').click();
      else if (ui.assetsOpen) ui.root.querySelector('[data-action="close-assets"]').click();
      else if (!intro && !state.crashed) paused = !paused;
      break;
    default: break;
  }
  input?.reset();
  updateUI(ui, state, settings());
}

const ui = createUI(document.querySelector('#ui'), {
  onAction(name) {
    if (name === 'help' || name === 'assets') { input?.reset(); return; }
    action(name);
  },
  onThrottle(value) { if (active()) state.throttle = value; },
  onMapChange(id) { void changeMap(id); },
  onRunwayChange(id) { changeRunway(id); },
});
for (const entry of catalog.maps) ui.elements.mapSelect.add(new Option(entry.label, entry.id));
function updateMapControls() {
  ui.elements.mapSelect.value = map.id;
  ui.elements.runwaySelect.replaceChildren(...map.runways.map(r => new Option(r.name, r.id)));
  ui.elements.runwaySelect.value = selectedRunway.id;
  ui.minimap = drawMinimap(ui.elements.mapCanvas, map, selectedRunway);
  ui.elements.mapSummary.textContent = `${selectedRunway.length.toFixed(0)} × ${selectedRunway.width.toFixed(0)} m · ${map.runways.length} runways`;
}
function applyScenery(nextMap, nextRunway) {
  world.setScenery(nextMap, nextRunway);
  map = nextMap; selectedRunway = nextRunway;
  updateMapControls();
  const wasIntro = intro;
  start(mode);
  intro = wasIntro;
  updateUI(ui, state, settings());
}
async function changeMap(id) {
  if (mapLoading || id === map.id) return;
  const entry = catalog.maps.find(entry => entry.id === id);
  if (!entry) return;
  mapLoading = true; input?.reset(); updateUI(ui,state,settings());
  try {
    const next = await loadMap(entry);
    mapLoading = false;
    applyScenery(next, next.runways.find(r => r.id === next.defaultRunway));
    showToast(ui, `${next.label} · original scenery loaded`);
  } catch (error) {
    console.error('Scenery load failed',error);
    showToast(ui, `Map could not load: ${error.message}`,5000);
    ui.elements.mapSelect.value = map.id;
  } finally { mapLoading = false; updateUI(ui,state,settings()); }
}
function changeRunway(id) {
  if (mapLoading) return;
  const next = map.runways.find(r => r.id === id);
  if (next) applyScenery(map,next);
}
updateMapControls();
input = createInput({ pad: ui.elements.yoke, root: ui.root, onAction: action });
updateUI(ui, state, settings());
window.addEventListener('resize', world.resize);
window.addEventListener('blur', () => {
  if (!intro && !state.crashed) paused = true;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !intro && !state.crashed) paused = true;
});

const fixedStep = 1 / 60;
let lastTime = performance.now();
let lastUiTime = 0;
function frame(now) {
  const elapsed = Math.min(Math.max((now - lastTime) / 1000, 0), 0.25);
  lastTime = now;
  if (active()) {
    accumulator = Math.min(accumulator + elapsed, fixedStep * 15);
    const controls = input.read();
    while (accumulator >= fixedStep && active()) {
      Object.assign(previousState, state);
      step(state, controls, fixedStep);
      simulationTime += fixedStep;
      accumulator -= fixedStep;
    }
  } else {
    accumulator = 0;
    Object.assign(previousState, state);
  }
  audio.update(state, active());
  const flying = active();
  const fraction = flying ? accumulator / fixedStep : 1;
  interpolateFlightState(previousState, state, fraction, renderState);
  const renderTime = flying ? Math.max(0, simulationTime - fixedStep + accumulator) : simulationTime;
  world.update(renderState, { view, time: intro ? now / 1000 : renderTime, elapsed: flying || intro ? elapsed : 0, intro });
  if (now - lastUiTime > 66) {
    updateUI(ui, state, settings());
    lastUiTime = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
