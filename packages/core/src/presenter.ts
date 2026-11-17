import { html, type TemplateResult } from "lit";
import type { BangState } from "./state.js";

interface StateMessage {
  type: "state";
  stop: number;
  step: number;
  sender: string;
}

/** Keeps the audience window and the presenter window on the same state. Received states are never re-sent. */
export class PresenterSync {
  private readonly channel: BroadcastChannel;
  private readonly id = Math.random().toString(36).slice(2);

  constructor() {
    this.channel = new BroadcastChannel(`bang:${location.origin}${location.pathname}`);
  }

  send(state: BangState): void {
    const message: StateMessage = { type: "state", stop: state.stop, step: state.step, sender: this.id };
    this.channel.postMessage(message);
  }

  onRemote(callback: (state: BangState) => void): void {
    this.channel.addEventListener("message", (event: MessageEvent<StateMessage>) => {
      const data = event.data;
      if (data?.type === "state" && data.sender !== this.id) callback({ stop: data.stop, step: data.step });
    });
  }

  close(): void {
    this.channel.close();
  }
}

export interface PresenterView {
  stop: number;
  stopCount: number;
  step: number;
  steps: number;
  notes: string;
  elapsedMs: number;
  onPrev: () => void;
  onNext: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function renderPresenter(view: PresenterView): TemplateResult {
  return html`<div class="presenter">
    <div class="presenter-head">
      <span class="presenter-stop">Stop ${view.stop + 1} / ${view.stopCount}</span>
      <span class="presenter-step">Step ${view.step + 1} / ${view.steps + 1}</span>
      <span class="presenter-elapsed">${formatElapsed(view.elapsedMs)}</span>
    </div>
    <div class="presenter-notes">${view.notes}</div>
    <div class="presenter-buttons">
      <button type="button" @click=${view.onPrev}>Previous</button>
      <button type="button" @click=${view.onNext}>Next</button>
    </div>
  </div>`;
}

export function openPresenter(): Window | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const url = new URL(location.href);
  url.searchParams.set("mode", "presenter");
  return window.open(url.toString(), "bang-presenter", "popup,width=1100,height=720");
}
