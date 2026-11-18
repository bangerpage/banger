# Loader
ロゴの b が動くローディングアイコンです。ボタンを押した後の待ち、AIの生成や公開を待つあいだに使います。

## 5つの動き

| 名前 | クラス | 動き | 向いている場面 |
| --- | --- | --- | --- |
| M1 Pulse | `bang-loader--m1` | 停止点が脈打つ | 標準。ボタンの中、短い待ち |
| M2 Pan | `bang-loader--m2` | 停止点が画面の中を左右に移動して止まる | 書き出し（PDF・画像）の待ち |
| M3 Hop | `bang-loader--m3` | b が跳ねる。停止点が少し遅れてついてくる | ページの読み込み、公開の待ち |
| M4 Zoom | `bang-loader--m4` | カメラが停止点に寄り、b が戻ってくる | 発表を開くとき |
| M5 Bang | `bang-loader--m5` | 停止点が画面から飛び出して弾ける | AIの生成など長い待ち。完了の直前の演出 |

## マークアップ

5つとも同じSVGで、クラスだけを替えます。`aria-label` は状況に合わせて書き換えます（「書き出し中」など）。

```html
<svg class="bang-loader bang-loader--m1" viewBox="0 0 64 64" role="img" aria-label="読み込み中">
  <g class="bang-loader__b">
    <path class="bang-loader__stem" d="M6 7.5 A5.5 5.5 0 0 1 17 7.5 L17 25.5 L6 25.5 Z"/>
    <path class="bang-loader__bowl" fill-rule="evenodd" d="M6 25 L46 25 A12 12 0 0 1 58 37 L58 48 A12 12 0 0 1 46 60 L18 60 A12 12 0 0 1 6 48 Z M20 34 L44 34 A3 3 0 0 1 47 37 L47 48 A3 3 0 0 1 44 51 L20 51 A3 3 0 0 1 17 48 L17 37 A3 3 0 0 1 20 34 Z"/>
  </g>
  <circle class="bang-loader__dot" cx="32" cy="42.5" r="4.5"/>
  <g class="bang-loader__spark"><path d="M46 5 V1"/><path d="M53 12 H57"/><path d="M39 12 H35"/><path d="M51 7 L54 4"/><path d="M41 7 L38 4"/></g>
</svg>
```

## 使い方

- 大きさは `bang-loader--sm`（16px）、標準（24px）、`--lg`（48px）、`--xl`（96px）。16pxでは M1 か M2 を使います（ほかは動きが小さすぎて読めません）。
- 色は字形が `ink`（`color` で変えられます）、停止点が `signal`。`signal` の地（主ボタンなど）の上では `bang-loader--mono` を付け、全体を `on-signal` の色にします。
- 1つの画面に出すローディングは1つだけ。複数の待ちがあっても、まとめて1つで表します。
- 待ちが400msより短いときは出しません（ちらつくため）。表示したら最低600msは出しておきます。
- 横には「書き出しています」のように、何を待っているかを短く添えます。ボタンの中ではラベルを残し、ローディングをラベルの前に置きます。
- 動きを減らす設定（`prefers-reduced-motion`）では、どのパターンも動かず、停止点がゆっくり明滅するだけになります。
- 初回のページ読み込みで中身の場所を埋める用途には使いません。
