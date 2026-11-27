# Changelog

## 0.2.2

### Runtime (`@bangerpage/core`)

- Card shadows (`cardShadow: "soft"` and `"lift"`) are drawn without blur, so they print correctly in exported PDFs. Before, macOS Preview and some other viewers showed them as solid grey boxes around the cards.

### Skill

- The skill tells the agent not to write blurred shadows in `bang-free`, since they print as grey boxes in PDFs.

## 0.2.1

### Runtime (`@bangerpage/core`)

- `dist/standalone.js` is the runtime in one file, with the chart library inlined. Use it to inline the runtime into a deck's HTML or to open a saved copy offline. `dist/index.js` stays the usual entry.

### CLI (`@bangerpage/cli`)

- `banger check` no longer fails when web fonts cannot be loaded (for example on a network that blocks Google Fonts). It prints them as `note:` lines and checks the layout with the fallback fonts; `--json` lists them under `notes`.
- `banger skill pack` writes the skill as `banger-skill.zip`, which you can upload in the Claude app (claude.ai or Claude Desktop).
- `banger preview` and `banger check` treat a deck that loads `dist/standalone.js` like one that loads `dist/index.js`.

### Skill

- The repository is a Claude Code plugin marketplace. Install the skill with `/plugin marketplace add bangerpage/banger` and `/plugin install banger@bangerpage`.
- `reference/publishing.md` lists what a deck published on banger.page may load and do.
- Side-by-side cards stay top-aligned in stretched columns.

## 0.2.0

### Runtime (`@bangerpage/core`)

- Multilingual decks: list the languages on `bang-root` (`languages="ja en"`) and mark elements and notes with `lang`. Elements without `lang` show in every language. The language comes from `?lang=`, then the `l` key (synced with the presenter view), then the browser's languages, then the first listed language.
- The runtime warns about translation mistakes, such as a list that has fewer items in one language.

### CLI (`@bangerpage/cli`)

- `banger check` renders every language and names the language in each warning.
- `banger snap` and `banger export --pdf` take `--lang <language>|all`.
- `banger skill install` ends with what the skill can do and how to start.

### Skill

- The skill describes how to write and translate multilingual decks.
