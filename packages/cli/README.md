# @bangerpage/cli

The `banger` command for [Banger](https://github.com/bangerpage/banger) presentations.

```
npm install -g @bangerpage/cli
cd my-talk          # a directory with index.html
banger preview      # preview with live reload
banger snap         # every stop as a 1920x1080 PNG
banger export --pdf # one PDF page per stop
banger skill install # give Claude Code the skill for writing decks
```

The CLI renders the deck with the `@bangerpage/core` it depends on and drives Chrome through `playwright-core`. If no browser is found it prints the command to install one. All commands and options are in the repository README.

License: MIT.
