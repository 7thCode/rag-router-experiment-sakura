// RAGルーター実証実験（さくらのAI Engine版）
// 判定役を、ローカルOllamaから さくらのAI Engine の gpt-oss-120b に差し替えて、
// 同じ履歴36件・同じテスト20件で、履歴参照あり（RAG）／なしの一致率と所要時間を比べる。
// 埋め込みはローカルの Ollama（nomic-embed-text）を使う（類似検索は履歴参照の条件付けのため）。
//
// 使い方:
//   SAKURA_API_TOKEN='UUID:シークレット' node router-sakura.mjs
// 前提:
//   - さくらのAI Engine のアカウントトークンを環境変数 SAKURA_API_TOKEN に入れること
//   - Ollamaが起動していること（埋め込み用、http://localhost:11434）
// API: OpenAI互換 https://api.ai.sakura.ad.jp/v1/chat/completions、モデル gpt-oss-120b
// 消費リクエスト数: テスト20件 × 2条件 = 40回（無料枠 月3,000回のうち40回）
// 出力: 標準出力に結果、同じフォルダに results-sakura.md を保存する。

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

const SAKURA_BASE = "https://api.ai.sakura.ad.jp/v1";
const SAKURA_MODEL = process.argv[2] || "gpt-oss-120b";
const EMBED_MODEL = process.argv[3] || "nomic-embed-text";
const OLLAMA = "http://localhost:11434";
const TOKEN = process.env.SAKURA_API_TOKEN;

if (!TOKEN) {
  console.error("環境変数 SAKURA_API_TOKEN にアカウントトークン（UUID:シークレット）を設定してください。");
  process.exit(1);
}

const history = JSON.parse(readFileSync(new URL("./history.json", import.meta.url)));
const tests = JSON.parse(readFileSync(new URL("./tests.json", import.meta.url)));

let requestCount = 0;

async function sakuraChat(prompt) {
  const t0 = performance.now();
  const res = await fetch(`${SAKURA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      model: SAKURA_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  requestCount++;
  if (!res.ok) throw new Error(`sakura -> HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const ms = performance.now() - t0;
  return { content: data.choices?.[0]?.message?.content ?? "", ms, usage: data.usage };
}

async function ollamaEmbed(texts) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`ollama embed -> HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings;
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function judge(task, refs) {
  const refText = refs
    ? refs.map((h) => `- 仕事: ${h.task} / 適切な振り分け: ${h.label === "heavy" ? "上位モデル" : "軽いモデル"}（実際に使ったのは${h.model === "heavy" ? "上位" : "軽い"}モデル、結果: ${h.outcome === "completed" ? "完了" : `手戻り${h.rework}回`}）`).join("\n")
    : "（参考履歴なし）";
  const prompt = `あなたは仕事の振り分け係です。新しい仕事を「軽いモデル」で処理するか「上位モデル」を使うべきか判断してください。
判断の基準: 単純・定型・影響範囲が小さい仕事は軽いモデル。複雑・曖昧・セキュリティや正確さが重要な仕事は上位モデル。

過去の類似した仕事とその結果:
${refText}

新しい仕事: ${task}

次のJSONだけを出力してください: {"route": "light" または "heavy", "reason": "短い理由"}`;
  const { content, ms } = await sakuraChat(prompt);
  let route = "?";
  try {
    const m = content.match(/\{[\s\S]*\}/);
    route = JSON.parse(m ? m[0] : content).route;
  } catch {}
  return { route, ms };
}

async function main() {
  console.log(`判定役: ${SAKURA_MODEL}（さくらのAI Engine） / 埋め込み: ${EMBED_MODEL}（Ollama）`);
  console.log(`履歴 ${history.length} 件 / テスト ${tests.length} 件\n`);

  const histVecs = await ollamaEmbed(history.map((h) => h.task));

  const rows = [];
  let ragHit = 0, baseHit = 0, ragMs = 0, baseMs = 0;
  for (const t of tests) {
    const [vec] = await ollamaEmbed([t.task]);
    const refs = history
      .map((h, i) => ({ h, s: cosine(vec, histVecs[i]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.h);
    const rag = await judge(t.task, refs);
    const base = await judge(t.task, null);
    if (rag.route === t.expected) ragHit++;
    if (base.route === t.expected) baseHit++;
    ragMs += rag.ms; baseMs += base.ms;
    rows.push({ task: t.task, pattern: t.pattern, expected: t.expected, rag: rag.route, base: base.route });
    console.log(`${rag.route === t.expected ? "○" : "×"} RAG:${rag.route} / 素:${base.route} / 正解:${t.expected} — ${t.task}`);
  }

  const n = tests.length;
  const lines = [
    "# RAGルーター実証実験 結果（さくらのAI Engine版）",
    "",
    `- 実行環境: ${os.arch()} / メモリ ${(os.totalmem() / 2 ** 30).toFixed(0)}GB / Node ${process.version}`,
    `- 判定役モデル: ${SAKURA_MODEL}（さくらのAI Engine、OpenAI互換API）`,
    `- 埋め込みモデル: ${EMBED_MODEL}（Ollama、ローカル実行）`,
    `- 履歴データ: ${history.length}件（5パターン） / テスト: ${n}件`,
    `- 消費リクエスト数: ${requestCount}回`,
    "",
    "## 結果",
    "",
    `| 条件 | 一致率 | 平均判定時間 |`,
    `|---|---|---|`,
    `| 履歴参照あり（RAG） | ${ragHit}/${n}（${((ragHit / n) * 100).toFixed(0)}%） | ${(ragMs / n / 1000).toFixed(2)}秒 |`,
    `| 履歴参照なし | ${baseHit}/${n}（${((baseHit / n) * 100).toFixed(0)}%） | ${(baseMs / n / 1000).toFixed(2)}秒 |`,
    "",
    "## 参考：ローカルOllama版（1本目の記事の実測）",
    "",
    "| 判定役 | 条件 | 一致率 | 平均判定時間 |",
    "|---|---|---|---|",
    "| gpt-oss:20b（ローカル） | 履歴参照あり（RAG） | 17/20（85%） | 3.68秒 |",
    "| gpt-oss:20b（ローカル） | 履歴参照なし | 17/20（85%） | 2.61秒 |",
    "| qwen2.5-coder:7b（ローカル） | 履歴参照あり（RAG） | 15/20（75%） | 1.70秒 |",
    "| qwen2.5-coder:7b（ローカル） | 履歴参照なし | 15/20（75%） | 1.05秒 |",
    "",
    "## 明細",
    "",
    "| 仕事 | パターン | 正解 | RAG | 履歴なし |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.task} | ${r.pattern} | ${r.expected} | ${r.rag} | ${r.base} |`),
    "",
  ];
  writeFileSync(new URL("./results-sakura.md", import.meta.url), lines.join("\n"));
  console.log(`\nRAG: ${ragHit}/${n}（${((ragHit / n) * 100).toFixed(0)}%） / 履歴なし: ${baseHit}/${n}（${((baseHit / n) * 100).toFixed(0)}%）`);
  console.log(`消費リクエスト数: ${requestCount}回`);
  console.log("results-sakura.md に保存しました。");
}

main().catch((e) => { console.error(e); process.exit(1); });
