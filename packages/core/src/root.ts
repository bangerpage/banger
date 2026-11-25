import { version } from "./version.js";
import { css, html, nothing, svg, unsafeCSS, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { pick, warnOnce } from "./attrs.js";
import { frameOverflowWarnings, overlapWarnings, unknownTagWarnings } from "./deck-check.js";
import {
  boundsOf,
  clipFor,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  layoutFrames,
  poseFor,
  nearness,
  regionRect,
  retarget,
  stageToCanvas,
  viewInside,
  sample,
  stageSize,
  toTransform,
  type CameraPose,
  type CameraTween,
  type Rect,
  type Size,
} from "./camera.js";
import { ensureBaseStyle, ensureThemeFonts } from "./base-style.js";
import { BangElement, defineOnce, selectorOf, type StepAware } from "./element.js";
import { openPresenter, PresenterSync, renderPresenter } from "./presenter.js";
import { collectReady, type ReadyReport } from "./ready.js";
import {
  clamp,
  frameStep,
  next,
  parseAt,
  parseHash,
  parseSpan,
  prev,
  serializeHash,
  type BangState,
  type PathModel,
  type StopModel,
} from "./state.js";
import { readStop } from "./stop.js";
import { readThemeJson } from "./theme-element.js";
import { FRAME_TONES, frameToneColors, parseThemeJson, resolveTheme, type ThemeColorToken } from "./theme/custom.js";
import { themeColorTokens, themeCss } from "./theme/theme.generated.js";

export type RootMode = "live" | "export" | "presenter";

export interface StopInfo {
  index: number;
  kind: "frame" | "region" | "focus" | "overview";
  frame?: string;
  steps: number;
  notes: string;
  zoom: number;
  rect: Rect;
}

export interface OverflowItem {
  frame: string;
  selector: string;
  overflowX: number;
  overflowY: number;
}

export interface TextSample {
  selector: string;
  frame: string;
  fontPx: number;
  color: string;
  background: string | null;
}

type Source = "local" | "hash" | "remote";

interface FrameEntry {
  el: HTMLElement & { currentStep?: number };
  id: string;
  rect: Rect;
}

const FRAME_GAP = 240;
const MAP_GAP = 720;
/** How far the map ground reaches past the outermost frames. */
const MAP_MARGIN = 960;
/** Ground shown around the frames in the overview of a map, so the outermost places do not touch the screen edge. */
const MAP_OVERVIEW_MARGIN = 320;
/** Space kept around a focused element, as a fraction of its larger side measured in 16:9. */
const FOCUS_MARGIN = 0.08;
const STATUS_MS = 4000;
const FULL_STAGE: Size = { w: FRAME_WIDTH, h: FRAME_HEIGHT };

function modeOf(): RootMode {
  const mode = new URLSearchParams(location.search).get("mode");
  return mode === "export" || mode === "presenter" ? mode : "live";
}

const SWIPE_MIN_PX = 50;
const SWIPE_MAX_MS = 800;
/** Page-turner remotes for phones press the mouse, drag it most of the screen up, down or sideways in about 200ms and let go. A person's drag is rarely both this long and this quick. */
const FLICK_MIN_PX = 300;
const FLICK_MAX_MS = 400;
const CURSOR_WAKE_PX = 60;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The presentation root: lays frames out on a canvas and moves the camera between stops.
 *
 * ```html
 * <bang-root>
 *   <bang-frame id="intro"><bang-title>Hello</bang-title></bang-frame>
 *   <bang-path><bang-stop frame="intro"></bang-stop></bang-path>
 * </bang-root>
 * ```
 *
 * @element bang-root
 * @slot - `bang-frame` elements and one `bang-path`.
 */
export class BangRoot extends BangElement {
  /** The runtime version, so a deck can tell which build it is running on. */
  static readonly version = version;

  static styles = [
    unsafeCSS(themeCss),
    css`
      :host {
        display: block;
        position: fixed;
        inset: 0;
        overflow: hidden;
        background: var(--bang-color-line);
        color: var(--bang-color-ink);
        font-family: var(--bang-font-sans);
        /* Horizontal swipes move between stops, so the browser keeps only vertical panning and pinch zoom. */
        touch-action: pan-y pinch-zoom;
      }
      :host([data-mode="export"]) {
        position: relative;
        width: 1920px;
        height: 1080px;
      }
      .viewport {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bang-color-line);
      }
      .stage {
        position: relative;
        flex: none;
        overflow: hidden;
      }
      :host([data-bang-nocursor]),
      :host([data-bang-nocursor]) * {
        cursor: none !important;
      }
      :host([data-bang-overview]) .stage {
        cursor: pointer;
      }
      .clip {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      .canvas {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        transform-origin: 0 0;
      }
      .ground {
        position: absolute;
        background-color: color-mix(in srgb, var(--bang-color-paper) 70%, var(--bang-color-line));
        background-image:
          radial-gradient(ellipse 34% 30% at 22% 30%, transparent 0 60%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 60% 60.6%, transparent 60.6% 75%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 75% 75.6%, transparent 75.6% 90%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 90% 90.6%, transparent 90.6%),
          radial-gradient(ellipse 30% 36% at 78% 72%, transparent 0 60%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 60% 60.6%, transparent 60.6% 75%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 75% 75.6%, transparent 75.6% 90%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 90% 90.6%, transparent 90.6%),
          radial-gradient(ellipse 22% 20% at 70% 18%, transparent 0 55%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 55% 56%, transparent 56% 78%, color-mix(in srgb, var(--bang-color-line) 55%, transparent) 78% 79%, transparent 79%),
          linear-gradient(color-mix(in srgb, var(--bang-color-ink) 6%, transparent) 4px, transparent 4px),
          linear-gradient(90deg, color-mix(in srgb, var(--bang-color-ink) 6%, transparent) 4px, transparent 4px);
        background-size: auto, auto, auto, 480px 480px, 480px 480px;
      }
      .roads {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .road {
        stroke: color-mix(in srgb, var(--bang-color-ink) 22%, var(--bang-color-paper));
        stroke-width: 96;
        stroke-linecap: round;
      }
      .road-center {
        stroke: var(--bang-color-paper);
        stroke-width: 10;
        stroke-dasharray: 60 50;
        stroke-linecap: round;
      }
      :host([format="map"]) .viewport,
      :host([format="map"]) {
        background: color-mix(in srgb, var(--bang-color-paper) 70%, var(--bang-color-line));
      }
      .status {
        position: absolute;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        padding: 8px 16px;
        border-radius: var(--bang-radius-m);
        background: var(--bang-color-ink);
        color: var(--bang-color-paper);
        font-size: 16px;
      }
      .status:empty {
        display: none;
      }
      .presenter {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 32px;
        box-sizing: border-box;
        background: var(--bang-color-paper);
      }
      .presenter-head {
        display: flex;
        gap: 32px;
        font-family: var(--bang-font-mono);
        font-size: 24px;
      }
      .presenter-notes {
        flex: 1;
        overflow: auto;
        white-space: pre-wrap;
        font-size: 32px;
        line-height: 1.5;
      }
      .presenter-buttons {
        display: flex;
        gap: 16px;
      }
      .presenter-buttons button {
        flex: 1;
        padding: 16px;
        font: inherit;
        font-size: 24px;
        cursor: pointer;
      }
    `,
  ];

  /** Color theme. "custom" reads the colors and fonts from a bang-theme child. */
  @property() theme: "light" | "dark" | "custom" = "light";

  /**
   * How the canvas is presented. `slides` (the default) is frames side by side. `map` draws the canvas as a map: a
   * ground with contour lines under the frames, roads for each frame's `link`, wider gaps, and fog over every frame the
   * talk has not reached yet. Export pages show what is around the stop instead of masking it.
   * `map` is experimental: its look and behaviour may change in any release. Use `slides` unless the author asks for a map.
   */
  @property() format: "slides" | "map" = "slides";

  @state() private ground: { rect: Rect; roads: { x1: number; y1: number; x2: number; y2: number }[] } | null = null;

  @state() private stage: Size = FULL_STAGE;
  @state() private statusText = "";
  @state() private elapsedMs = 0;

  private mode: RootMode = "live";
  private path: PathModel = { stops: [] };
  private notes: string[] = [];
  private frames: FrameEntry[] = [];
  private frameMap: Record<string, Rect> = {};
  private current: BangState = { stop: 0, step: 0 };
  private inOverview = false;
  private pose: CameraPose = { cx: FRAME_WIDTH / 2, cy: FRAME_HEIGHT / 2, zoom: 1 };
  private tween: CameraTween | null = null;
  private tweenTimer: ReturnType<typeof setTimeout> | undefined;
  private tweenFrame: number | undefined;
  private resolvePending: (() => void) | null = null;
  private reducedMotion = false;
  private initialized = false;
  private sync: PresenterSync | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private clockTimer: ReturnType<typeof setInterval> | undefined;
  private startedAt = 0;
  private motionQuery: MediaQueryList | null = null;
  private themeKey: string | null = null;
  private themeVars: string[] = [];
  private themeWarnings: string[] = [];

  private readonly onKeydown = (event: KeyboardEvent) => this.handleKey(event);
  private swipeStart: { id: number; mouse: boolean; x: number; y: number; at: number } | null = null;
  private swiped = false;
  private readonly onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (isEditable(event.composedPath()[0] ?? event.target)) return;
    this.swipeStart = { id: event.pointerId, mouse: event.pointerType === "mouse", x: event.clientX, y: event.clientY, at: event.timeStamp };
  };
  /** A touch swipe to the left or right, or a quick long mouse flick in any direction (up or left is next, as on a phone). */
  private readonly onPointerUp = (event: PointerEvent) => {
    const start = this.swipeStart;
    if (!start || start.id !== event.pointerId) return;
    this.swipeStart = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const ms = event.timeStamp - start.at;
    let forward: boolean;
    if (start.mouse) {
      const vertical = Math.abs(dy) > Math.abs(dx);
      const along = vertical ? dy : dx;
      const across = vertical ? dx : dy;
      if (ms > FLICK_MAX_MS || Math.abs(along) < FLICK_MIN_PX || Math.abs(along) < Math.abs(across) * 1.5) return;
      forward = along < 0;
      window.getSelection()?.removeAllRanges();
      document.documentElement.setAttribute("data-bang-remote", "");
      this.setAttribute("data-bang-nocursor", "");
    } else {
      if (ms > SWIPE_MAX_MS || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      forward = dx < 0;
    }
    this.swiped = true;
    setTimeout(() => (this.swiped = false));
    void (forward ? this.next() : this.prev());
  };
  /** Shows the cursor again once a person moves the mouse; a remote teleports it in one jump with no button down, a hand moves it a little at a time. */
  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.buttons !== 0 || !this.hasAttribute("data-bang-nocursor")) return;
    if (Math.hypot(event.movementX, event.movementY) < CURSOR_WAKE_PX) this.removeAttribute("data-bang-nocursor");
  };
  /** In the overview, a click on a frame goes to it: the current stop when the talk is already there, else the frame's first stop. */
  private readonly onStageClick = (event: MouseEvent) => {
    if (!this.inOverview || this.tween || this.swiped) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const point = stageToCanvas({ x: event.clientX - box.left, y: event.clientY - box.top }, this.pose, this.stageNow);
    const hit = this.frames.find((f) => point.x >= f.rect.x && point.x <= f.rect.x + f.rect.w && point.y >= f.rect.y && point.y <= f.rect.y + f.rect.h);
    if (!hit) return;
    const here = this.path.stops[this.current.stop];
    if (here && here.kind !== "overview" && here.frame === hit.id) {
      void this.overview(false);
      return;
    }
    const first = this.path.stops.findIndex((s) => s.kind !== "overview" && s.frame === hit.id);
    if (first >= 0) void this.goto(first, 0);
  };
  private readonly onPointerCancel = () => {
    this.swipeStart = null;
  };
  private readonly onHashChange = () => {
    const state = this.hashState();
    void this.commit(state, { animate: true, source: "hash", overview: false });
  };
  private readonly onMotionChange = () => this.applyMotionPreference();

  connectedCallback(): void {
    super.connectedCallback();
    this.mode = modeOf();
    this.setAttribute("data-mode", this.mode);
    ensureBaseStyle(this.mode);
    this.applyTheme();
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.motionQuery.addEventListener("change", this.onMotionChange);
    this.applyMotionPreference();
    if (this.mode !== "export") {
      window.addEventListener("keydown", this.onKeydown);
      window.addEventListener("hashchange", this.onHashChange);
      window.addEventListener("pointerdown", this.onPointerDown);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerCancel);
      window.addEventListener("pointermove", this.onPointerMove);
      if (typeof BroadcastChannel !== "undefined") {
        this.sync = new PresenterSync();
        this.sync.onRemote((remote) => {
          void this.commit(clamp(remote, this.path), { animate: true, source: "remote", overview: false });
        });
      }
    }
    if (this.mode === "presenter") {
      this.startedAt = Date.now();
      this.clockTimer = setInterval(() => {
        this.elapsedMs = Date.now() - this.startedAt;
      }, 1000);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("hashchange", this.onHashChange);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("pointermove", this.onPointerMove);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.resizeObserver?.disconnect();
    this.sync?.close();
    this.sync = null;
    clearInterval(this.clockTimer);
    clearTimeout(this.statusTimer);
    this.stopTween();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("theme")) this.applyTheme();
    if (changed.has("format") && this.initialized) {
      this.buildPath();
      this.current = clamp(this.current, this.path);
      void this.commit(this.current, { animate: false, source: "hash", overview: this.inOverview });
    }
  }

  protected firstUpdated(_changed: PropertyValues): void {
    this.buildPath();
    if (this.mode !== "export") {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this);
      this.onResize();
    }
    this.current = this.hashState();
    this.initialized = true;
    void this.commit(this.current, { animate: false, source: "hash", overview: false });
  }

  render() {
    pick(this, "theme", ["light", "dark", "custom"] as const, "light");
    pick(this, "format", ["slides", "map"] as const, "slides");
    if (this.mode === "presenter") {
      const info = this.path.stops[this.current.stop];
      return html`${renderPresenter({
          stop: this.current.stop,
          stopCount: this.path.stops.length,
          step: this.current.step,
          steps: info?.steps ?? 0,
          notes: this.notes[this.current.stop] ?? "",
          elapsedMs: this.elapsedMs,
          onPrev: () => void this.prev(),
          onNext: () => void this.next(),
        })}<div class="status" role="status">${this.statusText}</div>
        <div hidden><slot @slotchange=${this.onSlotChange}></slot></div>`;
    }
    return html`<div class="viewport">
        <div class="stage" style="width:${this.stage.w}px;height:${this.stage.h}px" @click=${this.onStageClick}>
          <div class="clip">
            <div class="canvas">${this.renderGround()}<slot @slotchange=${this.onSlotChange}></slot></div>
          </div>
        </div>
      </div>
      <div class="status" role="status">${this.statusText}</div>`;
  }

  private renderGround() {
    const ground = this.ground;
    if (!ground) return nothing;
    const { rect } = ground;
    return html`<div class="ground" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px">
      <svg class="roads" viewBox="${rect.x} ${rect.y} ${rect.w} ${rect.h}" aria-hidden="true">
        ${ground.roads.map(
          (r) => svg`<line class="road" x1=${r.x1} y1=${r.y1} x2=${r.x2} y2=${r.y2}></line><line class="road-center" x1=${r.x1} y1=${r.y1} x2=${r.x2} y2=${r.y2}></line>`,
        )}
      </svg>
    </div>`;
  }

  private onSlotChange = () => {
    this.applyTheme();
    for (const text of this.deckWarnings()) warnOnce(`deck|${text}`, `[banger] ${text}`);
    if (!this.initialized) return;
    this.buildPath();
    this.current = clamp(this.current, this.path);
    void this.commit(this.current, { animate: false, source: "hash", overview: this.inOverview });
  };

  /** Overlays the colors and fonts of the bang-theme child as inline variables when theme="custom". */
  private applyTheme(): void {
    const text = readThemeJson(this);
    const clear = () => {
      for (const name of this.themeVars) this.style.removeProperty(name);
      this.themeVars = [];
    };
    const report = (warnings: string[]) => {
      this.themeWarnings = warnings;
      for (const w of warnings) warnOnce(`theme|${w}`, `[banger] ${w}`);
    };
    const theme = this.getAttribute("theme");
    if (theme !== "custom") {
      clear();
      const key = `\0ignored|${theme}|${text === null ? "none" : "present"}`;
      if (key === this.themeKey) return;
      this.themeKey = key;
      this.applyFrameTones(themeColorTokens[theme === "dark" ? "dark" : "light"]);
      report(text === null ? [] : ['theme: <bang-theme> is ignored unless theme="custom"']);
      return;
    }
    const key = text ?? "\0none";
    if (key === this.themeKey) return;
    this.themeKey = key;
    const warnings: string[] = [];
    let definition = {};
    if (text === null) {
      warnings.push('theme: theme="custom" needs a <bang-theme> child with a JSON script; the light theme is used');
    } else {
      const parsed = parseThemeJson(text);
      warnings.push(...parsed.warnings);
      definition = parsed.definition ?? {};
    }
    const resolved = resolveTheme(definition);
    warnings.push(...resolved.warnings);
    clear();
    const vars: Record<string, string> = {};
    for (const [token, value] of Object.entries(resolved.colors)) vars[`--bang-color-${token}`] = value;
    for (const [role, value] of Object.entries(resolved.fonts)) vars[`--bang-font-${role}`] = value;
    if (resolved.ground) vars["--bang-ground"] = resolved.ground;
    Object.assign(vars, resolved.vars);
    for (const [name, value] of Object.entries(vars)) this.style.setProperty(name, value);
    this.themeVars = Object.keys(vars);
    this.applyFrameTones(resolved.colors);
    if (resolved.fontsRequest) ensureThemeFonts(resolved.fontsRequest);
    report(warnings);
  }

  /** Warnings that depend on the elements in the deck; rebuilt on every call so frames added later are covered. */
  private deckWarnings(): string[] {
    const out: string[] = [];
    const toneOf = (el: Element | null) => {
      const tone = el?.getAttribute("tone");
      return tone === "accent" || tone === "inverse" ? tone : null;
    };
    for (const f of this.querySelectorAll("bang-frame[ground=cover]")) {
      const sel = selectorOf(f);
      const tone = toneOf(f);
      if (tone) out.push(`${sel}: ground="cover" is ignored because tone="${tone}" is set; the tone ground is used`);
      else if (this.style.getPropertyValue("--bang-cover-ground") === "") {
        out.push(`${sel}: ground="cover" needs theme="custom" with a coverGradient; the normal ground is used`);
      }
    }
    for (const c of this.querySelectorAll("bang-card[kind=band]")) {
      const sel = selectorOf(c);
      const tone = toneOf(c.closest("bang-frame"));
      if (this.style.getPropertyValue("--bang-band-ground") === "") {
        out.push(`${sel}: kind="band" needs theme="custom" with a bandGradient; the surface color is used`);
      } else if (tone) out.push(`${sel}: kind="band" inside a frame with tone="${tone}" uses the surface color`);
    }
    return out;
  }

  /** Publishes each frame tone's colours as --bang-frame-<tone>-<token>; bang-frame[tone] maps them onto its own --bang-color-*. */
  private applyFrameTones(colors: Record<ThemeColorToken, string>): void {
    for (const tone of FRAME_TONES) {
      for (const [token, value] of Object.entries(frameToneColors(colors, tone))) {
        this.style.setProperty(`--bang-frame-${tone}-${token}`, value);
      }
    }
  }

  private applyMotionPreference(): void {
    this.reducedMotion = this.motionQuery?.matches ?? false;
    if (this.mode === "export" || this.reducedMotion) this.style.setProperty("--bang-duration-fast", "0s");
    else this.style.removeProperty("--bang-duration-fast");
  }

  private onResize(): void {
    if (this.mode === "export") return;
    const stage = stageSize({ w: this.clientWidth || FRAME_WIDTH, h: this.clientHeight || FRAME_HEIGHT });
    if (stage.w === this.stage.w && stage.h === this.stage.h) return;
    this.stage = stage;
    if (this.initialized) {
      this.stopTween();
      this.pose = this.targetPose(this.current, this.inOverview);
      this.applyPose(this.pose);
      this.applyClip();
    }
  }

  private get stageNow(): Size {
    return this.mode === "export" ? FULL_STAGE : this.stage;
  }

  private buildPath(): void {
    const frameEls = [...this.querySelectorAll<HTMLElement & { currentStep?: number }>("bang-frame")];
    const seen = new Set<string>();
    const entries: { id: string; at: [number, number]; span: [number, number]; el: (typeof frameEls)[number] }[] = [];
    frameEls.forEach((el, i) => {
      let id = el.id;
      if (id && seen.has(id)) {
        warnOnce(`dupframe|${id}`, `[banger] duplicate bang-frame id "${id}"; the first one is used`);
        id = "";
      }
      if (id) seen.add(id);
      entries.push({ id: id || `\0${i}`, at: parseAt(el.getAttribute("at")), span: parseSpan(el.getAttribute("span")), el });
    });
    const isMap = this.getAttribute("format") === "map";
    const rects = layoutFrames(entries, isMap ? MAP_GAP : FRAME_GAP);
    this.frameMap = rects;
    this.frames = entries.map((e) => ({ el: e.el, id: e.id, rect: rects[e.id] }));
    for (const f of this.frames) {
      if (isMap) f.el.setAttribute("data-bang-format", "map");
      else f.el.removeAttribute("data-bang-format");
      f.el.style.setProperty("--bang-frame-x", `${f.rect.x}px`);
      f.el.style.setProperty("--bang-frame-y", `${f.rect.y}px`);
      f.el.style.setProperty("--bang-frame-w", `${f.rect.w}px`);
      f.el.style.setProperty("--bang-frame-h", `${f.rect.h}px`);
    }

    this.ground = isMap ? groundFor(this.frames) : null;

    const stops: StopModel[] = [];
    const notes: string[] = [];
    const stepped = new Set<string>();
    for (const el of this.querySelectorAll("bang-path > bang-stop")) {
      const read = readStop(el);
      let stop = read.stop;
      if (read.auto && stop.kind !== "overview") {
        const frame = this.frames.find((f) => f.id === stop.frame);
        if (frame && !stepped.has(frame.id)) stop = { ...stop, steps: stepsNeeded(frame.el) };
      }
      if (stop.kind !== "overview" && stop.frame) stepped.add(stop.frame);
      if (stop.kind !== "overview" && !(stop.frame && seen.has(stop.frame))) {
        warnOnce(
          `stopframe|${stop.frame}`,
          `[banger] <bang-stop frame="${stop.frame}"> does not match any bang-frame; treated as overview`,
        );
        stop = { kind: "overview", steps: stop.steps };
      }
      stops.push(stop);
      notes.push(read.notes);
    }
    this.path = { stops };
    this.notes = notes;
    this.warnShortSteps();
  }

  private warnShortSteps(): void {
    for (const f of this.frames) {
      if (f.id.startsWith("\0")) continue;
      const provided = this.path.stops.filter((s) => s.kind !== "overview" && s.frame === f.id).map((s) => s.steps);
      if (provided.length === 0) continue;
      const max = Math.max(...provided);
      const needed = stepsNeeded(f.el);
      if (needed > max) {
        warnOnce(
          `steps|${f.id}|${needed}|${max}`,
          `[banger] frame "${f.id}" needs ${needed} steps but its stops provide at most ${max}`,
        );
      }
    }
  }

  private hashState(): BangState {
    const state = parseHash(location.hash, this.path);
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const rawStop = params.get("stop");
    const rawStep = params.get("step");
    if ((rawStop !== null && rawStop !== String(state.stop)) || (rawStep !== null && rawStep !== "last" && rawStep !== String(state.step))) {
      warnOnce(
        `hash|${location.hash}`,
        `[banger] hash "${location.hash}" is out of range; using "${serializeHash(state)}"`,
      );
    }
    return state;
  }

  private allRects(): Rect[] {
    return this.frames.map((f) => f.rect);
  }

  private rectFor(state: BangState, overview: boolean): Rect | null {
    const all = this.allRects();
    let bounds = all.length > 0 ? boundsOf(all) : { x: 0, y: 0, w: FRAME_WIDTH, h: FRAME_HEIGHT };
    if (this.ground && all.length > 0) {
      const m = MAP_OVERVIEW_MARGIN;
      bounds = { x: bounds.x - m, y: bounds.y - m, w: bounds.w + 2 * m, h: bounds.h + 2 * m };
    }
    const stop = this.path.stops[state.stop];
    if (overview || !stop || stop.kind === "overview" || stop.frame === undefined) return bounds;
    const frame = this.frameMap[stop.frame];
    if (!frame) return null;
    if (stop.kind === "focus" && stop.focus) {
      const focus = this.focusRect(stop.frame, stop.focus);
      return focus ? viewInside(focus, frame, this.stageNow) : frame;
    }
    return stop.kind === "region" && stop.region ? regionRect(frame, stop.region) : frame;
  }

  /** The canvas rect of an element inside a frame, with a margin, or null when it is missing or not laid out. */
  private focusRect(frameId: string, id: string): Rect | null {
    const entry = this.frames.find((f) => f.id === frameId);
    if (!entry) return null;
    const target = entry.el.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) {
      warnOnce(`focus|${frameId}|${id}`, `[banger] <bang-stop focus="${id}"> does not match an element inside frame "${frameId}"; showing the whole frame`);
      return null;
    }
    const outer = entry.el.getBoundingClientRect();
    const inner = target.getBoundingClientRect();
    if (outer.width === 0 || inner.width === 0 || inner.height === 0) return null;
    const scale = outer.width / entry.rect.w;
    const box = {
      x: entry.rect.x + (inner.left - outer.left) / scale,
      y: entry.rect.y + (inner.top - outer.top) / scale,
      w: inner.width / scale,
      h: inner.height / scale,
    };
    const pad = Math.max(box.w, box.h * (FRAME_WIDTH / FRAME_HEIGHT)) * FOCUS_MARGIN;
    return { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
  }

  /** Re-aims a camera at rest, for when the layout under a focus stop settled after the camera moved (fonts, images). */
  private refreshPose(): void {
    if (!this.initialized || this.tween) return;
    const target = this.targetPose(this.current, this.inOverview);
    const p = this.pose;
    if (Math.abs(target.cx - p.cx) < 0.5 && Math.abs(target.cy - p.cy) < 0.5 && Math.abs(target.zoom / p.zoom - 1) < 1e-4) return;
    this.pose = target;
    this.applyPose(target);
    this.applyClip();
  }

  private targetPose(state: BangState, overview: boolean): CameraPose {
    const rect = this.rectFor(state, overview) ?? { x: 0, y: 0, w: FRAME_WIDTH, h: FRAME_HEIGHT };
    return poseFor(rect, this.stageNow);
  }

  private canvasEl(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(".canvas");
  }

  private applyPose(pose: CameraPose): void {
    const canvas = this.canvasEl();
    if (canvas) canvas.style.transform = toTransform(pose, this.stageNow, this.mode !== "export").css;
    this.applyNearness(pose);
  }

  /** Sets --bang-near on every frame from how much of the screen it fills, for `show="near|far"` and frame labels. */
  private applyNearness(pose: CameraPose): void {
    const stage = this.stageNow;
    for (const f of this.frames) {
      const near = nearness(f.rect, pose, stage);
      const value = near.toFixed(3);
      if (f.el.style.getPropertyValue("--bang-near") !== value) f.el.style.setProperty("--bang-near", value);
    }
  }

  private applyClip(): void {
    const clip = this.renderRoot.querySelector<HTMLElement>(".clip");
    if (!clip) return;
    const rect = this.rectFor(this.current, this.inOverview);
    if (this.mode !== "export" || !rect || this.getAttribute("format") === "map") {
      clip.style.clipPath = "none";
      return;
    }
    const target = poseFor(rect, FULL_STAGE);
    const c = clipFor(rect, target, FULL_STAGE);
    clip.style.clipPath = `inset(${c.top}px ${c.right}px ${c.bottom}px ${c.left}px)`;
  }

  private currentPose(): CameraPose {
    return this.tween ? sample(this.tween, performance.now()) : this.pose;
  }

  private stopTween(): void {
    clearTimeout(this.tweenTimer);
    if (this.tweenFrame !== undefined) cancelAnimationFrame(this.tweenFrame);
    this.tweenTimer = undefined;
    this.tweenFrame = undefined;
    this.tween = null;
    const canvas = this.canvasEl();
    if (canvas) canvas.style.willChange = "";
  }

  private settlePending(): void {
    const resolve = this.resolvePending;
    this.resolvePending = null;
    resolve?.();
  }

  private moveCamera(target: CameraPose, animate: boolean): Promise<void> {
    const from = this.currentPose();
    this.stopTween();
    this.settlePending();
    if (!animate || this.mode !== "live" || this.reducedMotion || !this.canvasEl()) {
      this.pose = target;
      this.applyPose(target);
      return Promise.resolve();
    }
    const tween = retarget(from, target, performance.now(), this.stageNow);
    this.tween = tween;
    this.canvasEl()!.style.willChange = "transform";
    return new Promise<void>((resolve) => {
      this.resolvePending = resolve;
      const finish = () => {
        if (this.tween !== tween) return;
        this.stopTween();
        this.pose = tween.to;
        this.applyPose(tween.to);
        this.settlePending();
      };
      this.tweenTimer = setTimeout(finish, tween.duration + 100);
      const step = () => {
        if (this.tween !== tween) return;
        const now = performance.now();
        if (now - tween.start >= tween.duration) {
          finish();
          return;
        }
        this.applyPose(sample(tween, now));
        this.tweenFrame = requestAnimationFrame(step);
      };
      this.tweenFrame = requestAnimationFrame(step);
    });
  }

  private applySteps(): void {
    const fog = this.getAttribute("format") === "map";
    for (const f of this.frames) {
      const first = this.path.stops.findIndex((s) => s.kind !== "overview" && s.frame === f.id);
      f.el.toggleAttribute("data-bang-fog", fog && first > this.current.stop);
      const step = frameStep(f.id, this.current, this.path);
      f.el.currentStep = step;
      for (const el of f.el.querySelectorAll("[data-step]")) {
        const n = Number(el.getAttribute("data-step"));
        if (Number.isFinite(n)) el.toggleAttribute("data-bang-hidden", step < n);
      }
      for (const el of f.el.querySelectorAll("[step]")) {
        if ("frameStep" in el) (el as StepAware).frameStep = step;
      }
    }
    this.applySpotlight();
  }

  /** On a focus stop, fades every frame but the stop's and, inside it, everything off the path from the frame to the focused element. */
  private applySpotlight(): void {
    for (const el of this.querySelectorAll("[data-bang-dim]")) el.removeAttribute("data-bang-dim");
    const stop = this.path.stops[this.current.stop];
    if (this.inOverview || !stop || stop.kind !== "focus" || !stop.focus) return;
    const entry = this.frames.find((f) => f.id === stop.frame);
    const target = entry?.el.querySelector<HTMLElement>(`#${CSS.escape(stop.focus)}`);
    if (!entry || !target) return;
    const dim = (el: Element) => {
      el.setAttribute("data-bang-spot", "");
      el.setAttribute("data-bang-dim", "");
    };
    for (const f of this.frames) if (f !== entry) dim(f.el);
    for (let node: Element = target; node !== entry.el && node.parentElement; node = node.parentElement) {
      node.setAttribute("data-bang-spot", "");
      for (const sibling of node.parentElement.children) if (sibling !== node) dim(sibling);
    }
  }

  /** Keeps keyboard focus and assistive technology on the frame the camera shows; the overview is for looking only. */
  private applyInert(): void {
    if (this.mode === "export") return;
    const stop = this.path.stops[this.current.stop];
    const shown = this.inOverview || !stop || stop.kind === "overview" ? null : stop.frame;
    for (const f of this.frames) f.el.inert = f.id !== shown;
  }

  private commit(
    wanted: BangState,
    opts: { animate: boolean; source: Source; overview: boolean },
  ): Promise<void> {
    const state = clamp(wanted, this.path);
    const rect = this.rectFor(state, opts.overview);
    if (!rect) {
      console.warn("[banger] no target rectangle for the requested state; ignoring it");
      return Promise.resolve();
    }
    this.current = state;
    this.inOverview = opts.overview;
    this.toggleAttribute("data-bang-overview", opts.overview);
    this.applySteps();
    this.applyInert();
    const moved = this.moveCamera(poseFor(rect, this.stageNow), opts.animate);
    this.applyClip();
    if (opts.source !== "hash" && location.hash !== serializeHash(state)) {
      history.replaceState(null, "", serializeHash(state));
    }
    this.dispatchEvent(
      new CustomEvent("bang:statechange", {
        detail: { stop: state.stop, step: state.step, overview: opts.overview },
        bubbles: true,
        composed: true,
      }),
    );
    if (opts.source === "local") this.sync?.send(state);
    this.requestUpdate();
    return moved;
  }

  private async whenInitialized(): Promise<void> {
    if (!this.initialized) await this.updateComplete;
  }

  /** Moves to a stop and step; resolves when the camera arrives. */
  async goto(stop: number, step: number | "last" = 0): Promise<void> {
    await this.whenInitialized();
    const last = this.path.stops[Math.min(Math.max(stop, 0), this.path.stops.length - 1)]?.steps ?? 0;
    return this.commit(
      { stop, step: step === "last" ? last : step },
      { animate: true, source: "local", overview: false },
    );
  }

  async next(): Promise<void> {
    await this.whenInitialized();
    return this.commit(next(this.current, this.path), { animate: true, source: "local", overview: false });
  }

  async prev(): Promise<void> {
    await this.whenInitialized();
    return this.commit(prev(this.current, this.path), { animate: true, source: "local", overview: false });
  }

  /** Shows every frame (or returns to the current stop). Without an argument it toggles. */
  async overview(on?: boolean): Promise<boolean> {
    await this.whenInitialized();
    const target = on ?? !this.inOverview;
    await this.commit(this.current, { animate: true, source: "local", overview: target });
    return this.inOverview;
  }

  getState(): BangState {
    return { ...this.current };
  }

  getPath(): StopInfo[] {
    return this.path.stops.map((stop, index) => {
      const rect = this.rectFor({ stop: index, step: 0 }, false) ?? { x: 0, y: 0, w: FRAME_WIDTH, h: FRAME_HEIGHT };
      return {
        index,
        kind: stop.kind,
        frame: stop.kind === "overview" ? undefined : stop.frame,
        steps: stop.steps,
        notes: this.notes[index] ?? "",
        zoom: poseFor(rect, this.stageNow).zoom,
        rect,
      };
    });
  }

  /**
   * Waits for every component's latest render and for fonts. Call after `goto` resolves. `warnings` lists every problem
   * found in the deck: the runtime's console warnings, unknown `bang-*` tags, frames that overlap and frame content
   * larger than the frame.
   */
  async ready(opts?: { timeoutMs?: number; fontsTimeoutMs?: number }): Promise<ReadyReport> {
    const report = await collectReady(this, {
      ...opts,
      extraWarnings: [...this.themeWarnings, ...this.deckWarnings(), ...unknownTagWarnings(this), ...overlapWarnings(this.frames)],
    });
    this.refreshPose();
    const warnings = new Set([...report.warnings, ...frameOverflowWarnings(this.frames)]);
    return { ...report, warnings: [...warnings] };
  }


  private showStatus(text: string): void {
    this.statusText = text;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusText = "";
    }, STATUS_MS);
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    if (isEditable(event.composedPath()[0] ?? event.target)) return;
    const last = this.path.stops.length - 1;
    let action: (() => unknown) | null = null;
    switch (event.key) {
      case "ArrowRight":
      case " ":
      case "PageDown":
      case "Enter":
        action = () => this.next();
        break;
      case "ArrowLeft":
      case "Backspace":
      case "PageUp":
        action = () => this.prev();
        break;
      case "Home":
        action = () => this.goto(0, 0);
        break;
      case "End":
        action = () => this.goto(Math.max(last, 0), "last");
        break;
      case "Escape":
      case "o":
        action = () => this.overview();
        break;
      case "p":
        if (this.mode === "presenter") break;
        action = () => {
          if (!openPresenter()) this.showStatus("Presenter view could not be opened (popup blocked or unsupported).");
        };
        break;
      case "f":
        action = () => {
          const request = document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen();
          request.catch(() => undefined);
        };
        break;
    }
    if (!action) return;
    event.preventDefault();
    void action();
  }
}

