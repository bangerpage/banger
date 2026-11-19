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

章の名前を左上の小さな行 (`crumb`) に置き、本文は `bang-card grow` で面にまとめ、まとめは `bang-card kind="band"` の帯に置く。`crumb` は上の余白に収まるので、本文の位置は動かない。影は `cardShadow` を `"soft"` にしたカスタムテーマだけで出る。

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
    <bang-card grow>
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
