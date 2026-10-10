import React, { useEffect, useRef, useState, useCallback } from 'react';
import { approachStart, runwayStart, step } from '../../simulator/flight-model.js';
import { createUI, destroyUI, updateUI, showToast } from '../../simulator/ui.js';
import { createWorld } from '../../simulator/world.js';
import { createInput } from '../../simulator/input.js';
import { createFlightAudio } from '../../simulator/audio.js';
import { loadManifest, loadMap, drawMinimap } from '../../simulator/scenery.js';
import { interpolateFlightState } from '../../simulator/render-stability.js';
import { saveFlight, FlightTelemetryPoint } from '../../services/api';

interface FlightSimulatorProps {
  onFlightSaved?: () => void;
}

export const FlightSimulator: React.FC<FlightSimulatorProps> = ({ onFlightSaved }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordedPointsCount, setRecordedPointsCount] = useState(0);
  const [savingLog, setSavingLog] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // References to keep track of engine state across animation frames
  const engineRef = useRef<{
    state: any;
    previousState: any;
    renderState: any;
    world: any;
    audio: any;
    input: any;
    ui: any;
    map: any;
    catalog: any;
    selectedRunway: any;
    mode: 'approach' | 'runway';
    intro: boolean;
    paused: boolean;
    view: 'cockpit' | 'external';
    lighting: 'day' | 'sunset';
    sound: boolean;
    mapLoading: boolean;
    telemetryBuffer: FlightTelemetryPoint[];
    maxSpeed: number;
    maxAlt: number;
    flightStartTime: number;
  }>({
    state: null,
    previousState: null,
    renderState: null,
    world: null,
    audio: null,
    input: null,
    ui: null,
    map: null,
    catalog: null,
    selectedRunway: null,
    mode: 'approach',
    intro: true,
    paused: false,
    view: 'cockpit',
    lighting: 'day',
    sound: false,
    mapLoading: false,
    telemetryBuffer: [],
    maxSpeed: 0,
    maxAlt: 0,
    flightStartTime: 0,
  });

  const handleSaveFlight = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng.state || !eng.selectedRunway || eng.telemetryBuffer.length === 0) {
      if (eng.ui) showToast(eng.ui, 'No telemetry recorded yet. Start flight first!');
      return;
    }

    setSavingLog(true);
    try {
      const flightDuration = Math.max(1, (performance.now() - eng.flightStartTime) / 1000);
      const isLanded = eng.state.landed;
      const isCrashed = eng.state.crashed;

      let stars = 3;
      if (isLanded) {
        const sinkRate = Math.abs(eng.state.vertical_speed || 0) * 196.85;
        if (sinkRate < 150) stars = 5;
        else if (sinkRate < 300) stars = 4;
        else stars = 3;
      } else if (isCrashed) {
        stars = 1;
      }

      await saveFlight({
        map_id: eng.map?.id || 'chicago',
        map_label: eng.map?.label || 'Chicago · Meigs Field',
        runway_id: eng.selectedRunway?.id || '',
        runway_heading: eng.selectedRunway?.heading || 0,
        duration_seconds: flightDuration,
        max_speed_knots: eng.maxSpeed,
        max_altitude_feet: eng.maxAlt,
        landing_status: isCrashed ? 'crashed' : isLanded ? 'landed' : 'in_flight',
        touchdown_vertical_speed_fpm: isLanded ? -(Math.abs(eng.state.vertical_speed || 0) * 196.85) : null,
        centerline_offset_feet: eng.state.x ? Math.abs(eng.state.x * 3.28084) : 0,
        rating_stars: stars,
        telemetry: eng.telemetryBuffer,
      });

      setSavedSuccess(true);
      if (eng.ui) showToast(eng.ui, 'Flight successfully recorded in Logbook!');
      if (onFlightSaved) onFlightSaved();
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (e: any) {
      console.error('Failed to save flight record', e);
      if (eng.ui) showToast(eng.ui, `Save failed: ${e.message}`);
    } finally {
      setSavingLog(false);
    }
  }, [onFlightSaved]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const uiContainer = uiRef.current;
    if (!canvas || !uiContainer) return;

    let destroyed = false;
    const eng = engineRef.current;
    let rafId: number | null = null;
    const disposers: (() => void)[] = [];

    function disposeSimulator() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      for (const dispose of disposers.splice(0).reverse()) dispose();
    }

    async function initSimulator() {
      try {
        setLoading(true);
        const catalog = await loadManifest();
        // StrictMode and tab navigation can clean up this effect while maps load.
        if (destroyed) return;
        const defaultEntry =
          catalog.maps.find((e: any) => e.id === catalog.defaultMap) || catalog.maps[0];
        const map = await loadMap(defaultEntry);
        if (destroyed) return;
        const selectedRunway = map.runways.find((r: any) => r.id === map.defaultRunway) || map.runways[0];

        const state = approachStart(selectedRunway);
        const previousState = { ...state };
        const renderState = { ...state };
        const world = createWorld(canvas, map, selectedRunway);
        disposers.push(() => world.destroy());
        const audio = createFlightAudio();
        disposers.push(() => audio.destroy());

        eng.state = state;
        eng.previousState = previousState;
        eng.renderState = renderState;
        eng.world = world;
        eng.audio = audio;
        eng.map = map;
        eng.catalog = catalog;
        eng.selectedRunway = selectedRunway;
        eng.flightStartTime = performance.now();

        const settings = () => ({
          intro: eng.intro,
          paused: eng.paused,
          view: eng.view,
          mode: eng.mode,
          lighting: eng.lighting,
          sound: eng.sound,
          map: eng.map,
          selectedRunway: eng.selectedRunway,
          mapLoading: eng.mapLoading,
        });

        const active = () =>
          !eng.mapLoading &&
          !eng.intro &&
          !eng.paused &&
          !document.hidden &&
          !ui.helpOpen &&
          !ui.assetsOpen &&
          !eng.state.crashed &&
          !(eng.state.landed && !ui.dismissedLanding);

        function startMode(nextMode: 'approach' | 'runway') {
          eng.mode = nextMode;
          if (eng.mapLoading) return;
          eng.state =
            eng.mode === 'runway'
              ? runwayStart(eng.selectedRunway)
              : approachStart(eng.selectedRunway);
          eng.intro = false;
          eng.paused = false;
          eng.flightStartTime = performance.now();
          eng.telemetryBuffer = [];
          eng.maxSpeed = 0;
          eng.maxAlt = 0;
          Object.assign(eng.previousState, eng.state);
          eng.input?.reset();
          ui.helpOpen = ui.assetsOpen = false;
          ui.elements.help.hidden = ui.elements.assets.hidden = true;
          ui.dismissedLanding = ui.wasLanded = false;
          canvas?.focus({ preventScroll: true });
          showToast(
            ui,
            eng.mode === 'runway'
              ? 'Add full throttle, then pitch up at 53 knots'
              : 'Final approach · keep the wings level'
          );
        }

        function action(name: string) {
          switch (name) {
            case 'start':
              if (eng.intro) startMode('approach');
              break;
            case 'restart':
              startMode('approach');
              break;
            case 'runway':
              startMode('runway');
              break;
            case 'pause':
              if (!eng.intro && !eng.state.crashed) eng.paused = !eng.paused;
              break;
            case 'view':
              eng.view = eng.view === 'cockpit' ? 'external' : 'cockpit';
              showToast(ui, eng.view === 'cockpit' ? 'Cockpit view' : 'Chase view');
              break;
            case 'gear':
              if (active()) {
                eng.state.gear = !eng.state.gear;
                showToast(ui, `Landing gear ${eng.state.gear ? 'down' : 'up'}`);
              }
              break;
            case 'flaps':
              if (active()) {
                eng.state.flaps = !eng.state.flaps;
                showToast(ui, `Flaps ${eng.state.flaps ? 'extended' : 'retracted'}`);
              }
              break;
            case 'lighting':
              eng.lighting = eng.lighting === 'day' ? 'sunset' : 'day';
              world.setLighting(eng.lighting);
              showToast(ui, eng.lighting === 'day' ? 'Clear daylight' : 'Golden-hour flight');
              break;
            case 'sound':
              void audio
                .toggle()
                .then((enabled: boolean) => {
                  if (destroyed) return;
                  eng.sound = enabled;
                  showToast(ui, eng.sound ? 'Engine sound on' : 'Engine sound off');
                  updateUI(ui, eng.state, settings());
                })
                .catch((error: any) => {
                  if (destroyed) return;
                  console.warn('Audio error', error);
                  showToast(ui, 'Audio unavailable in this browser');
                });
              break;
            case 'help':
            case 'assets':
              ui.root.querySelector(`[data-action="${name}"]`)?.click();
              return;
            case 'escape':
              if (ui.helpOpen) ui.root.querySelector('[data-action="close-help"]')?.click();
              else if (ui.assetsOpen) ui.root.querySelector('[data-action="close-assets"]')?.click();
              else if (!eng.intro && !eng.state.crashed) eng.paused = !eng.paused;
              break;
            default:
              break;
          }
          eng.input?.reset();
          updateUI(ui, eng.state, settings());
        }

        const ui = createUI(uiContainer, {
          onAction(name: string) {
            if (name === 'help' || name === 'assets') {
              eng.input?.reset();
              return;
            }
            action(name);
          },
          onThrottle(value: number) {
            if (active()) eng.state.throttle = value;
          },
          onMapChange(id: string) {
            void changeMap(id);
          },
          onRunwayChange(id: string) {
            changeRunway(id);
          },
        });
        disposers.push(() => destroyUI(ui));
        eng.ui = ui;

        for (const entry of catalog.maps) {
          ui.elements.mapSelect.add(new Option(entry.label, entry.id));
        }

        function updateMapControls() {
          ui.elements.mapSelect.value = eng.map.id;
          ui.elements.runwaySelect.replaceChildren(
            ...eng.map.runways.map((r: any) => new Option(r.name, r.id))
          );
          ui.elements.runwaySelect.value = eng.selectedRunway.id;
          ui.minimap = drawMinimap(ui.elements.mapCanvas, eng.map, eng.selectedRunway);
          ui.elements.mapSummary.textContent = `${eng.selectedRunway.length.toFixed(0)} × ${eng.selectedRunway.width.toFixed(0)} m · ${eng.map.runways.length} runways`;
        }

        function applyScenery(nextMap: any, nextRunway: any) {
          world.setScenery(nextMap, nextRunway);
          eng.map = nextMap;
          eng.selectedRunway = nextRunway;
          updateMapControls();
          const wasIntro = eng.intro;
          startMode(eng.mode);
          eng.intro = wasIntro;
          updateUI(ui, eng.state, settings());
        }

        async function changeMap(id: string) {
          if (eng.mapLoading || id === eng.map.id) return;
          const entry = catalog.maps.find((e: any) => e.id === id);
          if (!entry) return;
          eng.mapLoading = true;
          eng.input?.reset();
          updateUI(ui, eng.state, settings());
          try {
            const next = await loadMap(entry);
            if (destroyed) return;
            eng.mapLoading = false;
            applyScenery(next, next.runways.find((r: any) => r.id === next.defaultRunway) || next.runways[0]);
            showToast(ui, `${next.label} · scenery loaded`);
          } catch (error: any) {
            if (destroyed) return;
            console.error('Scenery load failed', error);
            showToast(ui, `Map could not load: ${error.message}`, 5000);
            ui.elements.mapSelect.value = eng.map.id;
          } finally {
            if (!destroyed) {
              eng.mapLoading = false;
              updateUI(ui, eng.state, settings());
            }
          }
        }

        function changeRunway(id: string) {
          if (eng.mapLoading) return;
          const next = eng.map.runways.find((r: any) => r.id === id);
          if (next) applyScenery(eng.map, next);
        }

        updateMapControls();
        const input = createInput({ pad: ui.elements.yoke, root: ui.root, onAction: action });
        disposers.push(() => input.destroy());
        eng.input = input;
        updateUI(ui, eng.state, settings());

        // Physics & Animation Loop
        const fixedStep = 1 / 60;
        let lastTime = performance.now();
        let lastUiTime = 0;
        let lastTelemetryTime = 0;
        let accumulator = 0;
        let simulationTime = 0;

        function frame(now: number) {
          if (destroyed) return;
          const elapsed = Math.min(Math.max((now - lastTime) / 1000, 0), 0.25);
          lastTime = now;

          if (active()) {
            accumulator = Math.min(accumulator + elapsed, fixedStep * 15);
            const controls = input.read();
            while (accumulator >= fixedStep && active()) {
              Object.assign(eng.previousState, eng.state);
              step(eng.state, controls, fixedStep);
              simulationTime += fixedStep;
              accumulator -= fixedStep;
            }

            // Record telemetry
            if (now - lastTelemetryTime > 500) {
              const spd = (eng.state.airspeed || 0) * 1.94384;
              const alt = (eng.state.y || 0) * 3.28084;
              eng.maxSpeed = Math.max(eng.maxSpeed, spd);
              eng.maxAlt = Math.max(eng.maxAlt, alt);

              eng.telemetryBuffer.push({
                time: Number(((now - eng.flightStartTime) / 1000).toFixed(1)),
                x: Number((eng.state.x || 0).toFixed(1)),
                y: Number((eng.state.y || 0).toFixed(1)),
                z: Number((eng.state.z || 0).toFixed(1)),
                pitch: Number(((eng.state.pitch || 0) * (180 / Math.PI)).toFixed(1)),
                roll: Number(((eng.state.roll || 0) * (180 / Math.PI)).toFixed(1)),
                heading: Number(((eng.state.yaw || 0) * (180 / Math.PI)).toFixed(1)),
                airspeed_knots: Number(spd.toFixed(1)),
                altitude_feet: Number(alt.toFixed(1)),
                vertical_speed_fpm: Number(((eng.state.vertical_speed || 0) * 196.85).toFixed(1)),
                throttle: Number((eng.state.throttle || 0).toFixed(2)),
                gear: Boolean(eng.state.gear),
                flaps: Boolean(eng.state.flaps),
              });
              setRecordedPointsCount(eng.telemetryBuffer.length);
              lastTelemetryTime = now;
            }
          } else {
            accumulator = 0;
            Object.assign(eng.previousState, eng.state);
          }

          audio.update(eng.state, active());
          const flying = active();
          const fraction = flying ? accumulator / fixedStep : 1;
          interpolateFlightState(eng.previousState, eng.state, fraction, eng.renderState);
          const renderTime = flying
            ? Math.max(0, simulationTime - fixedStep + accumulator)
            : simulationTime;
          world.update(eng.renderState, {
            view: eng.view,
            time: eng.intro ? now / 1000 : renderTime,
            elapsed: flying || eng.intro ? elapsed : 0,
            intro: eng.intro,
          });

          if (now - lastUiTime > 66) {
            updateUI(ui, eng.state, settings());
            lastUiTime = now;
          }

          rafId = requestAnimationFrame(frame);
        }

        rafId = requestAnimationFrame(frame);
        setLoading(false);
      } catch (err: any) {
        if (destroyed) return;
        disposeSimulator();
        console.error('Flight simulator initialization error', err);
        setErrorMessage(err.message || 'Failed to initialize 3D WebGL Flight Simulator');
        setLoading(false);
      }
    }

    initSimulator();

    return () => {
      destroyed = true;
      disposeSimulator();
    };
  }, []);

  return (
    <div className="flight-simulator-viewport">
      <canvas
        ref={canvasRef}
        id="scene"
        tabIndex={0}
        aria-label="Three-dimensional flight view. Use arrow keys to fly, W and S for throttle."
      />

      <div ref={uiRef} id="ui" />

      {/* Floating Production Flight Recorder HUD */}
      <div className="flight-recorder-hud">
        <div className="recorder-status">
          <span className="rec-dot" />
          <span className="rec-text">BLACKBOX RECORDER</span>
          <span className="rec-count">{recordedPointsCount} pts</span>
        </div>
        <button
          className={`btn-save-logbook ${savedSuccess ? 'is-saved' : ''}`}
          onClick={handleSaveFlight}
          disabled={savingLog || recordedPointsCount === 0}
        >
          {savingLog ? 'Saving...' : savedSuccess ? '✓ Saved to Logbook!' : 'Save Flight to Logbook'}
        </button>
      </div>

      {loading && (
        <div className="fs-loading-screen">
          <div className="fs-loading-spinner" />
          <h2>Initializing Flight Simulator...</h2>
          <p>Loading 3D airfields, runways, and flight dynamics</p>
        </div>
      )}

      {errorMessage && (
        <div className="fs-error-screen" role="alert">
          <h2>Could Not Start Simulator</h2>
          <p>{errorMessage}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>
            Reload Simulator
          </button>
        </div>
      )}
    </div>
  );
};