function groundFor(frames: FrameEntry[]): { rect: Rect; roads: { x1: number; y1: number; x2: number; y2: number }[] } | null {
  if (frames.length === 0) return null;
  const b = boundsOf(frames.map((f) => f.rect));
  const rect = { x: b.x - MAP_MARGIN, y: b.y - MAP_MARGIN, w: b.w + 2 * MAP_MARGIN, h: b.h + 2 * MAP_MARGIN };
  const byId = new Map(frames.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const roads: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const f of frames) {
    for (const other of (f.el.getAttribute("link") ?? "").split(/\s+/).filter(Boolean)) {
      const to = byId.get(other);
      if (!to) {
        warnOnce(`link|${f.id}|${other}`, `[banger] bang-frame "${f.id}" links to "${other}", which is not a bang-frame id; no road is drawn`);
        continue;
      }
      const key = [f.id, other].sort().join("\0");
      if (seen.has(key) || to === f) continue;
      seen.add(key);
      roads.push({
        x1: f.rect.x + f.rect.w / 2,
        y1: f.rect.y + f.rect.h / 2,
        x2: to.rect.x + to.rect.w / 2,
        y2: to.rect.y + to.rect.h / 2,
      });
    }
  }
  return { rect, roads };
}

function stepsNeeded(frame: Element): number {
  let needed = 0;
  for (const el of frame.querySelectorAll("*")) {
    const data = Number(el.getAttribute("data-step"));
    if (el.hasAttribute("data-step") && Number.isFinite(data)) needed = Math.max(needed, data);
    const count = (el as { stepCount?: unknown }).stepCount;
    if (typeof count === "number") needed = Math.max(needed, count);
  }
  return needed;
}

defineOnce("bang-root", BangRoot);
