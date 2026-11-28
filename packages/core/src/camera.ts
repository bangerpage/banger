import type { Region, StopModel } from "./state.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** (cx, cy) is the canvas coordinate that sits at the center of the stage. */
export interface CameraPose {
  cx: number;
  cy: number;
  zoom: number;
}

export interface CameraTween {
  from: CameraPose;
  to: CameraPose;
  start: number;
  duration: number;
  /** How far (in log zoom) the move pulls back at its midpoint, beyond the straight zoom change. 0 or less. */
  pullBack: number;
  /** `swift` makes `sample` use ease-out. Left off for `smooth`. */
  curve?: CameraMotion;
}

export type CameraMotion = "smooth" | "swift";

export interface TweenOptions {
  motion?: CameraMotion;
  /** `false` keeps a `smooth` move from pulling back, whatever the distance. */
  pullBack?: boolean;
}

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
const MIN_DURATION = 400;
const MAX_DURATION = 800;
const MAX_PULL_BACK_DURATION = 1300;
const SWIFT_MIN_DURATION = 180;
const SWIFT_MAX_DURATION = 280;
const SWIFT_MS_PER_SCORE = 25;
/** A move pulls back once its distance is this many times the wider of the two views. Neighbouring grid frames stay below it. */
const PULL_BACK_DISTANCE = 1.5;

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

export function frameRect(at: [number, number], span: [number, number], gap: number): Rect {
  const [col, row] = at;
  const [spanW, spanH] = span;
  return {
    x: col * (FRAME_WIDTH + gap),
    y: row * (FRAME_HEIGHT + gap),
    w: spanW * FRAME_WIDTH + (spanW - 1) * gap,
    h: spanH * FRAME_HEIGHT + (spanH - 1) * gap,
  };
}

/** A frame with a `parent` (the id of an earlier entry) is placed in that frame's cells, so its rect starts at the parent's origin. */
export function layoutFrames(
  frames: { id: string; at: [number, number]; span: [number, number]; parent?: string | null }[],
  gap: number,
): Record<string, Rect> {
  const out = new Map<string, Rect>();
  for (const f of frames) {
    const r = frameRect(f.at, f.span, gap);
    const origin = f.parent != null ? out.get(f.parent) : undefined;
    out.set(f.id, origin ? { ...r, x: r.x + origin.x, y: r.y + origin.y } : r);
  }
  return Object.fromEntries(out);
}

export function regionRect(frame: Rect, region: Region): Rect {
  return {
    x: frame.x + region.x * frame.w,
    y: frame.y + region.y * frame.h,
    w: region.w * frame.w,
    h: region.h * frame.h,
  };
}

export function boundsOf(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** `rect` grown by `margin` on every side. */
export function inflate(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, w: rect.w + 2 * margin, h: rect.h + 2 * margin };
}

export function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/** Contain fit: the whole rect is visible, centered. */
export function poseFor(rect: Rect, stage: Size): CameraPose {
  return {
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
    zoom: Math.min(stage.w / rect.w, stage.h / rect.h),
  };
}

/** A stop that names no known frame (and overview stops) shows every frame. A focus stop shows its whole frame here: its element's box is measured in the page by bang-root. */
export function targetFor(stop: StopModel, frames: Record<string, Rect>, stage: Size): CameraPose {
  const frame = stop.kind === "overview" || stop.frame === undefined ? undefined : frames[stop.frame];
  if (!frame) return poseFor(boundsOf(Object.values(frames)), stage);
  return poseFor(stop.kind === "region" && stop.region ? regionRect(frame, stop.region) : frame, stage);
}

/** Below this share of the screen a frame counts as far; above `NEAR_TO`, as near. Between them it fades. */
const NEAR_FROM = 0.5;
const NEAR_TO = 0.8;

/** 0 when the frame fills at most half the screen (in its wider direction), 1 from 80%, smooth in between. */
export function nearness(rect: Rect, pose: CameraPose, stage: Size): number {
  const share = Math.max((rect.w * pose.zoom) / stage.w, (rect.h * pose.zoom) / stage.h);
  const t = clamp01((share - NEAR_FROM) / (NEAR_TO - NEAR_FROM));
  return t * t * (3 - 2 * t);
}

/** Widens `rect` to the screen's shape and slides it inside `frame`, so a close-up never shows the frame's edge; the whole frame when the close-up would not fit in it. */
export function viewInside(rect: Rect, frame: Rect, stage: Size): Rect {
  const aspect = stage.w / stage.h;
  const w = Math.max(rect.w, rect.h * aspect);
  const h = w / aspect;
  if (w >= frame.w || h >= frame.h) return frame;
  const x = Math.min(Math.max(rect.x + rect.w / 2 - w / 2, frame.x), frame.x + frame.w - w);
  const y = Math.min(Math.max(rect.y + rect.h / 2 - h / 2, frame.y), frame.y + frame.h - h);
  return { x, y, w, h };
}

export function stageSize(viewport: Size): Size {
  const s0 = Math.min(viewport.w / FRAME_WIDTH, viewport.h / FRAME_HEIGHT);
  return { w: FRAME_WIDTH * s0, h: FRAME_HEIGHT * s0 };
}

