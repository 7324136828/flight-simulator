const continuousFields = ['x', 'z', 'altitude', 'speed', 'pitch', 'roll', 'throttle', 'vertical_speed'];
const fullTurn = Math.PI * 2;

// Draw between completed physics steps. Discrete flight events still use the
// current simulation state, and restarting must reset both snapshots together.
export function interpolateFlightState(previous, current, fraction, result = {}) {
  const alpha = Math.max(0, Math.min(1, fraction));
  Object.assign(result, current);
  for (const field of continuousFields) {
    result[field] = previous[field] + (current[field] - previous[field]) * alpha;
  }
  const turn = Math.atan2(Math.sin(current.heading - previous.heading), Math.cos(current.heading - previous.heading));
  result.heading = ((previous.heading + turn * alpha) % fullTurn + fullTurn) % fullTurn;
  return result;
}

// Keep the shadow's light-space x/y projection on whole texels as the aircraft
// moves. Snapping world x/z alone would still shimmer for an angled sun.
export function snapShadowTarget(position, direction, texelWidth, texelHeight, result = position) {
  const horizontal = Math.hypot(direction.x, direction.z);
  const rx = horizontal ? direction.z / horizontal : 1;
  const rz = horizontal ? -direction.x / horizontal : 0;
  const ux = direction.y * rz;
  const uy = horizontal;
  const uz = -direction.y * rx;
  const right = position.x * rx + position.z * rz;
  const up = position.x * ux + position.y * uy + position.z * uz;
  const shiftRight = Math.round(right / texelWidth) * texelWidth - right;
  const shiftUp = Math.round(up / texelHeight) * texelHeight - up;
  result.x = position.x + rx * shiftRight + ux * shiftUp;
  result.y = position.y + uy * shiftUp;
  result.z = position.z + rz * shiftRight + uz * shiftUp;
  return result;
}
