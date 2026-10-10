// Engine and airflow are synthesized locally; no audio files or native modules.
export function createFlightAudio() {
  let context, master, engine, engineGain, wind, windGain, filter;
  let enabled = false;
  async function toggle() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      engine = context.createOscillator();
      engine.type = 'triangle';
      engineGain = context.createGain();
      engineGain.gain.value = 0.12;
      engine.connect(engineGain).connect(master);
      engine.start();
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < data.length; i++) {
        previous = (previous + (Math.random() * 2 - 1) * 0.025) / 1.025;
        data[i] = previous * 3;
      }
      wind = context.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      windGain = context.createGain();
      windGain.gain.value = 0;
      wind.connect(filter).connect(windGain).connect(master);
      wind.start();
    }
    await context.resume();
    enabled = !enabled;
    return enabled;
  }
  return {
    toggle,
    update(state, active) {
      if (!context) return;
      const time = context.currentTime;
      master.gain.setTargetAtTime(enabled && active && !state.crashed ? 0.65 : 0, time, 0.08);
      engine.frequency.setTargetAtTime(28 + state.throttle * 74, time, 0.1);
      engineGain.gain.setTargetAtTime(0.06 + state.throttle * 0.10, time, 0.1);
      filter.frequency.setTargetAtTime(250 + state.speed * 22, time, 0.1);
      windGain.gain.setTargetAtTime(Math.min(state.speed / 120, 0.5), time, 0.1);
    },
    destroy() { if (context) void context.close(); },
  };
}
