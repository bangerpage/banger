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
}

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
const MIN_DURATION = 400;
const MAX_DURATION = 800;

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

export function layoutFrames(
  frames: { id: string; at: [number, number]; span: [number, number] }[],
  gap: number,
): Record<string, Rect> {
  return Object.fromEntries(frames.map((f) => [f.id, frameRect(f.at, f.span, gap)]));
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

/** Contain fit: the whole rect is visible, centered. */
export function poseFor(rect: Rect, stage: Size): CameraPose {
  return {
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
    zoom: Math.min(stage.w / rect.w, stage.h / rect.h),
  };
}

/** A stop that names no known frame (and overview stops) shows every frame. */
export function targetFor(stop: StopModel, frames: Record<string, Rect>, stage: Size): CameraPose {
  const frame = stop.kind === "overview" || stop.frame === undefined ? undefined : frames[stop.frame];
  if (!frame) return poseFor(boundsOf(Object.values(frames)), stage);
  return poseFor(stop.kind === "region" && stop.region ? regionRect(frame, stop.region) : frame, stage);
}

export function stageSize(viewport: Size): Size {
  const s0 = Math.min(viewport.w / FRAME_WIDTH, viewport.h / FRAME_HEIGHT);
  return { w: FRAME_WIDTH * s0, h: FRAME_HEIGHT * s0 };
}

export function durationFor(from: CameraPose, to: CameraPose, stage: Size): number {
  const distance = Math.hypot(to.cx - from.cx, to.cy - from.cy);
  const meanZoom = (from.zoom + to.zoom) / 2;
  const score = (distance * meanZoom) / stage.w + Math.abs(Math.log(to.zoom / from.zoom));
  return Math.min(Math.max(MIN_DURATION + 100 * score, MIN_DURATION), MAX_DURATION);
}

/** Cubic ease-in-out. */
export function ease(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function startTween(from: CameraPose, to: CameraPose, now: number, stage: Size): CameraTween {
  return { from, to, start: now, duration: durationFor(from, to, stage) };
}

export function sample(tween: CameraTween, now: number): CameraPose {
  const t = clamp01((now - tween.start) / tween.duration);
  if (t <= 0) return { ...tween.from };
  if (t >= 1) return { ...tween.to };
  const e = ease(t);
  const { from, to } = tween;
  return {
    cx: from.cx + (to.cx - from.cx) * e,
    cy: from.cy + (to.cy - from.cy) * e,
    zoom: from.zoom * Math.pow(to.zoom / from.zoom, e),
  };
}

/** Starts a new tween from the current pose so an interrupted move does not jump. */
export function retarget(current: CameraPose, to: CameraPose, now: number, stage: Size): CameraTween {
  return startTween(current, to, now, stage);
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

export function toTransform(
  pose: CameraPose,
  stage: Size,
): { tx: number; ty: number; scale: number; css: string } {
  const tx = stage.w / 2 - pose.cx * pose.zoom;
  const ty = stage.h / 2 - pose.cy * pose.zoom;
  return { tx, ty, scale: pose.zoom, css: `translate3d(${tx}px, ${ty}px, 0) scale(${pose.zoom})` };
}
