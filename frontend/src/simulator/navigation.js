// Guidance uses the same runway bounds and units as the ported flight model.
export function flightGuidance(state, mode = 'approach') {
  const knots = state.speed * 1.94384449;
  const stall = !state.on_ground && state.speed < (state.flaps ? 20 : 23);
  let title, hint;
  if (state.crashed) {
    title = 'Flight ended';
    hint = 'Try a fresh approach or a runway takeoff.';
  } else if (state.landed) {
    title = 'Safe touchdown';
    hint = 'Continue to roll out, or add power and rotate for another flight.';
  } else if (state.on_ground) {
    title = knots >= 53 ? 'Rotate' : 'Build airspeed';
    hint = knots >= 53 ? 'Gently pitch up to lift off.' : 'Set full throttle. Keep the nose on the centerline.';
  } else if (stall) {
    title = 'Stall warning';
    hint = 'Lower the nose and add power to recover airspeed.';
  } else if (mode === 'runway') {
    title = 'Climb out';
    hint = 'Keep a gentle nose-up attitude. Retract gear and flaps after climbing.';
  } else if (!state.gear && state.altitude < 100) {
    title = 'Extend landing gear';
    hint = 'Press G before touching down.';
  } else if (Math.abs(state.x) > (state.runway?.width / 2 || 30)) {
    title = 'Align with the runway';
    hint = `Bank gently ${state.x > 0 ? 'left' : 'right'} toward the centerline, then level the wings.`;
  } else if (state.altitude < 14 && state.z > -180) {
    title = 'Flare gently';
    hint = 'Keep the wings level. Use a little nose-up input to soften the descent.';
  } else {
    title = 'Final approach';
    hint = 'Hold a steady descent, keep the gear down, and stay on the centerline.';
  }
  return {
    title, hint, warning: stall || (!state.gear && !state.on_ground && state.altitude < 100),
    distance: Math.hypot(state.x, Math.max(0, -state.z)) / 1000,
    crossTrack: state.x,
    runwayRemaining: Math.max(0, (state.runway?.length || 1800) - state.z),
  };
}
