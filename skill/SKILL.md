---
name: banger
description: HTML 1 枚で「めくらない」プレゼンテーション (キャンバス上のフレームと、カメラが止まる停止点の列) を作る。発表資料・スライド・プレゼンを HTML で作る、直す、書き出す依頼で使う。
---

# Banger でプレゼンを作る

発表を 1 つの HTML にする。フレーム (`bang-frame`) をキャンバスに並べ、カメラが止まる停止点 (`bang-stop`) の列で見せる順を決める。部品とその属性は `reference/components.md`、定番の組み立ては `reference/patterns.md`、色とフォントを決めるカスタムテーマは `reference/themes.md`、最小の動く HTML は `templates/starter.html` にある。

## 作業の流れ

1. 発表のアウトラインを、停止点の列として人と合意する。どのフレームをどの順で見せ、どこで寄り、どこで俯瞰に戻るかを先に決める。
2. `templates/starter.html` をコピーして元にし、フレームと停止点を書く。部品と属性は `reference/components.md` にあるものだけを使う。
3. `banger dev <file>` でプレビューして動きを確認する。
4. `banger snap <file>` で全停止点を画像にして目で見る。はみ出しや読めない箇所を探す。
5. 直して 3 に戻る。

## 原則

- 値は属性のトークンから選ぶ (`size="l"` `tone="accent"` `gap="m"` など)。属性に無い値は書かない。
- `style` 属性を書かない (`bang-free` の中だけは、配置の px のために書いてよい)。色コードも発表本文には書かない。色コードを書いてよいのはテーマ定義 (`bang-theme` の JSON と `theme.json`) だけ。色は利用者が指定しなくても提案してよいが、出発点は同梱のひな形 (`reference/themes.md`) から選ぶ。
- 文中の強調は `<b>` (太字)、`<mark>` (マーカー)、意図した改行は `<br>`、引用や出典の原文の斜体は `<i>` だけを使う。`strong` `em` `span` は使わず、属性も付けない。`<br>` で折り返しを調整しない。
- 流れの中の矢印と ○ ✖ の記号は `bang-shape` を使う。文字の ↑ ↓ ✖ ○ で代わりにしない (字形がフォントで変わる)。
- 内容はフレームの外へ出さない。入りきらないときはフレームを分けるか、文を減らす。
- フレームの中身は上下の中央に置かれる。先頭が `bang-title` なら、タイトルは上に残り、残りがその下の中央に来る。タイトルもまとめて中央に置きたいとき (表紙や締めの一言) は、`bang-stack` で包む。
- 表紙で題名を上端、名前などを下端に分けたいときは、フレームに `valign="spread"` を書き、題名のまとまりと名前のまとまりを 2 つの子 (`bang-stack`) にする。カードの中身を縦中央に置くときは `bang-card` に `valign="center"`、上・中・下に散らすときは `valign="spread"` を書く。
- アニメーションは部品の `step` (`bang-list` `bang-chart`) か `data-step` で行う。CSS や JS で動かさない。
- 発表者ノートは停止点の中の `bang-notes` に書く。
- `theme.json` があれば `banger theme apply` で発表に入れる。色を発表に直接書かない。

## コマンド

- `banger dev <file>`: プレビューとライブリロード。
- `banger snap <file> [--stop N] [--step M|last] [--out path] [--out-dir dir] [--scale 1|2]`: 状態を 1920x1080 の PNG にする。停止点を省くと全停止点を出す。自分で見て直すために使う。
- `banger export <file> --pdf [--out path] [--steps last|all]`: 停止点ごとに 1 ページの PDF にする。
- `banger theme init [file] [--from <preset>] [--force]`: 同梱のひな形 (`signal` `signal-dark` `sunshine` `midnight`) から `theme.json` を作る。
- `banger theme apply <theme.json> <deck.html>`: `theme.json` を発表に埋め込み、`theme="custom"` にする。何度実行しても結果は同じ。

## エスケープハッチ

`bang-free` (自由な HTML・CSS・SVG を書く箱) は、部品に無い図 (地図・曲線の矢印・丸囲み・重ねる注記) に使う。部品で書けるものは部品を先に使う。繰り返し使った形は部品の候補として人に伝える。

- 中身は `bang-free` の直下にルート要素を 1 つ置き、規則は直下の `<style>` に書く。規則はその `bang-free` の中だけに効く。 ルート要素は箱の高さいっぱいに伸びる。コードの箱のように内容の高さにしたいものは、`<div>` で包んでその中に置く。
- 色はテーマの変数だけで書く。文字や線は `var(--bang-color-*)` と `color-mix(in srgb, var(--bang-color-ink) 60%, transparent)`、帯と同じ塗りは `var(--bang-band-ground)`、表紙の塗りは `var(--bang-cover-ground)`。色コードは書かない。
- `style` 属性は配置の px のためだけに、`bang-free` の中で書いてよい。`<script>` は書かない。
- 位置は grid と、1 つのセルへの重ね (`grid-area: 1 / 1`) を先に考え、絶対座標は最後に使う。座標は `banger snap` の画像を見て直す。
- 他の内容の上に注記や矢印を重ねるときは、フレームの最後の子に `overlay` つきの `bang-free` を 1 つ置く。座標はフレームの左上が原点の px (1920×1080)。先頭の子にしない。
- 箱の中の図を座標で組むときは、箱の大きさに頼らない。SVG に `viewBox` (元の図の座標) を書いて `width: 100%; height: 100%` で箱に合わせる。縦横比を保つなら `preserveAspectRatio` は既定のまま、箱いっぱいに伸ばすなら `none`。図をフレームの px で置きたいときは `overlay` を使う。
- ページの大半を占める図 (地図など) は、`overlay` の中に `viewBox="0 0 1920 1080"` の SVG を置くと、縮尺がかからず元の座標のまま描ける。`overlay` は注記だけでなく、ページの図そのものにも使ってよい。下地にカードの面が要るときは、中身のない `bang-card grow` をフレームに置き、その上に `overlay` で描く。流れの中の箱に縦横比を保って入れると、箱と縦横比が違う分だけ図が小さくなる。
- `viewBox` を図の範囲ちょうどにすると、端の文字のグリフが箱の外へ出てはみ出しの警告になる。上下左右に 10px ほど余白を足す。
- SVG の図形に帯や表紙のグラデーションを塗るときは、`fill` に変数を渡せないので、`<foreignObject>` の中の `div` の `background` に `var(--bang-band-ground)` を塗る。
- 箱の外へ 2px を超えて出た部分は切られる。はみ出しと色コードは `banger snap` の警告に出るので直す。
- `data-step` は中の要素にも効く。`id` はデッキ全体で一意にする。
