# パターン集

動く完全な断片だけを載せる。値は `components.md` の属性から選び、`style` 属性と色コードは書かない (`bang-free` の中の `<style>` の規則は、色をテーマの変数から取る限り書いてよい。色コードの例外はテーマ定義だけ。`reference/themes.md` を見る)。ランタイムの `<script type="module">` は `templates/starter.html` と同じ 1 行を使う。

## 比較を 2 列で見せる

左右に並べて違いを見せたいときは `bang-columns` に 2 つの子を置く。

```html
<bang-root theme="light">
  <bang-frame id="compare" at="0,0">
    <bang-title size="m">従来と新しいやり方</bang-title>
    <bang-columns ratio="1:1" gap="l">
      <bang-stack>
        <bang-text tone="muted">従来</bang-text>
        <bang-list><li>スライドを 1 枚ずつめくる</li><li>全体の位置が見えない</li></bang-list>
      </bang-stack>
      <bang-stack>
        <bang-text tone="accent">新しいやり方</bang-text>
        <bang-list><li>キャンバスを動いて見せる</li><li>俯瞰で全体に戻れる</li></bang-list>
      </bang-stack>
    </bang-columns>
  </bang-frame>
  <bang-path>
    <bang-stop frame="compare"><bang-notes>違いを順に話す</bang-notes></bang-stop>
  </bang-path>
</bang-root>
```

## 数字を大きく見せる

1 つの数字を主役にするときは `bang-stat` を使い、補足は `label` に書く。

```html
<bang-root theme="light">
  <bang-frame id="number" at="0,0">
    <bang-stat value="1,200" label="members" size="2xl"></bang-stat>
    <bang-text tone="muted">コミュニティの参加者</bang-text>
  </bang-frame>
  <bang-path>
    <bang-stop frame="number"><bang-notes>人数を言う</bang-notes></bang-stop>
  </bang-path>
</bang-root>
```

## グラフを系列ごとに見せる

系列を 1 本ずつ足して話したいときは `bang-chart` に `step` を書く。停止点の `steps` は省けば系列の数になる。

```html
<bang-root theme="light">
  <bang-frame id="chart" at="0,0">
    <bang-title size="m">利用者の推移</bang-title>
    <bang-chart step="1">
      <script type="application/json">
        {
          "legend": {},
          "xAxis": { "type": "category", "data": ["2024", "2025", "2026"] },
          "yAxis": { "type": "value" },
          "series": [
            { "type": "bar", "name": "日本", "data": [300, 500, 800] },
            { "type": "bar", "name": "海外", "data": [100, 200, 400] }
          ]
        }
      </script>
    </bang-chart>
  </bang-frame>
  <bang-path>
    <bang-stop frame="chart" steps="2"><bang-notes>日本、次に海外の順に出す</bang-notes></bang-stop>
  </bang-path>
</bang-root>
```

## 領域ズームと俯瞰で締める

細部へ寄ってから全体に戻す。`region` はフレームの `x,y,w,h` を 0 から 1 の割合で書く。

`span` で 2 マス以上にしたフレームは、停止点で全体を見せると 1 画面に縮んで文字が小さくなる (`span="2,1"` なら半分で、`xs` は読めない)。広いフレームは `region` の停止点で 1 画面ぶんずつ見せ、全体は最後の俯瞰だけにする。

```html
<bang-root theme="light">
  <bang-frame id="detail" at="0,0">
    <bang-columns ratio="1:1">
      <bang-stat value="42" label="talks"></bang-stat>
      <bang-stat value="1,200" label="members"></bang-stat>
    </bang-columns>
  </bang-frame>
  <bang-frame id="close" at="1,0">
    <bang-title>ありがとうございました</bang-title>
  </bang-frame>
  <bang-path>
    <bang-stop frame="detail"><bang-notes>全体を見せる</bang-notes></bang-stop>
    <bang-stop frame="detail" region="0,0,0.5,1"><bang-notes>左の数字に寄る</bang-notes></bang-stop>
    <bang-stop frame="close"><bang-notes>締める</bang-notes></bang-stop>
    <bang-stop overview><bang-notes>俯瞰で振り返る</bang-notes></bang-stop>
  </bang-path>
</bang-root>
```

