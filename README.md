Banger
======

Banger is an open-source library for presentations written as a single HTML file: frames on a canvas, and a camera that moves between stops.

License: MIT

## Packages

- `packages/core` (`@bangerpage/core`): the runtime (custom elements, camera, state) and its theme.
- `packages/cli` (`@bangerpage/cli`): the `banger` command and a library entry for `dev`, `snap` and PDF export.
- `skill/`: the AI skill (`SKILL.md`, component reference, patterns, starter template).
- `examples/minimal`: a small deck that shows the main components.

## Usage

Write one HTML file and load the runtime with a single line (see `skill/templates/starter.html`):

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@bangerpage/core@0.1.0/dist/index.js"></script>
<bang-root theme="light">
  <bang-frame id="intro" at="0,0"><bang-title>Hello</bang-title></bang-frame>
  <bang-path>
    <bang-stop frame="intro"><bang-notes>Say hello</bang-notes></bang-stop>
  </bang-path>
</bang-root>
```

The available elements and their attributes are listed in `skill/reference/components.md`.

## Custom theme

Set `theme="custom"` on `bang-root` and put a `bang-theme` child with a JSON script. Keys you leave out take the values of `base` (`light` or `dark`).

```html
<bang-root theme="custom">
  <bang-theme>
    <script type="application/json">
      { "base": "dark", "paper": "#0F1B2D", "ink": "#F2F5FA", "signal": "#FFB000" }
    </script>
  </bang-theme>
  ...
</bang-root>
```

To reuse one look across decks, keep a `theme.json` and run `banger theme init` once, then `banger theme apply theme.json deck.html` for each deck. Colors are checked for contrast when the deck is rendered, and `banger snap` prints a `warning:` line for unreadable combinations.

## CLI

- `banger dev <file>`: preview with live reload. The runtime URL in the HTML is served from the bundled core, so it works offline and before publishing.
- `banger snap <file> [--stop N] [--step M|last] [--out path] [--out-dir dir] [--scale 1|2]`: render states as 1920x1080 PNG files. Without `--stop` every stop is written.
- `banger export <file> --pdf [--out path] [--steps last|all]`: one PDF page per stop, with vector text.
- `banger theme init [file] [--from <preset>] [--force]`: write a `theme.json` from a bundled preset (`signal`, `signal-dark`, `sunshine`, `midnight`).
- `banger theme apply <theme.json> <deck.html>`: embed the theme in a deck and set `theme="custom"`. Running it again gives the same result.

The CLI drives Chrome through `playwright-core`. If no browser is found it prints the command to install one and exits with code 2.

### As a library

```ts
import { exportPdf } from "@bangerpage/cli";

const path = await exportPdf("deck.html", { steps: "last" });
```

`exportPdf` resolves with the absolute path of the written PDF. Failures throw a `CliError` whose `exitCode` is the code the command would exit with (1 for a deck that fails to render, 2 for bad input). Pass `onWarning` to receive warnings such as a runtime version mismatch instead of having them written to stderr.

## Development

```
pnpm install
pnpm gen         # regenerate the theme, custom-elements.json and the skill files
pnpm typecheck
pnpm build
pnpm test
pnpm -C packages/core exec playwright-core install chromium   # once, for the e2e tests
pnpm test:e2e
```

Generated files (`skill/reference/components.md`, the runtime URL in the starter, the example and the CLI fixtures) are committed. After changing a component's attributes or JSDoc, run `pnpm gen` and commit the result; CI runs `pnpm gen:check`.

## Release

Publishing is done by a person with `pnpm -r publish`. Before publishing, `pnpm gen:check`, `pnpm build` and `pnpm test:e2e` must all pass.
