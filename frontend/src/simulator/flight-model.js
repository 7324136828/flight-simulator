// JavaScript port of cpp/src/flight_model.cpp. Distances are metres, speeds
// are metres per second, and angles are radians. Heading zero faces north
// (+z) and increases clockwise toward east (+x).

const PI = Math.PI;
const GRAVITY = 9.81;
const RUNWAY_HALF_WIDTH = 30;
const RUNWAY_LENGTH = 1800;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const axis = (value) => Number.isFinite(value) ? clamp(value, -1, 1) : 0;

function approach(current, target, rate, dt) {
  return current + clamp(target - current, -rate * dt, rate * dt);
}

export function overRunway(state) {
  return Math.abs(state.x) <= (state.runway?.width / 2 || RUNWAY_HALF_WIDTH) &&
    state.z >= 0 && state.z <= (state.runway?.length || RUNWAY_LENGTH);
}

function headingError(heading) {
  return ((heading + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
}

function crash(state) {
  state.crashed = true;
  state.on_ground = true;
  state.landed = false;
  state.altitude = 0;
  state.vertical_speed = 0;
  state.speed = 0;
  state.throttle = 0;
}

export function approachStart(runway) {
  return {
    ...(runway ? {runway:{length:runway.length,width:runway.width,heading:runway.heading}} : {}),
    x: 0,
    z: -2800,
    altitude: 170,
    speed: 32,
    heading: 0,
    pitch: 0,
    roll: 0,
    throttle: 0.42,
    vertical_speed: -1.6,
    gear: true,
    flaps: true,
    on_ground: false,
    crashed: false,
    landed: false,
  };
}

export function runwayStart(runway) {
  return {
    ...(runway ? {runway:{length:runway.length,width:runway.width,heading:runway.heading}} : {}),
    x: 0,
    z: runway ? Math.min(100,runway.length*.08) : 200,
    altitude: 0,
    speed: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    throttle: 0,
    vertical_speed: 0,
    gear: true,
    flaps: false,
    on_ground: true,
    crashed: false,
    landed: false,
  };
}

// Mutates and returns state, matching the C++ step(State&, ...) interface.
// Positive pitch raises the nose; positive roll and yaw turn right.
export function step(state, controls = {}, dt) {
  if (state.crashed || !Number.isFinite(dt) || dt <= 0) return state;
  // A paused renderer cannot advance the aeroplane through a giant step.
  dt = Math.min(dt, 0.1);
  controls ??= {};

  const pitchInput = axis(controls.pitch);
  const rollInput = axis(controls.roll);
  const yawInput = axis(controls.yaw);
  const throttleDirection = Number(Boolean(controls.throttle_up)) -
    Number(Boolean(controls.throttle_down));
  state.throttle = clamp(state.throttle + throttleDirection * 0.32 * dt, 0, 1);

  const stallSpeed = state.flaps ? 20 : 23;
  const authority = state.on_ground ? 1 : clamp(state.speed / stallSpeed, 0.35, 1);
  const targetPitch = pitchInput * 0.28 * authority;
  const targetRoll = state.on_ground ? 0 : rollInput * 0.72 * authority;
  state.pitch = approach(state.pitch, targetPitch, 0.65 * authority, dt);
  state.roll = approach(state.roll, targetRoll, 1.1 * authority, dt);

  const flightPath = state.pitch - 0.055;
  const drag = 0.25 + 0.00125 * state.speed * state.speed +
    (state.gear ? 0.10 : 0) + (state.flaps ? 0.25 : 0) +
    0.25 * Math.abs(state.roll);
  const engine = 3.1 * state.throttle;
  const rollingDrag = state.on_ground && state.speed > 0 ? 0.22 : 0;
  const slopeForce = state.on_ground ? 0 : GRAVITY * Math.sin(flightPath);
  state.speed = clamp(state.speed +
    (engine - drag - rollingDrag - slopeForce) * dt, 0, 85);

  if (state.on_ground) {
    state.altitude = 0;
    state.vertical_speed = 0;
    state.heading += yawInput *
      (0.15 + 0.35 * Math.min(state.speed / 25, 1)) * dt;
    if (state.speed >= (state.flaps ? 23 : 27) && state.pitch >= 0.075 &&
        overRunway(state)) {
      state.on_ground = false;
      state.landed = false;
      state.altitude = 0.1;
      state.vertical_speed = 1;
    }
  } else {
    const turnRate = GRAVITY * Math.tan(state.roll) / Math.max(state.speed, 12);
    state.heading += (turnRate + 0.20 * yawInput * authority) * dt;

    let targetVerticalSpeed = state.speed * Math.sin(flightPath) +
      (state.throttle - 0.42) * 1.2;
    if (state.speed < stallSpeed) {
      targetVerticalSpeed = Math.min(targetVerticalSpeed,
        -1 - 1.1 * (stallSpeed - state.speed));
      state.pitch = approach(state.pitch, -0.12, 0.25, dt);
    }
    state.vertical_speed = approach(state.vertical_speed,
      targetVerticalSpeed, 5, dt);
    state.altitude += state.vertical_speed * dt;
  }

  state.heading %= 2 * PI;
  if (state.heading < 0) state.heading += 2 * PI;
  state.x += state.speed * Math.sin(state.heading) * dt;
  state.z += state.speed * Math.cos(state.heading) * dt;

  if (!state.on_ground && state.altitude <= 0) {
    const safeTouchdown = state.gear && overRunway(state) &&
      Math.abs(headingError(state.heading)) <= 0.26 &&
      Math.abs(state.roll) <= 0.18 && Math.abs(state.pitch) <= 0.18 &&
      state.vertical_speed >= -3.5 && state.speed >= 17 &&
      state.speed <= 45;
    if (!safeTouchdown) {
      crash(state);
      return state;
    }
    state.on_ground = true;
    state.landed = true;
    state.altitude = 0;
    state.vertical_speed = 0;
  }

  if (state.on_ground && !overRunway(state) && state.speed > 8) crash(state);
  return state;
}
