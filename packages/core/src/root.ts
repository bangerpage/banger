import { css, html, unsafeCSS, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { pick, warnOnce } from "./attrs.js";
import {
  boundsOf,
  clipFor,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  layoutFrames,
  poseFor,
  regionRect,
  retarget,
  sample,
  stageSize,
  toTransform,
  type CameraPose,
  type CameraTween,
  type Rect,
  type Size,
} from "./camera.js";
import { ensureBaseStyle, ensureThemeFonts } from "./base-style.js";
import { BangElement, defineOnce, type StepAware } from "./element.js";
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
  kind: "frame" | "region" | "overview";
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
const STATUS_MS = 4000;
const FULL_STAGE: Size = { w: FRAME_WIDTH, h: FRAME_HEIGHT };

function modeOf(): RootMode {
  const mode = new URLSearchParams(location.search).get("mode");
  return mode === "export" || mode === "presenter" ? mode : "live";
}

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
        <div class="stage" style="width:${this.stage.w}px;height:${this.stage.h}px">
          <div class="clip">
            <div class="canvas"><slot @slotchange=${this.onSlotChange}></slot></div>
          </div>
        </div>
      </div>
      <div class="status" role="status">${this.statusText}</div>`;
  }

  private onSlotChange = () => {
    this.applyTheme();
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
    for (const [name, value] of Object.entries(vars)) this.style.setProperty(name, value);
    this.themeVars = Object.keys(vars);
    this.applyFrameTones(resolved.colors);
    if (resolved.fontsRequest) ensureThemeFonts(resolved.fontsRequest);
    report(warnings);
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
    const rects = layoutFrames(entries, FRAME_GAP);
    this.frameMap = rects;
    this.frames = entries.map((e) => ({ el: e.el, id: e.id, rect: rects[e.id] }));
    for (const f of this.frames) {
      f.el.style.setProperty("--bang-frame-x", `${f.rect.x}px`);
      f.el.style.setProperty("--bang-frame-y", `${f.rect.y}px`);
      f.el.style.setProperty("--bang-frame-w", `${f.rect.w}px`);
      f.el.style.setProperty("--bang-frame-h", `${f.rect.h}px`);
    }

    const stops: StopModel[] = [];
    const notes: string[] = [];
    for (const el of this.querySelectorAll("bang-path > bang-stop")) {
      const read = readStop(el);
      let stop = read.stop;
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
    const bounds = all.length > 0 ? boundsOf(all) : { x: 0, y: 0, w: FRAME_WIDTH, h: FRAME_HEIGHT };
    const stop = this.path.stops[state.stop];
    if (overview || !stop || stop.kind === "overview" || stop.frame === undefined) return bounds;
    const frame = this.frameMap[stop.frame];
    if (!frame) return null;
    return stop.kind === "region" && stop.region ? regionRect(frame, stop.region) : frame;
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
  }

  private applyClip(): void {
    const clip = this.renderRoot.querySelector<HTMLElement>(".clip");
    if (!clip) return;
    const rect = this.rectFor(this.current, this.inOverview);
    if (this.mode !== "export" || !rect) {
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
    for (const f of this.frames) {
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
    this.applySteps();
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

  /** Waits for every component's latest render and for fonts. Call after `goto` resolves. */
  ready(opts?: { timeoutMs?: number; fontsTimeoutMs?: number }): Promise<ReadyReport> {
    return collectReady(this, { ...opts, extraWarnings: this.themeWarnings });
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
