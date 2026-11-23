# rag-router-experiment-sakura

RAGルーター実証実験の「さくらのAI Engine版」です。

Zennfes Autumn 2026「さくらのAI Engine 3,000リクエストで何するチャレンジ」への応募記事のために行った検証の、実験コードとデータと結果を置いています。

- 記事：（公開後にリンクを入れる）
- 前回の実験（ローカルOllama版）：https://github.com/7thCode/rag-router-experiment

## 検証内容

「仕事を軽いモデル／上位モデルに振り分けるルーター」の判定役を、さくらのAI Engine の gpt-oss-120b に差し替えて、前回のローカル版（gpt-oss:20b、qwen2.5-coder:7b）と、同じ履歴36件・同じテスト20件・同じプロンプトで比べ直しました。

- 埋め込み（類似履歴の検索）はローカルの Ollama（nomic-embed-text）のまま
- 変えたのは判定役だけ
- 消費リクエスト数：40回（テスト20件 × 履歴参照あり／なし の2条件）

## 結果

| 判定役 | 条件 | 一致率 | 平均判定時間 |
| --- | --- | --- | --- |
| gpt-oss-120b（さくらのAI Engine） | 履歴参照あり（RAG） | 19/20（95%） | 0.72秒 |
| gpt-oss-120b（さくらのAI Engine） | 履歴参照なし | 19/20（95%） | 0.65秒 |
| gpt-oss:20b（ローカル） | 履歴参照あり（RAG） | 17/20（85%） | 3.68秒 |
| gpt-oss:20b（ローカル） | 履歴参照なし | 17/20（85%） | 2.61秒 |
| qwen2.5-coder:7b（ローカル） | 履歴参照あり（RAG） | 15/20（75%） | 1.70秒 |
| qwen2.5-coder:7b（ローカル） | 履歴参照なし | 15/20（75%） | 1.05秒 |

明細は `results-sakura.md` を参照してください。

## 実行方法

前提：

- Node.js
- Ollama が起動していること（埋め込み用、nomic-embed-text）
- さくらのAI Engine のアカウントトークン（基盤モデル無償プランで可）

```sh
export SAKURA_API_TOKEN='UUID:シークレット'
node router-sakura.mjs
```

結果は標準出力と `results-sakura.md` に出力されます。

## ファイル

- `router-sakura.mjs`：実験スクリプト
- `history.json`：履歴データ36件（実ログではなく、典型例から作ったサンプル）
- `tests.json`：正解ラベル付きテスト20件
- `results-sakura.md`：実行結果（2026-11-23、M1 MacBook Pro 64GB / Node v26.12.1）
