#!/usr/bin/env node
// P0 quality spike for the living knowledge graph (docs/KNOWLEDGE_GRAPH_SPEC.md §6.1).
//
// Goal: decide whether AUTO-discovered cross-book echoes are good enough to ship,
// BEFORE wiring Vectorize/Queues into production. It embeds the seed sample books
// with Workers AI (@cf/baai/bge-m3), computes cosine similarity in memory (no
// Vectorize needed), prints each sentence's top cross-book neighbours, and — where
// the hand-written seed ECHOES overlaps — shows them side by side so you can judge
// "is the machine as tasteful as the editor?".
//
// Usage:
//   CF_ACCOUNT_ID=xxx CF_AI_TOKEN=yyy node scripts/echo-spike.mjs [--min 0.6] [--topk 5] [--json]
//   npm run graph:spike -- --min 0.6
//
// Token: a Cloudflare API token with "Workers AI: Read" (Account scope). Nothing
// is written anywhere — this is read-only and safe to run repeatedly.
import { BOOK_CONTENT, BOOKS, ECHOES } from "../src/data/product-data.js";

const MODEL = "@cf/baai/bge-m3";
const args = parseArgs(process.argv.slice(2));
const MIN = Number(args.min ?? 0.6);
const TOPK = Number(args.topk ?? 5);
const JSON_OUT = !!args.json;

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function bookTitle(id) {
  return BOOKS.find((b) => b.id === id)?.t || id;
}

// Flatten the seed sample content into [{ sid, bookId, n, title, t }].
function collectSentences() {
  const rows = [];
  for (const [bookId, content] of Object.entries(BOOK_CONTENT)) {
    for (const ch of content.chapters || []) {
      for (const para of ch.paras || []) {
        for (const s of para) {
          if (!s?.id || !s?.t) continue;
          // normalize to full book-prefixed sid (daodejing keys are bare in seed)
          const sid = s.id.includes("-c") ? s.id : `${bookId}-${s.id}`;
          rows.push({ sid, bookId, n: ch.n, title: ch.title, t: s.t });
        }
      }
    }
  }
  return rows;
}

async function embedAll(texts) {
  if (!ACCOUNT || !TOKEN) {
    console.error(`
✗ Missing credentials. This spike calls Cloudflare Workers AI over REST.

  Set these and re-run (read-only, nothing is written):
    export CF_ACCOUNT_ID=<your account id>
    export CF_AI_TOKEN=<API token with "Workers AI: Read">
    npm run graph:spike -- --min ${MIN} --topk ${TOPK}

  Where to find them:
    Account ID  → Cloudflare dashboard → Workers & Pages (right sidebar)
    API token   → My Profile → API Tokens → Create → "Workers AI" template
`);
    process.exit(2);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;
  const vectors = [];
  // bge-m3 accepts batches; keep them modest to stay under request limits.
  const BATCH = 50;
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ text: chunk }),
    });
    if (!res.ok) {
      console.error(`✗ Workers AI ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    const j = await res.json();
    const data = j?.result?.data ?? j?.result?.embeddings ?? j?.data;
    if (!Array.isArray(data)) { console.error("✗ unexpected response shape:", JSON.stringify(j).slice(0, 300)); process.exit(1); }
    vectors.push(...data);
    process.stderr.write(`  embedded ${Math.min(i + BATCH, texts.length)}/${texts.length}\r`);
  }
  process.stderr.write("\n");
  return vectors;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// What did the editor hand-write for this sentence? (seed ECHOES, bare daodejing keys)
function seedEchoFor(sid) {
  const bare = sid.replace(/^daodejing-/, "");
  return ECHOES[bare] || ECHOES[sid] || null;
}

async function main() {
  const rows = collectSentences();
  const books = [...new Set(rows.map((r) => r.bookId))];
  console.error(`Spike: ${rows.length} sentences across ${books.length} books [${books.map(bookTitle).join(", ")}], model ${MODEL}\n`);

  const vectors = await embedAll(rows.map((r) => r.t));

  // for each sentence, rank cross-book neighbours
  const report = [];
  for (let i = 0; i < rows.length; i++) {
    const neighbours = [];
    for (let j = 0; j < rows.length; j++) {
      if (i === j || rows[i].bookId === rows[j].bookId) continue; // cross-book only
      neighbours.push({ ...rows[j], score: cosine(vectors[i], vectors[j]) });
    }
    neighbours.sort((a, b) => b.score - a.score);
    const top = neighbours.filter((n) => n.score >= MIN).slice(0, TOPK);
    if (top.length) report.push({ src: rows[i], top, seed: seedEchoFor(rows[i].sid) });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report.map((r) => ({
      sid: r.src.sid, book: bookTitle(r.src.bookId), quote: r.src.t,
      auto: r.top.map((t) => ({ score: Number(t.score.toFixed(3)), book: bookTitle(t.bookId), quote: t.t })),
      seedHandwritten: r.seed ? r.seed.items.map((it) => ({ book: it.bookT, quote: it.quote, why: it.why })) : null,
    })), null, 2));
    return;
  }

  for (const r of report) {
    console.log(`\n━━ ${bookTitle(r.src.bookId)} 〔${r.src.sid}〕`);
    console.log(`   「${r.src.t}」`);
    console.log(`   AUTO（语义最近邻，跨书）:`);
    for (const t of r.top) console.log(`     ${t.score.toFixed(3)}  《${bookTitle(t.bookId)}》 ${t.t}`);
    if (r.seed) {
      console.log(`   SEED（编辑部手写「${r.seed.theme}」）:`);
      for (const it of r.seed.items) console.log(`     —      《${it.bookT}》 ${it.quote}\n              ↳ ${it.why}`);
    }
  }

  const withSeed = report.filter((r) => r.seed).length;
  console.log(`\n──────────\n${report.length} sentences got ≥1 cross-book echo at min=${MIN}. ${withSeed} of them also have a hand-written seed echo to compare against.`);
  console.log(`Judge: do the AUTO neighbours feel as insightful as the SEED ones? Tune --min / --topk and re-run. This decides GRAPH_MIN_SCORE and whether to ship.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
