import { flightGuidance } from './navigation.js';

// The cockpit is an overlay. The Three.js scene remains visible through its
// transparent areas, and only actual controls intercept mouse/touch input.
const KNOTS_PER_METRE_SECOND = 1.94384449;
const FEET_PER_METRE = 3.2808399;
const FPM_PER_METRE_SECOND = 196.850394;
const RAD_TO_DEG = 180 / Math.PI;

let nextInstrumentId = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const degrees = (radians) => ((finite(radians) * RAD_TO_DEG % 360) + 360) % 360;
const rounded = (value) => Math.round(finite(value)).toLocaleString('en-US');

function polarPoint(angle, radius, center = 90) {
  const radians = (angle - 90) * Math.PI / 180;
  return [center + Math.cos(radians) * radius, center + Math.sin(radians) * radius];
}

function arcPath(startAngle, endAngle, radius) {
  const [x1, y1] = polarPoint(startAngle, radius);
  const [x2, y2] = polarPoint(endAngle, radius);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function dialTicks(labels, startAngle = -130, endAngle = 130) {
  const count = (labels.length - 1) * 4;
  let marks = '';
  for (let i = 0; i <= count; i += 1) {
    const angle = startAngle + i / count * (endAngle - startAngle);
    const major = i % 4 === 0;
    const [x1, y1] = polarPoint(angle, major ? 67 : 71);
    const [x2, y2] = polarPoint(angle, 77);
    marks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${major ? 'fs-tick-major' : 'fs-tick-minor'}"/>`;
    if (major) {
      const [tx, ty] = polarPoint(angle, 55);
      marks += `<text x="${tx.toFixed(2)}" y="${(ty + 3).toFixed(2)}" class="fs-dial-number">${labels[i / 4]}</text>`;
    }
  }
  return marks;
}

function dialCard({ name, label, unit, labels, start = -130, end = 130, accent = 'mint', range }) {
  const accentArc = range ? `<path d="${arcPath(start + range[0] * (end - start), start + range[1] * (end - start), 81)}" class="fs-range-arc"/>` : '';
  return `
    <div class="fs-instrument fs-instrument-${name}" data-gauge="${name}" role="group" aria-label="${label}">
      <div class="fs-instrument-heading"><span>${label}</span><span>${unit}</span></div>
      <svg class="fs-dial fs-dial-${accent}" viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r="82" class="fs-dial-rim"/>
        <circle cx="90" cy="90" r="78" class="fs-dial-face"/>
        <path d="${arcPath(start, end, 81)}" class="fs-dial-track"/>
        ${accentArc}
        ${dialTicks(labels, start, end)}
        <g data-needle="${name}">
          <path d="M 90 101 L 88 90 L 90 28 L 92 90 Z" class="fs-dial-needle"/>
          <circle cx="90" cy="90" r="5" class="fs-needle-pin"/>
        </g>
      </svg>
      <div class="fs-instrument-value"><strong data-value="${name}">--</strong><span>${unit}</span></div>
    </div>`;
}

function attitudeCard(id) {
  return `
    <div class="fs-instrument fs-attitude-card" data-gauge="attitude" role="group" aria-label="Attitude">
      <div class="fs-instrument-heading"><span>ATTITUDE</span><span>°</span></div>
      <svg class="fs-dial" viewBox="0 0 180 180" aria-hidden="true">
        <defs><clipPath id="fs-attitude-clip-${id}"><circle cx="90" cy="90" r="75"/></clipPath></defs>
        <circle cx="90" cy="90" r="82" class="fs-dial-rim"/>
        <g clip-path="url(#fs-attitude-clip-${id})">
          <g data-attitude-horizon>
            <rect x="-50" y="-90" width="280" height="180" class="fs-attitude-sky"/>
            <rect x="-50" y="90" width="280" height="180" class="fs-attitude-ground"/>
            <line x1="-60" y1="90" x2="240" y2="90" class="fs-attitude-horizon-line"/>
            <line x1="56" y1="66" x2="74" y2="66" class="fs-attitude-ladder"/>
            <line x1="106" y1="66" x2="124" y2="66" class="fs-attitude-ladder"/>
            <line x1="52" y1="114" x2="74" y2="114" class="fs-attitude-ladder"/>
            <line x1="106" y1="114" x2="128" y2="114" class="fs-attitude-ladder"/>
          </g>
          <path d="M 35 90 H 69 L 78 97 H 102 L 111 90 H 145" class="fs-aircraft-symbol"/>
          <circle cx="90" cy="90" r="3" class="fs-aircraft-dot"/>
        </g>
        <circle cx="90" cy="90" r="76" class="fs-attitude-ring"/>
        <path d="M 90 8 L 85 19 L 95 19 Z" class="fs-attitude-bank-pointer"/>
      </svg>
      <div class="fs-instrument-value fs-attitude-value"><strong data-value="attitude">0°</strong><span>PITCH</span></div>
    </div>`;
}

function headingCard() {
  let compass = '';
  for (let angle = 0; angle < 360; angle += 30) {
    const [x1, y1] = polarPoint(angle, 68);
    const [x2, y2] = polarPoint(angle, 76);
    const [tx, ty] = polarPoint(angle, 53);
    const label = angle === 0 ? 'N' : angle === 90 ? 'E' : angle === 180 ? 'S' : angle === 270 ? 'W' : String(angle / 10).padStart(2, '0');
    compass += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="fs-tick-major"/>`;
    compass += `<text x="${tx.toFixed(2)}" y="${(ty + 4).toFixed(2)}" class="${angle % 90 === 0 ? 'fs-compass-cardinal' : 'fs-dial-number'}">${label}</text>`;
  }
  return `
    <div class="fs-instrument fs-heading-card" data-gauge="heading" role="group" aria-label="Heading">
      <div class="fs-instrument-heading"><span>HEADING</span><span>DEG</span></div>
      <svg class="fs-dial" viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r="82" class="fs-dial-rim"/>
        <circle cx="90" cy="90" r="78" class="fs-dial-face"/>
        <g data-compass-rose>${compass}</g>
        <path d="M 90 11 L 84 25 L 96 25 Z" class="fs-compass-index"/>
        <path d="M 64 90 H 79 L 90 81 L 101 90 H 116" class="fs-compass-aircraft"/>
      </svg>
      <div class="fs-instrument-value"><strong data-value="heading">000</strong><span>°</span></div>
    </div>`;
}

function icon(name) {
  const paths = {
    pause: '<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>',
    view: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M9 9v10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 0 1 5 1.6c0 1.7-2.5 2.1-2.5 4.1M12 17.6h.01"/>',
    restart: '<path d="M4 11a8 8 0 1 0 2.2-5.5M4 4v5h5"/>',
    runway: '<path d="M8 21 10 3h4l2 18M12 5v2M12 11v2M12 17v2"/>',
    assets: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    lighting: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    sound: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="fs-button-icon">${paths[name]}</svg>`;
}

function button(action, label, iconName, extraClass = '') {
  return `<button type="button" class="fs-button ${extraClass}" data-action="${action}" aria-label="${label}" title="${label}">${iconName ? icon(iconName) : ''}<span>${label}</span></button>`;
}

/**
 * Create a modern vector cockpit overlay inside an existing game container.
 * callbacks: { onAction(action), onThrottle(value) }. Action names are
 * restart, runway, pause, view, gear, flaps, help, and assets.
 */
export function createUI(container, callbacks = {}) {
  if (!(container instanceof Element)) throw new TypeError('createUI expects a DOM element');
  const id = ++nextInstrumentId;
  const root = document.createElement('div');
  root.className = 'fs-ui';
  root.innerHTML = `
    <header class="fs-topbar">
      <div class="fs-brand" aria-label="Flight Simulator Reimagined">
        <span class="fs-brand-mark" aria-hidden="true"><span></span></span>
        <span class="fs-brand-copy"><strong>FLIGHT<span>SIM</span></strong><small>REIMAGINED</small></span>
      </div>
      <div class="fs-flight-status"><span class="fs-status-dot"></span><span data-status>FINAL APPROACH · AIRFIELD</span></div>
      <div class="fs-top-actions">
        ${button('restart', 'Approach', 'restart', 'fs-top-button')}
        ${button('runway', 'Runway', 'runway', 'fs-top-button')}
        ${button('view', 'View', 'view', 'fs-top-button')}
        ${button('pause', 'Pause', 'pause', 'fs-top-button')}
        ${button('lighting', 'Lighting', 'lighting', 'fs-top-button')}
        ${button('sound', 'Sound', 'sound', 'fs-top-button')}
        ${button('assets', 'Visuals', 'assets', 'fs-top-button')}
        ${button('help', 'Controls', 'help', 'fs-top-button')}
      </div>
    </header>
    <aside class="fs-map-controls" aria-label="Scenery selection">
      <label>ORIGINAL SCENERY<select data-map-select aria-label="Map"></select></label>
      <label>DEPARTURE / APPROACH<select data-runway-select aria-label="Runway"></select></label>
      <span data-map-summary></span>
    </aside>
    <div class="fs-flight-hud" aria-hidden="true">
      <div class="fs-hud-item"><span>IAS</span><strong data-hud="speed">--</strong><small>KT</small></div>
      <div class="fs-hud-rule"></div>
      <div class="fs-hud-item"><span>ALT</span><strong data-hud="altitude">--</strong><small>FT</small></div>
      <div class="fs-hud-rule"></div>
      <div class="fs-hud-item"><span>HDG</span><strong data-hud="heading">---</strong><small>°</small></div>
    </div>
    <div class="fs-reticle" aria-hidden="true"><i></i><b></b><i></i></div>
    <div class="fs-scene-caption" aria-hidden="true"><span class="fs-caption-line"></span><span data-environment>CLEAR DAY / RUNWAY 36</span></div>
    <aside class="fs-navigation" aria-label="Flight guidance">
      <div class="fs-navigation-title"><span>FLIGHT GUIDE</span><span data-distance>2.80 KM</span></div>
      <strong data-guide-title>Final approach</strong><p data-guide-hint></p>
      <div class="fs-map-view"><canvas data-map-canvas aria-label="Converted scenery map, selected runway points up."></canvas>
      <svg class="fs-minimap" viewBox="0 0 200 100" role="img" aria-label="Aircraft position relative to selected runway.">
        <g data-map-plane><path d="M0-5 2-1 7 1 7 3 2 2 1 5-1 5-2 2-7 3-7 1-2-1Z"/></g>
      </svg></div>
      <div class="fs-navigation-foot"><span data-offset>CENTERLINE</span><span data-lighting>DAYLIGHT</span></div>
    </aside>
    <div class="fs-pointer-controls" aria-label="Pointer flight controls">
      <div class="fs-yoke" data-yoke tabindex="0" role="group" aria-label="Drag up to pitch up, down to pitch down, left or right to bank"><span class="fs-yoke-label">DRAG TO FLY</span><i class="fs-yoke-cross"></i><span class="fs-yoke-stick"></span></div>
      <div class="fs-rudder-buttons"><button type="button" data-hold="KeyA" aria-label="Hold to steer rudder left">← RUDDER</button><button type="button" data-hold="KeyD" aria-label="Hold to steer rudder right">RUDDER →</button></div>
      <div class="fs-power-buttons"><button type="button" data-hold="KeyS" aria-label="Hold to decrease throttle">− POWER</button><button type="button" data-hold="KeyW" aria-label="Hold to increase throttle">POWER +</button></div>
    </div>
    <section class="fs-panel" aria-label="Flight instruments">
      <div class="fs-panel-main">
        <div class="fs-instruments">
          ${dialCard({ name: 'speed', label: 'AIRSPEED', unit: 'KT', labels: ['0', '40', '80', '120', '160'], range: [.22, .78] })}
          ${attitudeCard(id)}
          ${dialCard({ name: 'altitude', label: 'ALTITUDE', unit: 'FT', labels: ['0', '1', '2', '3', '4'], range: [0, .75] })}
          ${headingCard()}
          ${dialCard({ name: 'vertical', label: 'VERTICAL SPEED', unit: 'FPM', labels: ['-2', '-1', '0', '+1', '+2'], range: [.25, .75] })}
        </div>
        <div class="fs-controls" aria-label="Aircraft controls">
          <div class="fs-control-title"><span>FLIGHT CONTROLS</span><span class="fs-control-live">● LIVE</span></div>
          <label class="fs-throttle-label" for="fs-throttle-${id}"><span>THROTTLE</span><strong data-throttle>42%</strong></label>
          <input id="fs-throttle-${id}" class="fs-throttle" type="range" min="0" max="100" step="1" value="42" aria-label="Throttle percentage"/>
          <div class="fs-throttle-scale"><span>IDLE</span><span>MAX</span></div>
          <div class="fs-control-buttons">
            <button class="fs-toggle" type="button" data-action="gear" aria-pressed="true"><span class="fs-toggle-led"></span><span><strong>GEAR</strong><small data-gear>DOWN</small></span><kbd>G</kbd></button>
            <button class="fs-toggle" type="button" data-action="flaps" aria-pressed="false"><span class="fs-toggle-led"></span><span><strong>FLAPS</strong><small data-flaps>OFF</small></span><kbd>F</kbd></button>
          </div>
        </div>
      </div>
      <div class="fs-panel-footer"><span>SIMULATOR / 01</span><span class="fs-key-hints">ARROWS <b>FLY</b> &nbsp; A / D <b>RUDDER</b> &nbsp; W / S <b>THROTTLE</b></span><span data-footer-state>IN FLIGHT</span></div>
    </section>
    <div class="fs-toast" role="status" aria-live="polite" data-toast></div>
    <section class="fs-dialog fs-help-dialog" data-help hidden aria-label="Flight controls">
      <div class="fs-dialog-card">
        <div class="fs-dialog-eyebrow">FLIGHT MANUAL / QUICK REFERENCE</div>
        <h2>Take the controls.</h2>
        <p>Keep the gear down and touch down gently. On the runway, use full throttle and pitch up at 53 knots. You can also drag the circular flight control and use the throttle slider.</p>
        <div class="fs-key-grid">
          <div><kbd>↑</kbd><kbd>↓</kbd><span>Pitch up / down</span></div>
          <div><kbd>←</kbd><kbd>→</kbd><span>Bank left / right</span></div>
          <div><kbd>A</kbd><kbd>D</kbd><span>Rudder</span></div>
          <div><kbd>W</kbd><kbd>S</kbd><span>Throttle</span></div>
          <div><kbd>G</kbd><span>Landing gear</span></div>
          <div><kbd>F</kbd><span>Flaps</span></div>
          <div><kbd>P</kbd><span>Pause</span></div>
          <div><kbd>C</kbd><span>Cockpit view</span></div>
          <div><kbd>L</kbd><span>Day / sunset</span></div>
          <div><kbd>M</kbd><span>Engine sound</span></div>
        </div>
        <button type="button" class="fs-primary-button" data-action="close-help">Back to flight</button>
      </div>
    </section>
    <section class="fs-dialog fs-assets-dialog" data-assets hidden aria-label="Visual design">
      <div class="fs-assets-card">
        <div class="fs-assets-heading"><div><div class="fs-dialog-eyebrow">VISUAL SYSTEM / 2026</div><h2>Scenery, refined.</h2><p>Original scenery positions and airport records now drive the map. Modern materials, generated facades, clean runway markings and vector instruments replace the old pixel artwork.</p></div><button type="button" class="fs-close-button" data-action="close-assets" aria-label="Close visual design panel">×</button></div>
        <div class="fs-assets-grid">
          <div class="fs-asset-card"><div class="fs-asset-preview fs-asset-terrain"><i class="fs-asset-sun"></i><i class="fs-asset-mountain one"></i><i class="fs-asset-mountain two"></i><i class="fs-asset-field"></i></div><strong>Terrain</strong><span>Recovered city and water polygons</span></div>
          <div class="fs-asset-card"><div class="fs-asset-preview fs-asset-runway"><i class="fs-asset-runway-surface"></i><i class="fs-asset-runway-stripe"></i><i class="fs-asset-runway-light left"></i><i class="fs-asset-runway-light right"></i></div><strong>Airfield</strong><span>Clean markings and luminous lights</span></div>
          <div class="fs-asset-card"><div class="fs-asset-preview fs-asset-water"><i></i><i></i><i></i></div><strong>Atmosphere</strong><span>Soft sky, haze, and water shading</span></div>
          <div class="fs-asset-card"><div class="fs-asset-preview fs-asset-panel-preview"><i class="fs-asset-mini-dial"></i><i class="fs-asset-mini-dial"></i><i class="fs-asset-mini-dial"></i></div><strong>Cockpit</strong><span>Sharp SVG gauges at any resolution</span></div>
        </div>
        <button type="button" class="fs-primary-button" data-action="close-assets">Back to flight</button>
      </div>
    </section>
    <section class="fs-dialog fs-intro-dialog" data-intro hidden aria-label="Start flight">
      <div class="fs-intro-content">
        <div class="fs-intro-badge">A CLASSIC, REIMAGINED</div>
        <h1>Take to the <em>skies.</em></h1>
        <p>Fly the original scenery, rebuilt for your browser. Choose a map and runway above, then land an approach or take off.</p>
        <div class="fs-intro-buttons">
          <button class="fs-primary-button" type="button" data-action="restart">Fly approach <span>↗</span></button>
          <button class="fs-secondary-button" type="button" data-action="runway">Start on runway <span>→</span></button>
        </div>
        <span class="fs-intro-foot">KEYBOARD OR TOUCH · DAYLIGHT OR SUNSET</span>
      </div>
    </section>
    <section class="fs-dialog fs-message-dialog" data-message hidden aria-live="polite">
      <div class="fs-message-card"><span class="fs-dialog-eyebrow" data-message-eyebrow>FLIGHT STATUS</span><h2 data-message-title>Flight complete</h2><p data-message-copy></p><div class="fs-message-actions"><button class="fs-primary-button" data-action="restart" data-crash-action type="button">Retry approach</button><button class="fs-primary-button" data-action="continue" data-landed-action type="button" hidden>Continue flight</button><button class="fs-primary-button" data-action="pause" data-pause-action type="button" hidden>Resume flight</button><button class="fs-secondary-button" data-action="runway" data-runway-action type="button">Runway start</button></div></div>
    </section>
  `;
  container.append(root);

  const query = (selector) => root.querySelector(selector);
  const ui = {
    root,
    callbacks,
    elements: {
      speed: query('[data-value="speed"]'),
      altitude: query('[data-value="altitude"]'),
      attitude: query('[data-value="attitude"]'),
      heading: query('[data-value="heading"]'),
      vertical: query('[data-value="vertical"]'),
      speedNeedle: query('[data-needle="speed"]'),
      altitudeNeedle: query('[data-needle="altitude"]'),
      verticalNeedle: query('[data-needle="vertical"]'),
      horizon: query('[data-attitude-horizon]'),
      compass: query('[data-compass-rose]'),
      throttleInput: query('.fs-throttle'),
      throttleText: query('[data-throttle]'),
      gear: query('[data-gear]'),
      flaps: query('[data-flaps]'),
      gearButton: query('[data-action="gear"]'),
      flapsButton: query('[data-action="flaps"]'),
      status: query('[data-status]'),
      footerState: query('[data-footer-state]'),
      hudSpeed: query('[data-hud="speed"]'),
      hudAltitude: query('[data-hud="altitude"]'),
      hudHeading: query('[data-hud="heading"]'),
      intro: query('[data-intro]'),
      help: query('[data-help]'),
      assets: query('[data-assets]'),
      message: query('[data-message]'),
      messageEyebrow: query('[data-message-eyebrow]'),
      messageTitle: query('[data-message-title]'),
      messageCopy: query('[data-message-copy]'),
      crashAction: query('[data-crash-action]'),
      landedAction: query('[data-landed-action]'),
      pauseAction: query('[data-pause-action]'),
      runwayAction: query('[data-runway-action]'),
      toast: query('[data-toast]'),
      pauseButton: query('[data-action="pause"]'),
      soundButton: query('[data-action="sound"]'),
      guideTitle: query('[data-guide-title]'),
      guideHint: query('[data-guide-hint]'),
      guide: query('.fs-navigation'),
      distance: query('[data-distance]'),
      offset: query('[data-offset]'),
      lighting: query('[data-lighting]'),
      environment: query('[data-environment]'),
      mapPlane: query('[data-map-plane]'),
      yoke: query('[data-yoke]'),
      panel: query('.fs-panel'),
      mapSelect: query('[data-map-select]'),
      runwaySelect: query('[data-runway-select]'),
      mapSummary: query('[data-map-summary]'),
      mapCanvas: query('[data-map-canvas]'),
    },
    helpOpen: false,
    assetsOpen: false,
    dismissedLanding: false,
    wasLanded: false,
    toastTimer: null,
    toastText: '',
  };

  ui.onClick = (event) => {
    const control = event.target.closest('[data-action]');
    if (!control || !root.contains(control)) return;
    const action = control.dataset.action;
    if (action === 'close-help') {
      ui.helpOpen = false;
      ui.elements.help.hidden = true;
      callbacks.onAction?.('close-help');
      return;
    }
    if (action === 'close-assets') {
      ui.assetsOpen = false;
      ui.elements.assets.hidden = true;
      callbacks.onAction?.('close-assets');
      return;
    }
    if (action === 'continue') {
      ui.dismissedLanding = true;
      ui.elements.message.hidden = true;
      callbacks.onAction?.('continue');
      return;
    }
    if (action === 'help') {
      ui.helpOpen = !ui.helpOpen;
      ui.elements.help.hidden = !ui.helpOpen;
      ui.assetsOpen = false;
      ui.elements.assets.hidden = true;
    }
    if (action === 'assets') {
      ui.assetsOpen = !ui.assetsOpen;
      ui.elements.assets.hidden = !ui.assetsOpen;
      ui.helpOpen = false;
      ui.elements.help.hidden = true;
    }
    callbacks.onAction?.(action);
  };
  ui.onThrottle = (event) => callbacks.onThrottle?.(Number(event.target.value) / 100);
  root.addEventListener('click', ui.onClick);
  ui.elements.throttleInput.addEventListener('input', ui.onThrottle);
  ui.elements.mapSelect.addEventListener('change', event => callbacks.onMapChange?.(event.target.value));
  ui.elements.runwaySelect.addEventListener('change', event => callbacks.onRunwayChange?.(event.target.value));
  return ui;
}

/** Update the overlay from the JavaScript flight model's SI-unit state. */
export function updateUI(ui, state = {}, settings = {}) {
  if (!ui?.root?.isConnected) return;
  const e = ui.elements;
  const speed = Math.max(0, finite(state.speed) * KNOTS_PER_METRE_SECOND);
  const altitude = Math.max(0, finite(state.altitude) * FEET_PER_METRE);
  const heading = degrees(state.heading + (settings.selectedRunway?.heading || 0) / RAD_TO_DEG);
  const vertical = finite(state.vertical_speed) * FPM_PER_METRE_SECOND;
  const throttle = clamp(finite(state.throttle), 0, 1);
  const pitch = clamp(finite(state.pitch) * RAD_TO_DEG, -90, 90);
  const roll = clamp(finite(state.roll) * RAD_TO_DEG, -90, 90);

  e.speed.textContent = rounded(speed);
  e.altitude.textContent = rounded(altitude);
  e.attitude.textContent = `${Math.round(pitch)}°`;
  e.heading.textContent = String(Math.round(heading) % 360).padStart(3, '0');
  e.vertical.textContent = `${vertical >= 0 ? '+' : '−'}${rounded(Math.abs(vertical))}`;
  e.hudSpeed.textContent = rounded(speed);
  e.hudAltitude.textContent = rounded(altitude);
  e.hudHeading.textContent = String(Math.round(heading) % 360).padStart(3, '0');

  e.speedNeedle.setAttribute('transform', `rotate(${(-130 + clamp(speed / 160, 0, 1) * 260).toFixed(2)} 90 90)`);
  e.altitudeNeedle.setAttribute('transform', `rotate(${(-130 + clamp(altitude / 4000, 0, 1) * 260).toFixed(2)} 90 90)`);
  e.verticalNeedle.setAttribute('transform', `rotate(${clamp(vertical / 2000, -1, 1) * 130} 90 90)`);
  e.horizon.setAttribute('transform', `rotate(${(-roll).toFixed(2)} 90 90) translate(0 ${(pitch * 2.1).toFixed(2)})`);
  e.compass.setAttribute('transform', `rotate(${-heading.toFixed(2)} 90 90)`);

  const throttlePercent = Math.round(throttle * 100);
  e.throttleText.textContent = `${throttlePercent}%`;
  if (document.activeElement !== e.throttleInput) e.throttleInput.value = String(throttlePercent);
  e.throttleInput.style.setProperty('--fs-throttle-fill', `${throttlePercent}%`);
  e.gear.textContent = state.gear ? 'DOWN' : 'UP';
  e.flaps.textContent = state.flaps ? 'ON' : 'OFF';
  e.gearButton.setAttribute('aria-pressed', String(Boolean(state.gear)));
  e.flapsButton.setAttribute('aria-pressed', String(Boolean(state.flaps)));
  e.gearButton.classList.toggle('is-active', Boolean(state.gear));
  e.flapsButton.classList.toggle('is-active', Boolean(state.flaps));
  const guidance = flightGuidance(state, settings.mode);
  e.guideTitle.textContent = guidance.title;
  e.guideHint.textContent = guidance.hint;
  e.guide.classList.toggle('is-warning', guidance.warning);
  e.distance.textContent = state.on_ground ? `${Math.round(guidance.runwayRemaining)} M LEFT` : `${guidance.distance.toFixed(2)} KM`;
  e.offset.textContent = Math.abs(state.x) < 5 ? 'CENTERLINE' : `${Math.round(Math.abs(state.x))} M ${state.x > 0 ? 'RIGHT' : 'LEFT'}`;
  e.lighting.textContent = settings.lighting === 'sunset' ? 'GOLDEN HOUR' : 'DAYLIGHT';
  e.environment.textContent = `${settings.map?.label || 'AIRFIELD'} / RWY ${settings.selectedRunway?.numbers[0] || '36'} / ${settings.lighting === 'sunset' ? 'SUNSET' : 'DAY'}`;
  const mapX = clamp(100 + finite(state.x) * (ui.minimap?.scale || 1/50), 7, 193);
  const mapY = clamp(56 - finite(state.z) * (ui.minimap?.scale || 1/65), 7, 93);
  e.mapPlane.setAttribute('transform', `translate(${mapX.toFixed(1)} ${mapY.toFixed(1)}) rotate(${degrees(state.heading).toFixed(1)})`);
  e.mapSelect.disabled = e.runwaySelect.disabled = Boolean(settings.mapLoading);
  e.soundButton.setAttribute('aria-pressed', String(Boolean(settings.sound)));
  e.soundButton.classList.toggle('is-active', Boolean(settings.sound));

  const crashed = Boolean(state.crashed);
  const landed = Boolean(state.landed);
  if (landed && !ui.wasLanded) ui.dismissedLanding = false;
  if (!landed) ui.dismissedLanding = false;
  ui.wasLanded = landed;
  const paused = Boolean(settings.paused);
  const intro = Boolean(settings.intro);
  const showPanel = settings.cockpit !== false && settings.view !== 'external';
  ui.root.classList.toggle('fs-is-intro', intro);
  ui.root.classList.toggle('fs-has-dialog', intro || paused || crashed || ui.helpOpen || ui.assetsOpen || (landed && !ui.dismissedLanding));
  e.throttleInput.disabled = settings.mapLoading || intro || paused || crashed || ui.helpOpen || ui.assetsOpen || (landed && !ui.dismissedLanding);
  ui.root.classList.toggle('fs-external-view', !showPanel);
  e.panel.inert = !showPanel;
  e.panel.setAttribute('aria-hidden', String(!showPanel));
  ui.root.classList.toggle('fs-is-paused', paused);
  ui.root.classList.toggle('fs-is-crashed', crashed);
  e.intro.hidden = !intro;
  e.message.hidden = intro || (!crashed && (!landed || ui.dismissedLanding) && !paused);
  e.crashAction.hidden = !crashed;
  e.landedAction.hidden = !landed || crashed || paused;
  e.pauseAction.hidden = !paused || crashed;
  e.runwayAction.hidden = paused && !crashed && !landed;
  e.pauseButton.querySelector('span').textContent = paused ? 'Resume' : 'Pause';

  if (crashed) {
    e.status.textContent = 'FLIGHT ENDED · AIRCRAFT DOWN';
    e.footerState.textContent = 'FLIGHT ENDED';
    e.messageEyebrow.textContent = 'FLIGHT ENDED';
    e.messageTitle.textContent = 'A rough landing.';
    e.messageCopy.textContent = 'Reset the approach and try again, or practice a takeoff from the runway.';
  } else if (paused) {
    e.status.textContent = 'SIMULATION PAUSED';
    e.footerState.textContent = 'PAUSED';
    e.messageEyebrow.textContent = 'SIMULATION PAUSED';
    e.messageTitle.textContent = 'Taking a breather?';
    e.messageCopy.textContent = 'Press P or the pause button to resume your flight.';
  } else if (landed) {
    e.status.textContent = 'TOUCHDOWN · LANDED';
    e.footerState.textContent = 'LANDED';
    e.messageEyebrow.textContent = 'TOUCHDOWN';
    e.messageTitle.textContent = 'Nicely done.';
    e.messageCopy.textContent = 'You made it down safely. Add throttle to take off again or start a new approach.';
  } else {
    e.status.textContent = state.on_ground ? 'RUNWAY · READY FOR TAKEOFF' : settings.mode === 'runway' ? 'DEPARTURE · CLIMB OUT' : 'APPROACH · RUNWAY AHEAD';
    e.footerState.textContent = state.on_ground ? 'ON GROUND' : 'IN FLIGHT';
  }
}

/** Show a short message above the cockpit. */
export function showToast(ui, message, duration = 2600) {
  if (!ui?.elements?.toast) return;
  clearTimeout(ui.toastTimer);
  ui.elements.toast.textContent = String(message);
  ui.elements.toast.classList.add('is-visible');
  ui.toastTimer = setTimeout(() => ui.elements.toast?.classList.remove('is-visible'), duration);
}

export function destroyUI(ui) {
  if (!ui) return;
  clearTimeout(ui.toastTimer);
  ui.root?.removeEventListener('click', ui.onClick);
  ui.elements?.throttleInput?.removeEventListener('input', ui.onThrottle);
  ui.root?.remove();
}