## 表紙と章扉を地の色で区切る

表紙や章扉のフレームだけ地を変える。`tone="accent"` はテーマの強調色の地、`tone="inverse"` はテーマの本文の色の地になり、文字の色も読める色に変わる。色はテーマから決まるので、ここでも色コードは書かない。地を変えたフレームでは `tone="accent"` の文字も本文と同じ色になるので、強調は大きさで付ける。`tone="accent"` の地では、`tone="muted"` も読める濃さを保つためにほぼ本文の色になる。補足を弱めたいときは `size` を下げる。

```html
<bang-root theme="light">
  <bang-frame id="cover" at="0,0" tone="accent">
    <bang-stack>
      <bang-title size="2xl">めくらないプレゼン</bang-title>
      <bang-text tone="muted">Banger / 2026</bang-text>
    </bang-stack>
  </bang-frame>
  <bang-frame id="chapter" at="1,0" tone="inverse">
    <bang-stack>
      <bang-text tone="muted">Lv.1</bang-text>
      <bang-title size="2xl">数字を知る</bang-title>
    </bang-stack>
  </bang-frame>
  <bang-path>
    <bang-stop frame="cover"></bang-stop>
    <bang-stop frame="chapter"></bang-stop>
  </bang-path>
</bang-root>
```

## 表紙だけをグラデーションにする

表紙だけに斜めのグラデーションを掛けたいときは、`coverGradient` を持つカスタムテーマを作り、表紙のフレームに `ground="cover"` を書く。ほかのフレームは通常の地のまま。色コードは `bang-theme` の JSON だけに書く。

```html
<bang-root theme="custom">
  <bang-theme>
    <script type="application/json">
      {
        "paper": "#FFC800",
        "ink": "#141414",
        "signal": "#141414",
        "coverGradient": { "angle": 135, "colors": ["#FFFFFF", "#FFC800"] }
      }
    </script>
  </bang-theme>
  <bang-frame id="cover" at="0,0" ground="cover">
    <bang-title size="2xl">めくらないプレゼン</bang-title>
  </bang-frame>
  <bang-frame id="body" at="1,0">
    <bang-title size="m">本編</bang-title>
  </bang-frame>
  <bang-path>
    <bang-stop frame="cover"></bang-stop>
    <bang-stop frame="body"></bang-stop>
  </bang-path>
</bang-root>
```

## パンくずと影つきカードと帯で 1 章を組む

章の名前を左上の小さな行 (`crumb`) に置き、本文は `bang-card grow` で面にまとめ、まとめは `bang-card kind="band"` の帯に置く。`crumb` は上の余白に収まるので、本文の位置は動かない。カードの中身を縦中央に置くときは `valign="center"`、最初の子を上端・最後の子を下端に散らすときは `valign="spread"` を書く。`spread` が散らすのはカードの直下の子なので、中身を 1 つの `bang-stack` にまとめると効かない。帯は `bang-stack` が中身を中央や右に寄せていても、幅いっぱいに広がる。影は `cardShadow` を `"soft"` にしたカスタムテーマだけで出る。

```html
<bang-root theme="custom">
  <bang-theme>
    <script type="application/json">
      {
        "paper": "#FFC800",
        "surface": "#EEEEEE",
        "ink": "#141414",
        "signal": "#141414",
        "bandGradient": { "angle": 90, "colors": ["#FFFFFF", "#FFC800"] },
        "cardShadow": "soft"
      }
    </script>
  </bang-theme>
  <bang-frame id="lv2" at="0,0" crumb="Lv.2 お客さまと隣接組織を知る">
    <bang-title size="m">見出し</bang-title>
    <bang-card grow valign="center">
      <bang-text>カードの中の本文</bang-text>
    </bang-card>
  </bang-frame>
  <bang-frame id="points" at="1,0" crumb="Lv.2 まとめ">
    <bang-card kind="band">
      <bang-list><li>帯の中の箇条書き</li></bang-list>
    </bang-card>
  </bang-frame>
  <bang-path>
    <bang-stop frame="lv2"></bang-stop>
    <bang-stop frame="points"></bang-stop>
  </bang-path>
</bang-root>
```

