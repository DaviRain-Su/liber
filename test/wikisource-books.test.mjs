import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKS,
  cleanWikisourceWikitext,
  importBookConcurrency,
  parseArgs,
  parseWikisourceChapters,
  rawUrl,
  sourceUrl,
  summarizeOutput,
} from "../scripts/import-wikisource-classics.mjs";

test("Wikisource importer catalog is Chinese public-domain curated", () => {
  assert.equal(BOOKS.length >= 12, true);
  assert.equal(BOOKS.every((book) => book.lang === "zh"), true);
  assert.equal(new Set(BOOKS.map((book) => book.id)).size, BOOKS.length);
  assert.equal(BOOKS.every((book) => book.category.startsWith("中文 · ")), true);
  assert.equal(sourceUrl(BOOKS[0]).startsWith("https://zh.wikisource.org/wiki/"), true);
  assert.equal(rawUrl(BOOKS[0]).includes("action=raw"), true);
});

test("Wikisource wikitext cleaner keeps Chinese body and strips apparatus", () => {
  const raw = `{{Header|title=岳陽樓記|author=范仲淹}}
<onlyinclude>
{{YL|{{專|慶曆}}四年|1044年}}春，[[w:滕子京|滕子京]]謫守{{專|巴陵郡}}。{{另2|霪|注}}雨霏霏。<ref>校注</ref>

蘇子過<u>赤壁</u>，曰：「-{zh:雲;zh-hant:雲;zh-hans:云;}-。」
</onlyinclude>
[[Category:測試]]`;
  const text = cleanWikisourceWikitext(raw);
  assert.equal(text.includes("{{"), false);
  assert.equal(text.includes("<ref>"), false);
  assert.equal(text.includes("[[Category"), false);
  assert.match(text, /慶曆四年春，滕子京謫守巴陵郡。霪雨霏霏。/);
  assert.match(text, /蘇子過赤壁，曰：「雲。」/);
});

test("Wikisource importer parses paragraphs into reader chapters", () => {
  const chapters = parseWikisourceChapters(
    BOOKS.find((book) => book.id === "qian-chibifu-wikisource-zh"),
    `<onlyinclude>清風徐來，水波不興。

客有吹洞簫者，倚歌而和之。</onlyinclude>`,
  );
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["第一段", "第二段"]);
  assert.equal(chapters[0].text, "清風徐來，水波不興。");
  assert.equal(chapters[1].n, 2);
});

test("Wikisource importer parses bounded concurrency options", () => {
  const options = parseArgs(["--publish", "--concurrency", "5", "--chapter-concurrency", "7", "--summary", "--json"]);
  assert.equal(options.publish, true);
  assert.equal(options.concurrency, 5);
  assert.equal(options.chapterConcurrency, 7);
  assert.equal(options.summary, true);
  assert.equal(options.json, true);
  assert.equal(importBookConcurrency(parseArgs([])), 8);
  assert.equal(importBookConcurrency(parseArgs(["--publish"])), 4);
  assert.throws(() => parseArgs(["--concurrency", "0"]), /--concurrency must be positive/);
  assert.throws(() => parseArgs(["--chapter-concurrency", "0"]), /--chapter-concurrency must be positive/);
});

test("Wikisource summary reports failures and language buckets", () => {
  const summary = summarizeOutput({
    mode: "dry-run",
    apiUrl: "https://example.test",
    results: [
      { id: "ok", title: "好", lang: "zh", category: "中文 · 古文", accepted: true, license: "PUBLIC-DOMAIN", chapters: 2 },
      { id: "bad", title: "壞", lang: "zh", category: "中文 · 古文", accepted: false, error: "boom" },
    ],
  });
  assert.equal(summary.total, 2);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.byLang, { zh: 2 });
});