function moveScore(from: CameraPose, to: CameraPose, stage: Size): number {
  const distance = Math.hypot(to.cx - from.cx, to.cy - from.cy);
  const meanZoom = (from.zoom + to.zoom) / 2;
  return (distance * meanZoom) / stage.w + Math.abs(Math.log(to.zoom / from.zoom));
}

export function durationFor(from: CameraPose, to: CameraPose, stage: Size): number {
  const score = moveScore(from, to, stage);
  return Math.min(Math.max(MIN_DURATION + 100 * score, MIN_DURATION), MAX_DURATION);
}

/** Cubic ease-in-out. */
export function ease(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Quartic ease-out: fast at the start, settling at the end. */
export function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 4);
}

/**
 * For a far move, how much to zoom out beyond the straight change so the midpoint shows both ends. A move whose distance
 * is under `PULL_BACK_DISTANCE` views gets 0, so moves between neighbours stay a plain pan.
 */
export function pullBackFor(from: CameraPose, to: CameraPose, stage: Size): number {
  const viewW = Math.max(stage.w / from.zoom, stage.w / to.zoom);
  const viewH = Math.max(stage.h / from.zoom, stage.h / to.zoom);
  const dx = Math.abs(to.cx - from.cx);
  const dy = Math.abs(to.cy - from.cy);
  if (Math.hypot(dx / viewW, dy / viewH) < PULL_BACK_DISTANCE) return 0;
  const both = Math.min(stage.w / (dx + viewW), stage.h / (dy + viewH));
  const straight = (Math.log(from.zoom) + Math.log(to.zoom)) / 2;
  return Math.min(0, Math.log(both) - straight);
}

export function startTween(
  from: CameraPose,
  to: CameraPose,
  now: number,
  stage: Size,
  opts?: TweenOptions,
): CameraTween {
  if (opts?.motion === "swift") {
    const duration = Math.min(SWIFT_MIN_DURATION + SWIFT_MS_PER_SCORE * moveScore(from, to, stage), SWIFT_MAX_DURATION);
    return { from, to, start: now, duration, pullBack: 0, curve: "swift" };
  }
  const pullBack = opts?.pullBack === false ? 0 : pullBackFor(from, to, stage);
  const duration = Math.min(durationFor(from, to, stage) - 250 * pullBack, MAX_PULL_BACK_DURATION);
  return { from, to, start: now, duration, pullBack };
}

export function sample(tween: CameraTween, now: number): CameraPose {
  const t = clamp01((now - tween.start) / tween.duration);
  if (t <= 0) return { ...tween.from };
  if (t >= 1) return { ...tween.to };
  const e = (tween.curve === "swift" ? easeOut : ease)(t);
  const { from, to } = tween;
  return {
    cx: from.cx + (to.cx - from.cx) * e,
    cy: from.cy + (to.cy - from.cy) * e,
    zoom: from.zoom * Math.pow(to.zoom / from.zoom, e) * Math.exp(tween.pullBack * Math.sin(Math.PI * e)),
  };
}

/** Starts a new tween from the current pose so an interrupted move does not jump. */
export function retarget(
  current: CameraPose,
  to: CameraPose,
  now: number,
  stage: Size,
  opts?: TweenOptions,
): CameraTween {
  return startTween(current, to, now, stage, opts);
}

/** The margin (stage px) around the box the target rect occupies at `pose.zoom`, centered in the stage. */
export function clipFor(
  rect: Rect,
  pose: CameraPose,
  stage: Size,
): { top: number; right: number; bottom: number; left: number } {
  const margin = (total: number, size: number) => {
    const value = (total - size * pose.zoom) / 2;
    return Math.abs(value) < 1e-9 ? 0 : Math.max(0, value);
  };
  const x = margin(stage.w, rect.w);
  const y = margin(stage.h, rect.h);
  return { top: y, right: x, bottom: y, left: x };
}

/** The canvas point under a point on the stage (stage pixels from its top left), for the camera at `pose`. */
export function stageToCanvas(point: { x: number; y: number }, pose: CameraPose, stage: Size): { x: number; y: number } {
  const { tx, ty, scale } = toTransform(pose, stage);
  return { x: (point.x - tx) / scale, y: (point.y - ty) / scale };
}

/**
 * `layer: false` gives a 2D transform. A 3D one puts the canvas on its own compositor layer, which moves smoothly but
 * may be drawn from a raster made at the previous zoom, so stills taken from it differ from run to run.
 */
export function toTransform(
  pose: CameraPose,
  stage: Size,
  layer = true,
): { tx: number; ty: number; scale: number; css: string } {
  const tx = stage.w / 2 - pose.cx * pose.zoom;
  const ty = stage.h / 2 - pose.cy * pose.zoom;
  const move = layer ? `translate3d(${tx}px, ${ty}px, 0)` : `translate(${tx}px, ${ty}px)`;
  return { tx, ty, scale: pose.zoom, css: `${move} scale(${pose.zoom})` };
}
