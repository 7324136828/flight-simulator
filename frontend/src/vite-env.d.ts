/// <reference types="vite/client" />

declare module '*simulator/flight-model.js' {
  export const approachStart: any;
  export const runwayStart: any;
  export const step: any;
}

declare module '*simulator/ui.js' {
  export const createUI: any;
  export const updateUI: any;
  export const showToast: any;
  export const destroyUI: any;
}

declare module '*simulator/world.js' {
  export const createWorld: any;
}

declare module '*simulator/input.js' {
  export const createInput: any;
}

declare module '*simulator/audio.js' {
  export const createFlightAudio: any;
}

declare module '*simulator/scenery.js' {
  export const loadManifest: any;
  export const loadMap: any;
  export const drawMinimap: any;
  export const runwayFrame: any;
  export const createScenery: any;
}

declare module '*simulator/render-stability.js' {
  export const interpolateFlightState: any;
  export const snapShadowTarget: any;
}

interface ModelContextTool {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, never>;
    additionalProperties: false;
  };
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: () => Promise<Record<string, number | string>>;
}

interface ModelContext {
  registerTool: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown> | unknown;
}

interface Document {
  modelContext?: ModelContext;
}
