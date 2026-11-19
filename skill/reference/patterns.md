# パターン集

動く完全な断片だけを載せる。値は `components.md` の属性から選び、`style` 属性と色コードは書かない (色コードの例外はテーマ定義だけ。`reference/themes.md` を見る)。ランタイムの `<script type="module">` は `templates/starter.html` と同じ 1 行を使う。

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

系列を 1 本ずつ足して話したいときは `bang-chart` に `step` を書き、停止点の `steps` を系列の数に合わせる。

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