## 文中の強調と入れ子の箇条書き

文中の強調は `<b>` (太字) と `<mark>` (マーカー)、引用や出典の原文の斜体は `<i>` だけを使う。属性は付けない。`<mark>` の色は、`highlight` を持つカスタムテーマで決まる。書かなければ強調色の 40% の半透明になる。入れ子の箇条書きは、親の `<li>` の直後に `<bang-list>` を置く。`<li>` の中には書かない (ブラウザが入れ子を壊す)。子は 1 段小さい文字と中抜きの丸で描かれる。親が `xs` や `s` で子が小さすぎるときは、子の `bang-list` に `size` を書く (親と同じ大きさにもできる)。段階表示では、子は直前の親の項目と一緒に出る。

```html
<bang-root>
  <bang-frame id="emph" at="0,0">
    <bang-title size="m">強みは<mark>専門性</mark>にある</bang-title>
    <bang-text>この数字は<b>去年の 2 倍</b>になった。</bang-text>
    <bang-list size="m">
      <li>エンジニアならではの<mark>専門性</mark></li>
      <!-- 入れ子は li の中ではなく、親の li の直後に置く -->
      <bang-list>
        <li>設計の判断を言葉にできる</li>
        <li>障害の原因を<b>数字</b>で話せる</li>
      </bang-list>
      <li>チームを越える視点</li>
    </bang-list>
  </bang-frame>
  <bang-path>
    <bang-stop frame="emph"></bang-stop>
  </bang-path>
</bang-root>
```

## 多言語で書く

`bang-root` に `languages` を書き、言語ごとの文を同じ場所の兄弟に並べる。見出しは `bang-title` の中の `<span lang>`、箇条書きは `<li lang>`、画像は `lang` を付けた `bang-image` を `lang` の無い `bang-stack` に包んで並べる。フレームの `crumb` は作者の言語を `crumb`、ほかの言語を `crumb-en` のように書く。notes は `bang-notes lang`。focus 停止点の `id` は `lang` の無い要素 (ここでは `bang-stack`) に付ける。

```html
<bang-root theme="light" languages="ja en">
  <bang-frame id="hello" at="0,0" crumb="なぜ" crumb-en="Why">
    <bang-title>
      <span lang="ja">めくらない発表</span>
      <span lang="en">Presentations that move</span>
    </bang-title>
    <bang-list step="1">
      <li lang="ja">フレームはキャンバスに並ぶ</li>
      <li lang="en">Frames sit on a canvas</li>
      <li lang="ja">カメラは停止点で止まる</li>
      <li lang="en">The camera stops at each stop</li>
    </bang-list>
    <bang-stack id="chart">
      <bang-image lang="ja" src="chart-ja.png" alt="売上の推移"></bang-image>
      <bang-image lang="en" src="chart-en.png" alt="Sales over time"></bang-image>
    </bang-stack>
  </bang-frame>
  <bang-path>
    <bang-stop frame="hello" focus="chart">
      <bang-notes lang="ja">図を見せて、推移を話す</bang-notes>
      <bang-notes lang="en">Show the chart and talk through the trend</bang-notes>
    </bang-stop>
  </bang-path>
</bang-root>
```

## 表紙の題名を上に、名前を下に置く

表紙で題名を上端、名前を下端に分けたいときは、フレームに `valign="spread"` を書き、題名のまとまりと名前のまとまりを 2 つの `bang-stack` にする。最初の子が上端、最後の子が下端に付く。`ground="cover"` は `coverGradient` を持つカスタムテーマで効く。

