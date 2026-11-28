# @bangerpage/cli

The `banger` command for [Banger](https://github.com/bangerpage/banger) presentations.

```
npm install -g @bangerpage/cli
banger init my-talk # write my-talk/index.html from the starter
cd my-talk
banger preview      # preview with live reload
banger check        # list the problems in every stop; exits 1 when there is any
banger snap         # every stop as a 1920x1080 PNG
banger export --pdf # one PDF page per stop
banger skill install # give Claude Code the skill for writing decks
banger feedback new # draft feedback for Banger after you finish a deck
```

The CLI renders the deck with the `@bangerpage/core` it depends on and drives Chrome through `playwright-core`. If no browser is found it prints the command to install one. All commands and options are in the repository README.

License: MIT.
