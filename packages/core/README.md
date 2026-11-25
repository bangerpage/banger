# @bangerpage/core

The runtime for [Banger](https://github.com/bangerpage/banger): presentations written as one HTML file, with frames on a canvas and a camera that stops at each point.

Load it from a CDN with the exact version, then write the deck with `bang-*` elements:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@bangerpage/core@0.1.1/dist/index.js"></script>
<bang-root theme="light">
  <bang-frame id="intro" at="0,0"><bang-title>Hello</bang-title></bang-frame>
  <bang-path>
    <bang-stop frame="intro"></bang-stop>
  </bang-path>
</bang-root>
```

The elements and their attributes are listed in `custom-elements.json` and in the repository's `skill/reference/components.md`. Opening a deck loads fonts from Google Fonts. Versions, themes and the CLI (`@bangerpage/cli`) are described in the repository README.

License: MIT. The package bundles Lit and Apache ECharts; see `THIRD-PARTY-LICENSES.txt` and `NOTICE`.