```html
<bang-root theme="custom">
  <bang-theme>
    <script type="application/json">
      {
        "paper": "#FFC800",
        "ink": "#141414",
        "signal": "#141414",
        "coverGradient": { "angle": 135, "colors": ["#FFFFFF", "#FFC800"] }
      }
    </script>
  </bang-theme>
  <bang-frame id="cover" at="0,0" ground="cover" valign="spread">
    <bang-stack>
      <bang-title size="2xl">めくらないプレゼン</bang-title>
      <bang-text>2026 年の発表</bang-text>
    </bang-stack>
    <bang-stack>
      <bang-text>山田 太郎</bang-text>
    </bang-stack>
  </bang-frame>
  <bang-path>
    <bang-stop frame="cover"></bang-stop>
  </bang-path>
</bang-root>
```

## ○ と ✖ で良し悪しを分ける

2 列の `bang-columns` の各列を `bang-stack` にし、先頭に `bang-shape` の `ok` (左) と `ng` (右) を置いて、その下に箇条書きを置く。`ng` は `tone="accent"` で目立たせる。

```html
<bang-root>
  <bang-frame id="goodbad" at="0,0">
    <bang-title size="m">良い書き方と悪い書き方</bang-title>
    <bang-columns ratio="1:1" gap="l">
      <bang-stack>
        <bang-shape kind="ok" size="xl"></bang-shape>
        <bang-list><li>1 枚に 1 つの主張</li><li>数字を大きく見せる</li></bang-list>
      </bang-stack>
      <bang-stack>
        <bang-shape kind="ng" tone="accent" size="xl"></bang-shape>
        <bang-list><li>1 枚に主張が 3 つ</li><li>小さい文字で埋める</li></bang-list>
      </bang-stack>
    </bang-columns>
  </bang-frame>
  <bang-path>
    <bang-stop frame="goodbad"></bang-stop>
  </bang-path>
</bang-root>
```

## 矢印でカードをつなぐ

`bang-stack align="center"` に `bang-card`、`bang-shape kind="arrow-down"`、`bang-card` を並べると、カードの間に太い灰色の矢印が入る。文の行頭の記号は、`bang-text` の中に `bang-shape` を置く。

```html
<bang-root>
  <bang-frame id="flow" at="0,0">
    <bang-title size="m">作業の流れ</bang-title>
    <bang-stack align="center">
      <bang-card><bang-text>下書きを書く</bang-text></bang-card>
      <bang-shape kind="arrow-down"></bang-shape>
      <bang-card><bang-text>見て直す</bang-text></bang-card>
      <bang-text><bang-shape kind="ng" tone="accent" size="s"></bang-shape> 直さずに配る</bang-text>
    </bang-stack>
  </bang-frame>
  <bang-path>
    <bang-stop frame="flow"></bang-stop>
  </bang-path>
</bang-root>
```

## 出典をカードの外に置く

引用はカードの中に `<i>` で書き、出典はカードの後ろ (フレームの直下) に小さい `bang-text` で置く。

```html
<bang-root>
  <bang-frame id="quote" at="0,0">
    <bang-title size="m">この言葉に学ぶ</bang-title>
    <bang-card grow>
      <bang-text size="l"><i>Simplicity is the ultimate sophistication.</i></bang-text>
    </bang-card>
    <bang-text size="xs" tone="muted">出典: 書名、著者名、2020 年</bang-text>
  </bang-frame>
  <bang-path>
    <bang-stop frame="quote"></bang-stop>
  </bang-path>
</bang-root>
```

## 地図を逃げ道で組む

部品に無い地図は `bang-free` の直下に `<style>` とルート要素を置いて組む。薄い箱の上に同じ位置の強調の箱を `grid-area: 1 / 1` で重ね、強調の箱に `data-step` を付けて順に出す (`data-step` は要素ごと出し入れするので、色を切り替えず重ねる)。流れの中の矢印は箱の中に `bang-shape` を置いてよい。

