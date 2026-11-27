---
name: banger
description: HTML 1 枚で「めくらない」プレゼンテーション (キャンバス上のフレームと、カメラが止まる停止点の列) を作る。発表資料・スライド・プレゼンを HTML で作る、直す、書き出す依頼で使う。
---

# Banger でプレゼンを作る

発表を 1 つの HTML にする。フレーム (`bang-frame`) をキャンバスに並べ、カメラが止まる停止点 (`bang-stop`) の列で見せる順を決める。部品とその属性は `reference/components.md`、定番の組み立ては `reference/patterns.md`、色とフォントを決めるカスタムテーマは `reference/themes.md`、banger.page に公開する発表で守ることは `reference/publishing.md`、最小の動く HTML は `templates/starter.html` にある。

## 作業の流れ

1. 発表のアウトラインを、停止点の列として人と合意する。どのフレームをどの順で見せ、どこで寄り、どこで俯瞰に戻るかを先に決める。
2. 発表ごとにディレクトリを 1 つ作り、`templates/starter.html` をその中の `index.html` にコピーして元にし、フレームと停止点を書く。部品と属性は `reference/components.md` にあるものだけを使う。
3. そのディレクトリで `banger preview` を実行し、ブラウザでプレビューして動きを確認する。
4. `banger check` で問題の一覧を出し、出たものを直す。問題が無ければ終了コードは 0 になる。
5. `banger snap` で全停止点を画像にして目で見る。check では分からない、見た目の崩れを探す。
6. 直して 3 に戻る。

## 原則

- 値は属性のトークンから選ぶ (`size="l"` `tone="accent"` `gap="m"` など)。属性に無い値は書かない。
- `style` 属性を書かない (`bang-free` の中だけは、配置の px のために書いてよい)。色コードも発表本文には書かない。色コードを書いてよいのはテーマ定義 (`bang-theme` の JSON と `theme.json`) だけ。色は利用者が指定しなくても提案してよいが、出発点は同梱のひな形 (`reference/themes.md`) から選ぶ。
- 文中の強調は `<b>` (太字)、`<mark>` (マーカー)、意図した改行は `<br>`、引用や出典の原文の斜体は `<i>` だけを使う。`strong` `em` は使わず、`span` は多言語の発表で言語を切り替える `<span lang>` のときだけ使う。それ以外の属性は付けない。`<br>` で折り返しを調整しない。
- 流れの中の矢印と ○ ✖ の記号は `bang-shape` を使う。文字の ↑ ↓ ✖ ○ で代わりにしない (字形がフォントで変わる)。
- 内容はフレームの外へ出さない。入りきらないときはフレームを分けるか、文を減らす。
- フレームの中身は上下の中央に置かれる。先頭が `bang-title` なら、タイトルは上に残り、残りがその下の中央に来る。タイトルもまとめて中央に置きたいとき (表紙や締めの一言) は、`bang-stack` で包む。
- 表紙で題名を上端、名前などを下端に分けたいときは、フレームに `valign="spread"` を書き、題名のまとまりと名前のまとまりを 2 つの子 (`bang-stack`) にする。カードの中身を縦中央に置くときは `bang-card` に `valign="center"`、上・中・下に散らすときは `valign="spread"` を書く。
- アニメーションは部品の `step` (`bang-list` `bang-chart`) か `data-step` で行う。CSS や JS で動かさない。停止点の `steps` は書かない。省くと、そのフレームを最初に映す停止点が中身の数だけ順に出し、同じフレームの後の停止点は順に出さない。違う数にしたいときだけ書く。
- 発表者ノートは停止点の中の `bang-notes` に書く。
- `theme.json` があれば `banger theme apply` で発表に入れる。色を発表に直接書かない。

## 多言語の発表

1 つの deck に複数の言語を、同じ場所の兄弟として書く。構成 (フレーム・停止点・段・テーマ) は 1 つで、見る人と発表者が言語を切り替える。`bang-root` の `languages="ja en"` に言語を空白区切りで並べ、先頭が作者の言語になる。フレームの中の要素と `bang-notes` に `lang` を付けると、その言語のときだけ表示する。`lang` の無い要素は全言語で表示する。言語は URL の `?lang=`、ブラウザの言語設定、先頭の順で決まり、発表中は `l` キーで切り替わる。

