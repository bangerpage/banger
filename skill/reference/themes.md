# カスタムテーマ

発表の色とフォントを自分用に決めたいときに読む。色コードを書いてよい場所は、テーマ定義 (`bang-theme` の中の JSON) だけ。発表の本文 (`bang-title` や `bang-text` など) には色コードも `style` 属性も書かない。

## 書き方

`bang-root` に `theme="custom"` を書き、子に `bang-theme` を 1 つ置いて、中の `script type="application/json"` に JSON を書く。`bang-theme` は何も描かない。複数あるときは先頭の 1 つだけが使われる。

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

## キー

キーはすべて任意。書かなかった項目は土台 (`base`) の値になる。

- `base`: `light` または `dark` (既定 `light`)。
- 色の種: `paper` (地) `surface` (面) `ink` (本文) `inkMuted` (補足) `line` (罫線) `signal` (強調の塗り)。
- フォント: `fontSans` `fontDisplay` `fontMono`。
- `fontsHref`: Google Fonts の css2 の URL。

未知のキーは警告されて無視される。

## 色

- 色は `#RGB` か `#RRGGBB` だけ。`rgb()` や色名は警告されて無視される。
- `line-strong` `on-signal` `signal-text` `focus` は種から計算で決まり、書けない。
- 種を変えなければ土台の手選びの値が使われるので、`signal` のひな形はそのまま `theme="light"` と同じ見た目になる。

各色が画面のどこに出るか:

| 種 | 出る場所 |
|---|---|
| `paper` | フレームの地 |
| `ink` | 本文と見出しの文字、グラフの 1 本目の系列 |
| `inkMuted` | `tone="muted"` の文字、グラフの 3 本目の系列 |
| `signal` | `tone="accent"` の文字とグラフの 2 本目の系列 (どちらも `signal` から作った `signal-text` で塗る) |
| `line` | 俯瞰と 16:9 の外側に見えるキャンバスの地、グラフの罫線 |
| `surface` | 今の部品では使われていない |

## コントラスト

次の基準を割ると警告が出る。自動では直らず、書いた色のまま描画される。警告は `banger snap` の `warning:` 行に出る (`ready()` の警告と同じもの)。

- `ink` と `paper` が 4.5:1 以上。
- `inkMuted` と `paper` が 4.5:1 以上。
- `signal` と `paper` が 3:1 以上。

警告が出たら、種を直して `banger snap` で確かめる。

## フォント

- `fontSans` `fontDisplay` `fontMono` は CSS の font-family の並び。使える文字は、名前、引用符、カンマ、ハイフン、ピリオド、空白だけで、300 文字まで。末尾に generic family (`sans-serif` `serif` `monospace`) を入れる。
- 書体を読み込むときは `fontsHref` に Google Fonts の css2 の URL (`https://fonts.googleapis.com/css2?family=...`) を書く。パラメータは `family` と `display` だけ。他のホストの URL は警告されて無視される。
- `fontsHref` に書いたファミリ名を `fontSans` などの先頭に書く。書き出し (`snap` と `export`) は読み込み完了を待ってから撮る。

```json
{
  "fontsHref": "https://fonts.googleapis.com/css2?family=M+PLUS+1p:wght@400;700&display=swap",
  "fontSans": "\"M PLUS 1p\", sans-serif"
}
```

## 色を提案するとき

利用者が色を指定しなくても、色を提案してよい。

1. 下の 4 つのひな形から、発表の性格に近いものを選んで始める。ゼロから色を作らない。
2. 変えたい種だけを書く。書かない種は土台の値になる。
3. 色コードは `bang-theme` の JSON だけに書く。本文には書かない。
4. `banger snap` で全停止点を見て、読めない箇所と警告がないことを確かめる。

## コマンド

- `banger theme init [file] [--from <preset>] [--force]`: ひな形から `theme.json` を作る。既定は `signal` で、ファイル名は `theme.json`。既存のファイルは `--force` が無いと上書きしない。
- `banger theme apply <theme.json> <deck.html>`: `theme.json` を検証して発表に埋め込む。`bang-root` を `theme="custom"` にし、`bang-theme` のブロックを挿入または置換する。2 回実行しても結果は同じ。テーマを直したら各発表に `apply` し直す。
- 警告 (未知のキー、コントラスト不足など) は `warning:` で stderr に出る。

## ひな形

4 つとも、種の色はコントラストの基準を満たし、警告は出ない。

### signal

Signal の既定。白に近い紙色の地に、橙の signal。迷ったらこれから始める。

```json
{
  "base": "light",
  "paper": "#F6F5F1",
  "surface": "#FFFFFF",
  "ink": "#141414",
  "inkMuted": "#55534E",
  "line": "#E2E0D9",
  "signal": "#FF4A1C",
  "fontSans": "\"Noto Sans JP\", system-ui, -apple-system, \"Hiragino Sans\", sans-serif",
  "fontDisplay": "\"Bricolage Grotesque\", \"Noto Sans JP\", system-ui, sans-serif",
  "fontMono": "\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace"
}
```

### signal-dark

Signal の暗い版。ほぼ黒の地に、橙の signal。

```json
{
  "base": "dark",
  "paper": "#141414",
  "surface": "#1E1E1D",
  "ink": "#F6F5F1",
  "inkMuted": "#CFCBC2",
  "line": "#2E2D2B",
  "signal": "#FF4A1C",
  "fontSans": "\"Noto Sans JP\", system-ui, -apple-system, \"Hiragino Sans\", sans-serif",
  "fontDisplay": "\"Bricolage Grotesque\", \"Noto Sans JP\", system-ui, sans-serif",
  "fontMono": "\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace"
}
```

### sunshine

黄色の明るいブランド地。濃い赤橙の signal。

```json
{
  "base": "light",
  "paper": "#FFD83D",
  "surface": "#FFE680",
  "ink": "#141414",
  "inkMuted": "#3D3A2E",
  "line": "#E5B800",
  "signal": "#C8260A",
  "fontSans": "\"Noto Sans JP\", system-ui, -apple-system, \"Hiragino Sans\", sans-serif",
  "fontDisplay": "\"Bricolage Grotesque\", \"Noto Sans JP\", system-ui, sans-serif",
  "fontMono": "\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace"
}
```

### midnight

暗い紺の地に琥珀の signal。

```json
{
  "base": "dark",
  "paper": "#0F1B2D",
  "surface": "#172840",
  "ink": "#F2F5FA",
  "inkMuted": "#B8C4D6",
  "line": "#26384F",
  "signal": "#FFB000",
  "fontSans": "\"Noto Sans JP\", system-ui, -apple-system, \"Hiragino Sans\", sans-serif",
  "fontDisplay": "\"Bricolage Grotesque\", \"Noto Sans JP\", system-ui, sans-serif",
  "fontMono": "\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace"
}
```