```html
<bang-root>
  <bang-frame id="map" at="0,0">
    <bang-title size="m">事業の構成</bang-title>
    <bang-free>
      <style>
        .map { display: grid; grid-template-columns: 1fr 160px 1fr 160px 1fr; align-items: center; }
        .cell { display: grid; }
        .box { grid-area: 1 / 1; border: 2px solid var(--bang-color-ink-muted); padding: 64px 16px; text-align: center; font-size: 40px; color: var(--bang-color-ink-muted); }
        .box.on { background: var(--bang-color-signal); border-color: var(--bang-color-signal); color: var(--bang-color-on-signal); }
        .link { border-top: 3px dotted var(--bang-color-ink-muted); }
      </style>
      <div class="map">
        <div class="cell"><div class="box">集める</div><div class="box on" data-step="1">集める</div></div>
        <div class="link"></div>
        <div class="cell"><div class="box">育てる</div><div class="box on" data-step="2">育てる</div></div>
        <div class="link"></div>
        <div class="cell"><div class="box">届ける</div><div class="box on" data-step="3">届ける</div></div>
      </div>
    </bang-free>
  </bang-frame>
  <bang-path>
    <bang-stop frame="map" steps="3"></bang-stop>
  </bang-path>
</bang-root>
```

## 曲線の矢印と丸囲みを重ねる

他の内容の上に重ねるものは、フレームの最後の子に `bang-free overlay` を 1 つ置く。座標はフレームの左上が原点の px で、`banger snap` の画像で語の位置を読んで合わせる。楕円は `<ellipse>`、曲線は二次ベジエ (`M x0 y0 Q cx cy x2 y2`) の点線で描き、矢じりは `marker-end` で付ける。`marker` の `id` はデッキ内で一意にする。

二次ベジエの制御点は、始点 (x0, y0)、終点 (x2, y2)、曲げ量 h (px。進む向きの左側へ曲げるとき正) から求める。d = (x2 - x0, y2 - y0)、L = d の長さ、制御点 C = ((x0 + x2) / 2 + h * dy / L, (y0 + y2) / 2 - h * dx / L)。曲線の頂点は弦から h / 2 離れる。例えば (1500, 820) から (1180, 640)、h = 60 なら C = (1311, 782)。楕円は `rx` = 語の幅の半分 + 16、`ry` = 行の高さの半分 + 8 を目安にする。

```html
<bang-root>
  <bang-frame id="curve" at="0,0">
    <bang-title size="m">直すと結果が変わる</bang-title>
    <bang-list><li>下書きを書く</li><li>見て直す</li><li>配る</li></bang-list>
    <bang-free overlay>
      <style>
        .layer { position: relative; }
        svg { position: absolute; inset: 0; width: 100%; height: 100%; color: var(--bang-color-signal-text); }
        .ring { fill: none; stroke: var(--bang-color-signal-text); stroke-width: 4; }
        .arc { fill: none; stroke: var(--bang-color-signal-text); stroke-width: 4; stroke-dasharray: 2 12; stroke-linecap: round; }
        .note { position: absolute; left: 1180px; top: 800px; width: 560px; padding: 16px 24px; border: 1px solid var(--bang-color-line); background: var(--bang-color-surface); color: var(--bang-color-ink); font-size: 32px; }
      </style>
      <div class="layer">
        <svg viewBox="0 0 1920 1080">
          <defs>
            <marker id="tip" orient="auto" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0L8 4L0 8Z" fill="currentColor"></path></marker>
          </defs>
          <ellipse class="ring" cx="283" cy="127" rx="58" ry="38"></ellipse>
          <path class="arc" d="M 1170 840 Q 719 797 300 600" marker-end="url(#tip)"></path>
        </svg>
        <div class="note">見て直す時間を取ると、結果が変わる</div>
      </div>
    </bang-free>
  </bang-frame>
  <bang-path>
    <bang-stop frame="curve"></bang-stop>
  </bang-path>
</bang-root>
```
