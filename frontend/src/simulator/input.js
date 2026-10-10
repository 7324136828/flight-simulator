const flightKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
const shortcuts = { Enter: 'start', KeyR: 'restart', KeyT: 'runway', KeyP: 'pause', Space: 'pause', KeyC: 'view', KeyV: 'view', KeyG: 'gear', KeyF: 'flaps', KeyH: 'help', KeyB: 'assets', KeyL: 'lighting', KeyM: 'sound', Escape: 'escape' };

export function createInput({ pad, root, onAction }) {
  const held = new Set();
  const pointers = new Map();
  let stick = { pitch: 0, roll: 0 };
  let padPointer = null;
  function reset() {
    held.clear();
    pointers.clear();
    stick = { pitch: 0, roll: 0 };
    if (padPointer !== null && pad.hasPointerCapture(padPointer)) pad.releasePointerCapture(padPointer);
    padPointer = null;
    pad.style.setProperty('--stick-x', '0px');
    pad.style.setProperty('--stick-y', '0px');
    root.querySelectorAll('[data-hold]').forEach(button => button.classList.remove('is-held'));
  }
  function keydown(event) {
    // Preserve browser shortcuts and the native semantics of focused controls.
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    if (event.target.closest?.('button') && ['Space', 'Enter'].includes(event.code)) return;
    if (flightKeys.has(event.code) || shortcuts[event.code]) event.preventDefault();
    if (flightKeys.has(event.code)) held.add(event.code);
    if (!event.repeat && shortcuts[event.code]) onAction(shortcuts[event.code]);
  }
  const keyup = event => held.delete(event.code);
  function moveStick(event) {
    if (event.pointerId !== padPointer) return;
    const bounds = pad.getBoundingClientRect();
    const radius = bounds.width * 0.36;
    let x = (event.clientX - bounds.left - bounds.width / 2) / radius;
    let y = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const length = Math.max(1, Math.hypot(x, y));
    x /= length;
    y /= length;
    stick = { roll: x, pitch: -y };
    pad.style.setProperty('--stick-x', `${x * radius}px`);
    pad.style.setProperty('--stick-y', `${y * radius}px`);
  }
  function pointerdown(event) {
    const button = event.target.closest('[data-hold]');
    if (button) {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button.dataset.hold);
      button.classList.add('is-held');
    } else if (event.target.closest('[data-yoke]') && padPointer === null) {
      event.preventDefault();
      padPointer = event.pointerId;
      pad.setPointerCapture(event.pointerId);
      moveStick(event);
    }
  }
  function pointerup(event) {
    const key = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (key && ![...pointers.values()].includes(key)) root.querySelector(`[data-hold="${key}"]`)?.classList.remove('is-held');
    if (event.pointerId === padPointer) {
      padPointer = null;
      stick = { pitch: 0, roll: 0 };
      pad.style.setProperty('--stick-x', '0px');
      pad.style.setProperty('--stick-y', '0px');
    }
  }
  const visibility = () => { if (document.hidden) reset(); };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', visibility);
  root.addEventListener('pointerdown', pointerdown);
  root.addEventListener('pointerup', pointerup);
  root.addEventListener('pointercancel', pointerup);
  root.addEventListener('lostpointercapture', pointerup);
  pad.addEventListener('pointermove', moveStick);
  return {
    reset,
    read() {
      const pressed = code => held.has(code) || [...pointers.values()].includes(code);
      return {
        pitch: pressed('ArrowUp') ? 1 : pressed('ArrowDown') ? -1 : stick.pitch,
        roll: pressed('ArrowRight') ? 1 : pressed('ArrowLeft') ? -1 : stick.roll,
        yaw: Number(pressed('KeyD')) - Number(pressed('KeyA')),
        throttle_up: pressed('KeyW'), throttle_down: pressed('KeyS'),
      };
    },
    destroy() {
      reset();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
      root.removeEventListener('pointerdown', pointerdown);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) root.removeEventListener(name, pointerup);
      pad.removeEventListener('pointermove', moveStick);
    },
  };
}
