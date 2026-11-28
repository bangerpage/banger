# Changelog

## 0.2.4

### CLI (`@bangerpage/cli`)

- `banger feedback new` writes a draft of your experience with Banger in a temporary directory, and `banger feedback send <file>` shows the final text and sends it as a public GitHub issue (`--via gh`, or `--via web` to submit by hand) or anonymously to the banger.page feedback inbox (`--via inbox`). It stops when the draft holds a token or key (including a banger.page token for any host, and one split over lines), an absolute path, an email address, this computer's account name, or a control character that could hide part of a line from the person checking it.
- `snap`, `check` and `export` start the browser with its sandbox on (it was off before), so a deck's scripts stay inside it. `BANGER_NO_SANDBOX=1` turns it off where it cannot start, such as as root in a container.
- `banger preview` no longer serves a file through a symbolic link that points outside the deck's folder.
- `snap` and `export` check the languages and step counts the page reports before using them in file names, so a script on the page cannot make them write outside the output folder.
- `banger preview` answers only requests addressed to `127.0.0.1` or `localhost`, so another website cannot read the deck folder through DNS rebinding. `--allow-host <name>` adds a name, for viewing through a proxy such as `tailscale serve`. A refused name is printed once with the `--allow-host` option to add it. It no longer serves dotfiles or `node_modules`.
- `banger login` and `banger feedback --via web` open URLs that contain `&` correctly on Windows.

### Skill

- The skill describes what to do after a deck is finished: write a feedback draft, have the person check it for confidential information, and send it only when they ask.

## 0.2.3

### Runtime (`@bangerpage/core`)

- `bang-root` takes `motion="smooth|swift|none"`. `smooth` (the default) keeps the current camera moves. `swift` moves quickly and does not pull back on long moves. `none` switches stops with no motion, like turning pages, and also stops the fades of steps and spotlights. When the viewer's system asks for reduced motion, every deck switches without motion.
- The presenter window has a Reset button next to the elapsed time.
- In `banger preview`, the presenter window shows the banger.page account you are logged in with and, for `index.html`, the deck's visibility, version and URL there.
- A value that the author writes inline on `bang-root` for `--bang-duration-fast` or `--bang-duration-slow` comes back when motion is turned on again.
- A resize during a camera move no longer leaves `goto()` and `next()` waiting.

### CLI (`@bangerpage/cli`)

- `banger preview` looks up the account and the deck status for the presenter window. It uses the stored token on the server side, so the token never reaches the browser.
- Calls to the banger.page API time out after 60 seconds. A response that is not JSON is reported as an error from the site.
- `banger preview` no longer stops when a file it is serving is removed.

### Skill

- The skill describes `motion`.

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
