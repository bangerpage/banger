import type { ThemeDefinition } from "./custom.js";
import { themeColorTokens, themeFontStacks } from "./theme.generated.js";

export const PRESET_NAMES = ["signal", "signal-dark", "sunshine", "midnight"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export function isPresetName(value: string): value is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(value);
}

const fonts = () => ({
  fontSans: themeFontStacks.sans,
  fontDisplay: themeFontStacks.display,
  fontMono: themeFontStacks.mono,
});

function fromTokens(base: "light" | "dark"): ThemeDefinition {
  const c = themeColorTokens[base];
  return {
    base,
    paper: c.paper,
    surface: c.surface,
    ink: c.ink,
    inkMuted: c["ink-muted"],
    line: c.line,
    signal: c.signal,
    ...fonts(),
  };
}

/** A fresh object on every call, so callers may edit the result. */
export function presetTheme(name: PresetName): ThemeDefinition {
  switch (name) {
    case "signal":
      return fromTokens("light");
    case "signal-dark":
      return fromTokens("dark");
    case "sunshine":
      return {
        base: "light",
        paper: "#FFD83D",
        surface: "#FFE680",
        ink: "#141414",
        inkMuted: "#3D3A2E",
        line: "#E5B800",
        signal: "#C8260A",
        ...fonts(),
      };
    case "midnight":
      return {
        base: "dark",
        paper: "#0F1B2D",
        surface: "#172840",
        ink: "#F2F5FA",
        inkMuted: "#B8C4D6",
        line: "#26384F",
        signal: "#FFB000",
        ...fonts(),
      };
  }
}
