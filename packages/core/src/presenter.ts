import { html, type TemplateResult } from "lit";
import { initialsOf, type PresenterAccount, type PresenterDeck, type PresenterStatus } from "./presenter-status.js";
import type { BangState } from "./state.js";

interface StateMessage {
  type: "state";
  stop: number;
  step: number;
  sender: string;
}

interface LanguageMessage {
  type: "lang";
  lang: string;
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

  sendLanguage(lang: string): void {
    const message: LanguageMessage = { type: "lang", lang, sender: this.id };
    this.channel.postMessage(message);
  }

  onRemoteLanguage(callback: (lang: string) => void): void {
    this.channel.addEventListener("message", (event: MessageEvent<StateMessage | LanguageMessage>) => {
      const data = event.data;
      if (data?.type === "lang" && data.sender !== this.id) callback(data.lang);
    });
  }

  onRemote(callback: (state: BangState) => void): void {
    this.channel.addEventListener("message", (event: MessageEvent<StateMessage | LanguageMessage>) => {
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
  language?: string;
  elapsedMs: number;
  status?: PresenterStatus;
  onPrev: () => void;
  onNext: () => void;
  onResetTimer: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const ACCOUNT_NOTES = {
  logged_out: "Not logged in to banger.page",
  invalid: "banger.page did not accept the token (run banger login)",
  unavailable: "banger.page is not reachable",
} as const;

function renderAccount(account: PresenterAccount): TemplateResult {
  if (account.state !== "logged_in") return html`<span class="presenter-note">${ACCOUNT_NOTES[account.state]}</span>`;
  return html`<span class="presenter-avatar">${initialsOf(account)}${account.avatarUrl
      ? html`<img class="presenter-avatar-img" referrerpolicy="no-referrer" alt="" src=${account.avatarUrl} @error=${(event: Event) => ((event.target as HTMLImageElement).hidden = true)} />`
      : ""}</span>
    <span class="presenter-user" title=${`@${account.username}`}>${account.displayName ?? `@${account.username}`}</span>`;
}

function renderDeck(deck: PresenterDeck): TemplateResult | "" {
  switch (deck.state) {
    case "none":
      return "";
    case "published":
      return html`<span class="presenter-visibility" data-visibility=${deck.visibility}>${deck.visibility === "unlisted" ? "Unlisted (link only)" : "Public"}</span>
        ${deck.version !== undefined ? html`<span class="presenter-version">v${deck.version}</span>` : ""}
        ${deck.url ? html`<span class="presenter-deck-url">${deck.url}</span>` : ""}`;
    case "unpublished":
      return html`<span class="presenter-deck-note">Unpublished${deck.url ? ` ${deck.url}` : ""}</span>`;
    case "missing":
      return html`<span class="presenter-deck-note">Not found on banger.page (the local record is out of date)</span>`;
    case "unverified":
      return html`<span class="presenter-deck-note">Last published from this folder: ${deck.url ? `${deck.url} ` : ""}(not verified)</span>`;
  }
}

export function renderPresenter(view: PresenterView): TemplateResult {
  return html`<div class="presenter">
    <div class="presenter-head">
      <span class="presenter-stop">Stop ${view.stop + 1} / ${view.stopCount}</span>
      <span class="presenter-step">Step ${view.step + 1} / ${view.steps + 1}</span>
      ${view.language !== undefined ? html`<span class="presenter-language">${view.language}</span>` : ""}
      <span class="presenter-timer">
        <span class="presenter-elapsed">${formatElapsed(view.elapsedMs)}</span>
        <button type="button" class="presenter-reset" @click=${view.onResetTimer}>Reset</button>
      </span>
    </div>
    ${view.status ? html`<div class="presenter-account">${renderAccount(view.status.account)}${renderDeck(view.status.deck)}</div>` : ""}
    <div class="presenter-notes">${view.notes}</div>
    <div class="presenter-buttons">
      <button type="button" class="presenter-prev" @click=${view.onPrev}>Previous</button>
      <button type="button" class="presenter-next" @click=${view.onNext}>Next</button>
    </div>
  </div>`;
}

export function openPresenter(): Window | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const url = new URL(location.href);
  url.searchParams.set("mode", "presenter");
  return window.open(url.toString(), "bang-presenter", "popup,width=1100,height=720");
}
