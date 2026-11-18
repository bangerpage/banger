---
name: banger
description: HTML 1 枚で「めくらない」プレゼンテーション (キャンバス上のフレームと、カメラが止まる停止点の列) を作る。発表資料・スライド・プレゼンを HTML で作る、直す、書き出す依頼で使う。
---

# Banger でプレゼンを作る

発表を 1 つの HTML にする。フレーム (`bang-frame`) をキャンバスに並べ、カメラが止まる停止点 (`bang-stop`) の列で見せる順を決める。部品とその属性は `reference/components.md`、定番の組み立ては `reference/patterns.md`、最小の動く HTML は `templates/starter.html` にある。

## 作業の流れ

1. 発表のアウトラインを、停止点の列として人と合意する。どのフレームをどの順で見せ、どこで寄り、どこで俯瞰に戻るかを先に決める。
2. `templates/starter.html` をコピーして元にし、フレームと停止点を書く。部品と属性は `reference/components.md` にあるものだけを使う。
3. `banger dev <file>` でプレビューして動きを確認する。
4. `banger snap <file>` で全停止点を画像にして目で見る。はみ出しや読めない箇所を探す。
5. 直して 3 に戻る。

## 原則

- 値は属性のトークンから選ぶ (`size="l"` `tone="accent"` `gap="m"` など)。属性に無い値は書かない。
- `style` 属性と色コードを書かない。見た目はテーマに任せる。
- 内容はフレームの外へ出さない。入りきらないときはフレームを分けるか、文を減らす。
- フレームの中身は上下の中央に置かれる。先頭が `bang-title` なら、タイトルは上に残り、残りがその下の中央に来る。タイトルもまとめて中央に置きたいとき (表紙や締めの一言) は、`bang-stack` で包む。
- アニメーションは部品の `step` (`bang-list` `bang-chart`) か `data-step` で行う。CSS や JS で動かさない。
- 発表者ノートは停止点の中の `bang-notes` に書く。

## コマンド

- `banger dev <file>`: プレビューとライブリロード。
- `banger snap <file> [--stop N] [--step M|last] [--out path] [--out-dir dir] [--scale 1|2]`: 状態を 1920x1080 の PNG にする。停止点を省くと全停止点を出す。自分で見て直すために使う。
- `banger export <file> --pdf [--out path] [--steps last|all]`: 停止点ごとに 1 ページの PDF にする。

## エスケープハッチ

部品で書けないものだけ `bang-free` (自由な HTML と CSS を書く部品) を使う。`bang-free` は最後の手段で、使うときは、どの部品でなぜ書けないかを人に伝える。

- `fallback` が無くても、`snap` と PDF には実際の描画が出る。
- 描き終わりに時間がかかるときは、要素の `bangReady` に Promise を代入する。書き出しはその完了を待つ。
