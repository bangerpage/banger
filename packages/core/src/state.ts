export interface BangState {
  stop: number;
  step: number;
}

/** Fractions (0-1) of a frame. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StopModel {
  kind: "frame" | "region" | "overview";
  frame?: string;
  region?: Region;
  steps: number;
}

export interface PathModel {
  stops: StopModel[];
}

const INTEGER = /^-?\d+$/;
const EPSILON = 1e-9;

function stepsOf(path: PathModel, stop: number): number {
  return path.stops[stop]?.steps ?? 0;
}

export function clamp(state: BangState, path: PathModel): BangState {
  if (path.stops.length === 0) return { stop: 0, step: 0 };
  const stop = Math.min(Math.max(Math.trunc(state.stop) || 0, 0), path.stops.length - 1);
  const step = Math.min(Math.max(Math.trunc(state.step) || 0, 0), stepsOf(path, stop));
  return { stop, step };
}

export function parseHash(hash: string, path: PathModel): BangState {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const rawStop = params.get("stop");
  const rawStep = params.get("step");
  const stop = rawStop !== null && INTEGER.test(rawStop) ? Number(rawStop) : 0;
  const clampedStop = clamp({ stop, step: 0 }, path).stop;
  let step = 0;
  if (rawStep === "last") step = stepsOf(path, clampedStop);
  else if (rawStep !== null && INTEGER.test(rawStep)) step = Number(rawStep);
  return clamp({ stop: clampedStop, step }, path);
}

export function serializeHash(state: BangState): string {
  return `#stop=${state.stop}&step=${state.step}`;
}

export function next(state: BangState, path: PathModel): BangState {
  const current = clamp(state, path);
  if (current.step < stepsOf(path, current.stop)) return { stop: current.stop, step: current.step + 1 };
  if (current.stop < path.stops.length - 1) return { stop: current.stop + 1, step: 0 };
  return current;
}

export function prev(state: BangState, path: PathModel): BangState {
  const current = clamp(state, path);
  if (current.step > 0) return { stop: current.stop, step: current.step - 1 };
  if (current.stop > 0) return { stop: current.stop - 1, step: stepsOf(path, current.stop - 1) };
  return current;
}

/**
 * The step at which frame `frameId` is shown. Stops before the current one contribute their final
 * step so content revealed earlier is never hidden again; the current stop contributes the live step.
 */
export function frameStep(frameId: string, state: BangState, path: PathModel): number {
  const current = clamp(state, path);
  let result = 0;
  for (let i = 0; i < current.stop; i++) {
    const stop = path.stops[i];
    if (stop.kind !== "overview" && stop.frame === frameId) result = Math.max(result, stop.steps);
  }
  const here = path.stops[current.stop];
  if (here && here.kind !== "overview" && here.frame === frameId) result = Math.max(result, current.step);
  return result;
}

export function parseRegion(value: string | null): Region | null {
  if (value === null) return null;
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((p) => p.trim() === "")) return null;
  const [x, y, w, h] = parts.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  if (x + w > 1 + EPSILON || y + h > 1 + EPSILON) return null;
  return { x, y, w, h };
}

function parsePair(value: string | null, min: number, fallback: [number, number]): [number, number] {
  if (value === null) return fallback;
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length !== 2 || !parts.every((p) => /^\d+$/.test(p))) return fallback;
  const [a, b] = parts.map(Number);
  return a >= min && b >= min ? [a, b] : fallback;
}

export function parseAt(value: string | null): [number, number] {
  return parsePair(value, 0, [0, 0]);
}

export function parseSpan(value: string | null): [number, number] {
  return parsePair(value, 1, [1, 1]);
}