0. `languages` を足すときは、runtime の URL を `@bangerpage/core@0.2.0` 以降に固定する。古い runtime は `lang` を見ないので全言語が重なって出る (`banger check` が警告する)。
1. 1 つの言語で deck を書き上げて、その言語を `languages` の先頭にする。
2. 次の言語を、同じ場所に兄弟として足す。見出しは `bang-title` の中に `<span lang>` を並べる。箇条書きは `<li lang>`。画像・図・グラフは `lang` を付けた要素を、`lang` の無い `bang-stack` に包んで並べる (フレーム直下に並べない)。`bang-columns` の直接の子には `lang` を付けず、列の中の要素に付ける。notes は `bang-notes lang`。
3. `lang` を付けられるのはフレームの中の要素と `bang-notes` だけで、`bang-frame` と `bang-stop` には付けない。focus 停止点の `id` は `lang` の無い要素に付ける。引用の言語を示したいだけの `lang` は付けない (`languages` に無い `lang` は警告になる)。`bang-frame` の `crumb` / `label` は、作者の言語を `crumb` に、ほかの言語を `crumb-<言語>` (例: `crumb-en`) に書く。欠けていれば `banger check` が警告する。
4. 訳は直訳でなく、その言語の発表として自然な言い回しにする。文の長さが変わるので、`banger check` でどの言語もはみ出さないことを確かめる (ランタイムは文字を縮めない)。
5. `banger check` は言語ごとに描き、訳し忘れ (対の個数が違う) と段の数の違いを警告する。`banger snap --lang <言語>` か `--lang all` で見た目を目で確かめる。

書き方の完全な断片は `reference/patterns.md` の「多言語で書く」にある。

## コマンド

- `banger preview [file]`: プレビューとライブリロード。`[file]` を省くと、今いるディレクトリの `index.html` を使う (`snap` と `export` も同じ)。
- `banger check [file] [--json]`: 全停止点を最後の段で描き、問題を 1 行ずつ出す。フレームの余白の内側に収まらない中身、カードからはみ出す中身、存在しない `bang-*` の部品名、同じセルに置いたフレーム、無いフレームを指す停止点、使えない属性の値、読めない色、描けなかった部品が出る。`languages` のある deck は言語ごとに全停止点を描き、警告の行に `[ja] ` のように言語を付ける。訳し忘れと言語ごとの段の数の違いも出る。問題があれば終了コード 1。`--json` で `{ ok, stops, warnings, failed }` を出す。
- `banger snap [file] [--stop N] [--step M|last] [--steps last|all] [--out path] [--out-dir dir] [--scale 1|2] [--lang <言語>|all]`: 状態を 1920x1080 の PNG にする。停止点を省くと全停止点を最後の段で出す。`--steps all` を付けると、順に出す途中の段もすべて出す。自分で見て直すために使う。`--lang <言語>` でその言語で撮り、`--lang all` で言語ごとに `snap/<言語>/` へ撮る (省くと先頭の言語。`--lang all` と `--out` は同時に使えない)。
- `banger export [file] --pdf [--out path] [--steps last|all] [--lang <言語>|all]`: 停止点ごとに 1 ページの PDF にする。`--lang <言語>` は `deck.<言語>.pdf`、`--lang all` は言語ごとの PDF を書く (省くと先頭の言語の `deck.pdf`。`--lang all` と `--out` は同時に使えない)。
- `banger theme init [file] [--from <preset>] [--force]`: 同梱のひな形 (`signal` `signal-dark` `sunshine` `midnight`) から `theme.json` を作る。
- `banger theme apply <theme.json> <deck.html>`: `theme.json` を発表に埋め込み、`theme="custom"` にする。何度実行しても結果は同じ。
- `banger publish [dir] [--slug <slug>]`: 発表を banger.page に公開する。2 回目からは同じ発表の更新になる。公開は外に出す操作なので、人が頼んだときだけ実行する。ログインしていなければ、人に `banger login` を頼む (ブラウザでログインして許可する)。公開の前に `banger export --pdf --out deck.pdf` で PDF を作っておくと、発表ページから PDF を落とせる。 banger.page は発表を sandbox の iframe で見せるので、`bang-free` に script や外部の資源を書いた発表は、公開の前に `reference/publishing.md` の制約を守っているか確かめる。

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
