# banger.page に公開する発表で守ること

banger.page は、公開した発表を枠のページの中の iframe で見せる。この iframe は、発表の script ができることを絞った sandbox で動く。公開した版はブラウザで自動検査される。勝手な遷移や popup が見つかると、発表は自動で一時非公開になる。

部品と `bang-free` の中の HTML・CSS・SVG だけで書いた発表は、そのままで守れている。`bang-free` に script や外部の資源を書くときに、次を確かめる。

## 表示のされ方

- 発表は banger.page の枠の中の iframe で表示される。配信ドメインの URL を直接開いても、枠のページへ移る。トップレベルで開かれる前提で書かない。
- ランタイムの `<script>` (`cdn.jsdelivr.net/npm/@bangerpage/core@<版>/dist/index.js`) は、そのまま書いてよい。banger.page が配信のときに自分の写しへ差し替える。1 つにまとめたランタイム (`dist/standalone.js`) ではなく、`dist/index.js` を書く。
- 検査は、ランタイムの `bang-root` の API で準備を待ち、場面の一覧を最大 20 まで、1 つ 2 秒以内で巡る。`bang-root` を使い、場面の移動に時間のかかる仕掛けを足さない。`bang-root` の無い発表は検査できず、「未検査」になる。

## 読み込めるもの

- 画像・音声・動画は、発表に含めたファイルか、`data:` / `blob:` の URL で入れる。外部の URL の画像や動画は読めない。
- script は、発表に含めたファイルかインラインで書く。CDN などの外部の script は読めない (ランタイムは上のとおり差し替わる)。`eval` と `new Function` は使わない。
- CSS は、発表に含めたファイルかインラインで書く。外部から読めるフォントと CSS は Google Fonts (`fonts.googleapis.com`・`fonts.gstatic.com`) だけ。
- 通信 (`fetch`・XHR・WebSocket・EventSource) は、同じ発表の配信元のファイルにだけ届く。外部の API は呼べない。

## 使えないもの

- `iframe`・`object`・`embed` と、YouTube などの埋め込み。動画は発表に含めたファイルを `<video>` で見せる。
- フォームの送信。入力欄は、画面の中の操作にだけ使う。
- `alert`・`confirm`・`prompt`。
- Web Worker・Service Worker・Web App Manifest と `<base>`。
- カメラ・マイク・位置情報・決済・USB。全画面・自動再生・ピクチャーインピクチャーは使える。

## リンクと画面の移動

- 外部へのリンクは、`http` か `https` の `<a href>` で書く (4096 文字まで、URL に ID とパスワードを含めない)。持ち主以外が開くと、行き先を確かめる画面を挟んでから新しいタブで開く。
- `mailto:`・`tel:`・`javascript:`・`data:`・`blob:` のリンクは、持ち主以外には開かれない。同じページの中の `#` のリンクは、そのまま動く。
- 発表者の画面は、ランタイムの発表者の機能 (`p` キー) で開く。持ち主以外には、確かめる画面を経て banger.page の発表者の画面が開く。
- script から `window.open`・`location` の変更・`top` の移動をしない。持ち主以外の閲覧では止められる。読み込んだときやクリック以外のきっかけで画面を開こうとすると、検査がそれを見つけて発表を自動で一時非公開にする。

## そのほか

- 読み込んだだけで重い処理を回し続けない。5 秒のうち 4 秒以上 CPU を使うと、要確認として運営者に知らされる。
- `localStorage` などの保存先は、同じ作者のほかの発表と共有される (配信元は作者ごとに 1 つ)。発表ごとに分かれている前提で書かない。
- HTML 以外のファイル (SVG など) を単独のページとして開いても、その中の script は動かない。script を動かす SVG は、HTML の中に入れる。
