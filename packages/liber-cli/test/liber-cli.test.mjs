import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  clearCliConfig,
  createBookManifest,
  createIngestPayload,
  dryRunPublishPlan,
  extractEpubChapters,
  garbledTextWarnings,
  inspectEpub,
  looksLikeGarbledText,
  loadCliConfig,
  publishBookManifest,
  publishBookManifestChunked,
  saveCliConfig,
  signInWithSuiPrivateKey,
  startBrowserAuth,
  verifyPublishLicense,
  waitForBrowserAuth,
} from "../src/liber-core.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/liber.mjs", import.meta.url));

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body);
    const crc = crc32(body);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(body.length),
      u32(body.length),
      u16(name.length),
      u16(0),
      name,
      body,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(body.length),
      u32(body.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
}

async function writeEpub(rights = "CC0-1.0", chapterBodies = ["The way that can be spoken."], options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-cli-"));
  const epubPath = path.join(dir, "book.epub");
  const manifestItems = [
    ...chapterBodies.map((_, i) => `    <item id="c${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
    ...(options.manifestItems || []),
  ].join("\n");
  const spineItems = chapterBodies
    .map((_, i) => `    <itemref idref="c${i + 1}"/>`)
    .join("\n");
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="bookid" version="3.0">
  <metadata>
    <dc:identifier id="bookid">urn:test:dao</dc:identifier>
    <dc:title>${options.title || "Dao De Jing"}</dc:title>
    <dc:creator>Laozi</dc:creator>
    <dc:language>en</dc:language>
    <dc:rights>${rights}</dc:rights>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine${options.spineAttrs ? ` ${options.spineAttrs}` : ""}>
${spineItems}
  </spine>
</package>`;
  const zip = storedZip([
    { name: "mimetype", body: "application/epub+zip" },
    { name: "META-INF/container.xml", body: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>` },
    { name: "OEBPS/content.opf", body: opf },
    ...chapterBodies.map((body, i) => {
      const title = typeof body === "object" ? body.title : `Chapter ${i + 1}`;
      const content = typeof body === "object" ? body.body : body;
      const headTitle = typeof body === "object" && body.headTitle ? body.headTitle : "Ignored";
      const raw = typeof body === "object" && body.raw
        ? body.raw
        : `<h1>${title}</h1><p>${content}</p>`;
      return {
        name: `OEBPS/chapter${i + 1}.xhtml`,
        body: `<html><head><title>${headTitle}</title><style>.x{}</style></head><body><nav>Skip me</nav>${raw}</body></html>`,
      };
    }),
    ...(options.extraEntries || []),
  ]);
  await writeFile(epubPath, zip);
  return { dir, epubPath, sha256: createHash("sha256").update(zip).digest("hex") };
}

test("inspectEpub extracts OPF metadata and hashes the EPUB", async () => {
  const { epubPath, sha256 } = await writeEpub();
  const info = await inspectEpub(epubPath);

  assert.equal(info.mimetype, "application/epub+zip");
  assert.equal(info.sha256, sha256);
  assert.equal(info.opfPath, "OEBPS/content.opf");
  assert.equal(info.metadata.title, "Dao De Jing");
  assert.equal(info.metadata.creator, "Laozi");
  assert.equal(info.metadata.language, "en");
  assert.deepEqual(info.metadata.rights, ["CC0-1.0"]);
  assert.equal(info.manifest[0].href, "OEBPS/chapter1.xhtml");
  assert.deepEqual(info.spine, ["c1"]);
});

test("verifyPublishLicense accepts explicit CC0 and public domain", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice");
  const info = await inspectEpub(epubPath);

  assert.equal(verifyPublishLicense(info, { source: "https://www.gutenberg.org/ebooks/216", license: "CC0-1.0" }).accepted, true);
  const pd = verifyPublishLicense(info, { source: "https://www.gutenberg.org/ebooks/216", license: "PUBLIC-DOMAIN" });
  assert.equal(pd.accepted, true);
  assert.equal(pd.license, "PUBLIC-DOMAIN");
});

test("verifyPublishLicense rejects non-commercial and unknown licenses", async () => {
  const { epubPath } = await writeEpub("Creative Commons Attribution-NonCommercial 4.0");
  const info = await inspectEpub(epubPath);

  assert.equal(verifyPublishLicense(info, { source: "https://example.com/book", license: "CC0-1.0" }).accepted, false);
  assert.equal(verifyPublishLicense({ ...info, metadata: { ...info.metadata, rights: ["custom license"] } }, { source: "https://example.com/book" }).accepted, false);

  const copyrighted = verifyPublishLicense(
    { ...info, metadata: { ...info.metadata, rights: ["Copyrighted. Read the copyright notice inside this book for details."] } },
    { source: "https://www.gutenberg.org/ebooks/5739", license: "PUBLIC-DOMAIN" },
  );
  assert.equal(copyrighted.accepted, false);
  assert.deepEqual(copyrighted.rejectedSignals, ["COPYRIGHTED"]);
});

test("createBookManifest writes stable publish metadata", async () => {
  const { epubPath, sha256 } = await writeEpub("CC0 1.0 Universal");
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
    evidence: "Publisher marks this EPUB as CC0 1.0 Universal.",
  });

  assert.equal(manifest.schema, "liber.book-manifest.v1");
  assert.equal(manifest.source.license, "CC0-1.0");
  assert.equal(manifest.assets.epub.sha256, sha256);
  assert.equal(manifest.publishPolicy.accepted, true);
  assert.equal(manifest.book.title, "Dao De Jing");
});

test("dryRunPublishPlan describes the storage and registry plan", async () => {
  const { epubPath } = await writeEpub();
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  const plan = dryRunPublishPlan(manifest, { apiUrl: "https://liber.example" });

  assert.equal(plan.api.ingestUrl, "https://liber.example/api/books/ingest");
  assert.equal(plan.registry.kind, "book");
  assert.equal(plan.registry.license, "CC0-1.0");
});

test("extractEpubChapters extracts readable spine text", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph.", "Second paragraph."]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].n, 1);
  assert.equal(chapters[0].title, "Chapter 1");
  assert.match(chapters[0].text, /First paragraph\./);
  assert.doesNotMatch(chapters[0].text, /<p>/);
  assert.doesNotMatch(chapters[0].text, /Skip me/);
});

test("extractEpubChapters reflows source-wrapped HTML paragraphs", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", [
    `The seventh volume of Memoirs concerning history, the sciences, the
arts, and usages is devoted to the Art of War.

A real second paragraph remains separate.`,
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.match(chapters[0].text, /sciences, the arts, and usages/);
  assert.doesNotMatch(chapters[0].text, /sciences, the\n\narts/);
  assert.match(chapters[0].text, /War\.\n\nA real second paragraph/);
});

test("extractEpubChapters rejects garbled Chinese text", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Chapter 1",
      body: `頦菜鈭亦剝剖亙蝎寧 銋拙嗆

寡詨粹剔瞍脣寡璆詨粹剔瞍脣 格閰冽頦砌剛急唳剛

嗆嗆Ｘ祆桃蝞鞊ｇ撕剔剜祆寞臬音桅剛

⊿冽鈭血迎銋抵芷脣輸鈭亙孵 Ｚａ怨祆踵啁

株砍蝘餉∪輯憌舀賣豢頦嫖芰啣鞎瞉 詨詨圈

剔剜唾砍拇寥獢芰踵祈 嚚怠頦寞

賊賣砍賢寡其鼎Ｗ頛舫砌祉曇怠 曉頦嫖單

剔踹賊啣喃⊥喳輻∠菟剜曇文寡

獢鞈芸鞈芾瞏砍寞蔬瞏璇 桃抽芾菔瞏剖兩芾菔瞉鈭銋

頦菜鈭亦剝剖亙蝎寧 銋拙嗆

寡詨粹剔瞍脣寡璆詨粹剔瞍脣 格閰冽頦砌剛急唳剛

嗆嗆Ｘ祆桃蝞鞊ｇ撕剔剜祆寞臬音桅剛

⊿冽鈭血迎銋抵芷脣輸鈭亙孵 Ｚａ怨祆踵啁

株砍蝘餉∪輯憌舀賣豢頦嫖芰啣鞎瞉 詨詨圈

剔剜唾砍拇寥獢芰踵祈 嚚怠頦寞

賊賣砍賢寡其鼎Ｗ頛舫砌祉曇怠 曉頦嫖單

剔踹賊啣喃⊥喳輻∠菟剜曇文寡

獢鞈芸鞈芾瞏砍寞蔬瞏璇 桃抽芾菔瞏剖兩芾菔瞉鈭銋`,
    },
  ], { title: "Bad Chinese Source" });

  await assert.rejects(
    () => extractEpubChapters(epubPath),
    /EPUB extracted text looks garbled/,
  );
});

test("garbledTextWarnings allows readable classical Chinese", () => {
  const text = `棲守道德者，寂寞一時；依阿權勢者，淒涼萬古。

達人觀物外之物，思身後之身，寧受一時之寂寞，毋取萬古之淒涼。`;

  assert.equal(looksLikeGarbledText(text), false);
  assert.deepEqual(garbledTextWarnings(text), []);
});

test("extractEpubChapters removes Project Gutenberg license wrappers", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of The Art of War",
      body: `The Project Gutenberg eBook of The Art of War

This eBook is for the use of anyone anywhere.

*** START OF THE PROJECT GUTENBERG EBOOK THE ART OF WAR ***

Chapter I. LAYING PLANS

Sun Tzu said: The art of war is of vital importance.

*** END OF THE PROJECT GUTENBERG EBOOK THE ART OF WAR ***

Updated editions will replace the previous one.`,
    },
    {
      title: "Preface to the Project Gutenberg Etext",
      body: "This Project Gutenberg Etext of The Art of War was prepared by volunteers.",
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "Chapter I. LAYING PLANS");
  assert.match(chapters[0].text, /Sun Tzu said/);
  assert.doesNotMatch(chapters[0].text, /This eBook is for the use/);
  assert.doesNotMatch(chapters[0].text, /PROJECT GUTENBERG EBOOK/);
  assert.doesNotMatch(chapters[0].text, /Updated editions/);
});

test("extractEpubChapters does not use producer boilerplate as a title", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Produced by Rick Davis",
      body: `Produced by Rick Davis

RASHOMON

The old servant waited under the gate.`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "Dao De Jing");
  assert.match(chapters[0].text, /old servant/);
  assert.doesNotMatch(chapters[0].text, /Produced by/);
});

test("extractEpubChapters skips standalone Gutenberg license chapters", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Chapter I.",
      body: "A real chapter.",
    },
    {
      title: "THE FULL PROJECT GUTENBERG LICENSE",
      body: "License text only.",
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "Chapter I.");
  assert.doesNotMatch(chapters[0].text, /License text/);
});

test("extractEpubChapters falls back from prose-shaped heading titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "This is not a chapter title but an entire paragraph that should never be shown in the table of contents because it is extracted from body prose and runs far too long.",
      body: "Actual paragraph starts here.",
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "Dao De Jing");
  assert.match(chapters[0].text, /Actual paragraph/);
});

test("extractEpubChapters splits Latin liber headings", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "PUBLI VERGILI MARONIS",
      body: `PUBLI VERGILI MARONIS

AENEIDOS

LIBER I

Arma virumque cano.

LIBER II

Conticuere omnes.`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["LIBER I", "LIBER II"]);
  assert.match(chapters[1].text, /Conticuere/);
});

test("extractEpubChapters ignores decorative bracket headings", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "…",
      body: `《…》

Body after a decorative divider.`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "Dao De Jing");
  assert.match(chapters[0].text, /Body after/);
});

test("extractEpubChapters recognizes Finnish runo headings", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Kalevala",
      body: `Ensimmäinen runo

Vaka vanha Väinämöinen.

Viides runo

Jo tuli sanoma uusi.`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["Ensimmäinen runo", "Viides runo"]);
});

test("extractEpubChapters skips title pages and finds delayed roman chapter headings", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "C. COLLODI",
      body: `Le Avventure di Pinocchio

Storia di un burattino

illustrata da Carlo Chiostri

Nuova edizione

FIRENZE
R. Bemporad & Figlio — Editori.

PROPRIETÀ LETTERARIA`,
    },
    {
      title: "Le avventure di Pinocchio: Storia di un burattino",
      body: `Le Avventure di Pinocchio

Storia di un burattino

illustrata da Carlo Chiostri

Nuova edizione

FIRENZE
R. Bemporad & Figlio — Editori.

I. Come andò che Maestro Ciliegia, falegname trovò un pezzo di legno.

— C'era una volta....`,
    },
  ], { title: "Le avventure di Pinocchio: Storia di un burattino" });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "I. Come andò che Maestro Ciliegia, falegname trovò un pezzo di legno.");
  assert.doesNotMatch(chapters[0].text, /^I\. Come/u);
  assert.doesNotMatch(chapters[0].text, /PROPRIETÀ LETTERARIA/);
});

test("extractEpubChapters splits Chinese Gutenberg spine files by internal titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 墨子",
      body: `Produced by Lu-Tin Lee

《墨子 - Mozi》

《卷一》

《親士》

1 親士: 入國而不存其士，則亡國矣。

《修身》

1 修身: 君子戰雖有陳，而勇為本焉。

《所染》

1 所染: 子墨子言見染絲者而嘆曰：“染於蒼則蒼。”`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["親士", "修身", "所染"]);
  assert.match(chapters[0].text, /入國而不存其士/);
  assert.doesNotMatch(chapters[0].text, /Produced by/);
  assert.doesNotMatch(chapters[0].text, /墨子 - Mozi/);
});

test("extractEpubChapters keeps Chinese classic numbered sections as paragraphs", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 墨子",
      raw: `<p>《親士》</p>
<p>1
親士:
入國而不存其士，則亡國矣。
2
親士:
昔者文公出走而正天下。
1. 干 : 原錯為“于”。
3
親士:
吾聞之曰：“非無安居也。”</p>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.match(chapters[0].text, /入國而不存其士/);
  assert.match(chapters[0].text, /亡國矣。\n\n2\. 昔者/);
  assert.match(chapters[0].text, /出走而正天下。\n\n1\. 干 :/);
  assert.match(chapters[0].text, /原錯為“于”。\n\n3\. 吾聞/);
});

test("extractEpubChapters cleans source chrome from Chinese classics", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 墨子",
      body: `《節用中》

1 節用中: 子墨子言曰：“古者明王聖人。”

節用中: 墨子說道：“古代的明王聖人。”

22 卷六: 節用下 23 卷六: 節葬上

《大取》

[戰國 (公元前475年 - 公元前221年)] 相關資源

1 大取: 天之愛人也。屬於：[倫理]`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, "節用中");
  assert.match(chapters[0].text, /古者明王聖人/);
  assert.match(chapters[0].text, /^1\. 子墨子言曰/u);
  assert.doesNotMatch(chapters[0].text, /墨子說道/);
  assert.doesNotMatch(chapters[0].text, /節用下/);
  assert.doesNotMatch(chapters[1].text, /相關資源|戰國|屬於/);
});

test("extractEpubChapters separates Mozi canon/commentary chapters", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 墨子",
      body: `《經上》

1
經上:
故，所得而後成也。

經說上:
故：小故，有之不必然，無之必不然。
1. 然， : 舊脫。 孫詒讓《墨子閒詁》
2
經上:
體，分於兼也。

經說上:
體：若二之一，尺之端也。

《經下》

101
經下:
止，類以行之。說在同。

經説下:
止：彼以此其然也，說是其然也。
102
經下:
推類之難，說在之大小。

經説下:
謂四足獸，與牛馬與，物盡異。`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.deepEqual(chapters.map((ch) => ch.title), ["經上", "經說上", "經下", "經說下"]);
  assert.match(chapters[0].text, /1\. 故，所得而後成也。/);
  assert.match(chapters[0].text, /2\. 體，分於兼也。/);
  assert.doesNotMatch(chapters[0].text, /小故/);
  assert.match(chapters[1].text, /故：小故/);
  assert.match(chapters[1].text, /體：若二之一/);
  assert.match(chapters[2].text, /101\. 止，類以行之/);
  assert.match(chapters[2].text, /102\. 推類之難/);
  assert.match(chapters[3].text, /止：彼以此其然也/);
});

test("extractEpubChapters prefers EPUB NCX anchors over spine files", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Pride and Prejudice",
      raw: `<h1 id="title">PRIDE and PREJUDICE</h1>
<p>Front matter should not become a chapter.</p>
<h2 id="c1">Chapter I.</h2>
<p>It is a truth universally acknowledged.</p>
<h2 id="c2">I hope Mr. Bingley will like it. CHAPTER II.</h2>
<p>Mr. Bennet was among the earliest.</p>
<h2 id="license">THE FULL PROJECT GUTENBERG LICENSE</h2>
<p>License text.</p>`,
    },
  ], {
    manifestItems: [`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`],
    spineAttrs: `toc="ncx"`,
    extraEntries: [{
      name: "OEBPS/toc.ncx",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>PRIDE and PREJUDICE</text></navLabel><content src="chapter1.xhtml#title"/></navPoint>
  <navPoint id="n2" playOrder="2"><navLabel><text>Chapter I.</text></navLabel><content src="chapter1.xhtml#c1"/></navPoint>
  <navPoint id="n3" playOrder="3"><navLabel><text>I hope Mr. Bingley will like it. CHAPTER II.</text></navLabel><content src="chapter1.xhtml#c2"/></navPoint>
  <navPoint id="n4" playOrder="4"><navLabel><text>THE FULL PROJECT GUTENBERG LICENSE</text></navLabel><content src="chapter1.xhtml#license"/></navPoint>
</navMap></ncx>`,
    }],
  });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["Chapter I.", "CHAPTER II."]);
  assert.match(chapters[0].text, /truth universally acknowledged/);
  assert.doesNotMatch(chapters[0].text, /Front matter/);
  assert.doesNotMatch(chapters[1].text, /I hope Mr\. Bingley/);
  assert.doesNotMatch(chapters[1].text, /License text/);
});

test("extractEpubChapters splits English chapter headings inside one spine file", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of A Novel",
      body: `CHAPTER I. First Chapter

Body one.

Illustration caption CHAPTER II.

Body two.`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["CHAPTER I. First Chapter", "CHAPTER II."]);
  assert.match(chapters[1].text, /Body two/);
});

test("extractEpubChapters recognizes spelled English chapter and stave headings", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Combined",
      body: `PREFACE

Short preface.

C. D.

CONTENTS

STAVE I
MARLEY'S GHOST

STAVE ONE.

Marley was dead: to begin with.

CHAPTER ONE PLAYING PILGRIMS

Christmas won't be Christmas without any presents.

CHAPTER TWO A MERRY CHRISTMAS

Jo was the first to wake.`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.deepEqual(chapters.map((ch) => ch.title), [
    "PREFACE",
    "STAVE ONE.",
    "CHAPTER ONE PLAYING PILGRIMS",
    "CHAPTER TWO A MERRY CHRISTMAS",
  ]);
});

test("extractEpubChapters reads nested NCX chapter points", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "Le rouge et le noir",
      raw: `<h1 id="vol">VOLUME PREMIER</h1>
<h2 id="c1">CHAPITRE PREMIER UNE PETITE VILLE</h2>
<p>La petite ville de Verrières.</p>
<h2 id="c2">CHAPITRE II UN MAIRE</h2>
<p>L'importance.</p>`,
    },
  ], {
    manifestItems: [`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`],
    spineAttrs: `toc="ncx"`,
    extraEntries: [{
      name: "OEBPS/toc.ncx",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="v" playOrder="1"><navLabel><text>VOLUME PREMIER</text></navLabel><content src="chapter1.xhtml#vol"/>
    <navPoint id="c1" playOrder="2"><navLabel><text>CHAPITRE PREMIER UNE PETITE VILLE</text></navLabel><content src="chapter1.xhtml#c1"/></navPoint>
    <navPoint id="c2" playOrder="3"><navLabel><text>CHAPITRE II UN MAIRE</text></navLabel><content src="chapter1.xhtml#c2"/></navPoint>
  </navPoint>
</navMap></ncx>`,
    }],
  });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["CHAPITRE PREMIER UNE PETITE VILLE", "CHAPITRE II UN MAIRE"]);
});

test("extractEpubChapters filters Gutenberg edition notices from navigation", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Adventures of Sherlock Holmes",
      raw: `<h1 id="notice">THERE IS AN ILLUSTRATED EDITION OF THIS TITLE WHICH MAY VIEWED AT EBOOK #48320</h1>
<p>Not a chapter.</p>
<h2 id="c1">I. A SCANDAL IN BOHEMIA</h2>
<p>To Sherlock Holmes she is always the woman.</p>
<h2 id="c2">II. THE RED-HEADED LEAGUE</h2>
<p>I had called upon my friend.</p>`,
    },
  ], {
    manifestItems: [`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`],
    spineAttrs: `toc="ncx"`,
    extraEntries: [{
      name: "OEBPS/toc.ncx",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="n" playOrder="1"><navLabel><text>THERE IS AN ILLUSTRATED EDITION OF THIS TITLE WHICH MAY VIEWED AT EBOOK #48320</text></navLabel><content src="chapter1.xhtml#notice"/></navPoint>
  <navPoint id="c1" playOrder="2"><navLabel><text>I. A SCANDAL IN BOHEMIA</text></navLabel><content src="chapter1.xhtml#c1"/></navPoint>
  <navPoint id="c2" playOrder="3"><navLabel><text>II. THE RED-HEADED LEAGUE</text></navLabel><content src="chapter1.xhtml#c2"/></navPoint>
</navMap></ncx>`,
    }],
  });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["I. A SCANDAL IN BOHEMIA", "II. THE RED-HEADED LEAGUE"]);
  assert.doesNotMatch(chapters[0].text, /ILLUSTRATED EDITION/);
});

test("extractEpubChapters splits Chinese numbered classic headings", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 論語",
      body: `學而第一

子曰：「學而時習之，不亦說乎？」

為政第二

子曰：「為政以德，譬如北辰。」`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["學而第一", "為政第二"]);
  assert.match(chapters[1].text, /為政以德/);
});

test("extractEpubChapters splits Chinese book-prefixed history chapter titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "史記",
      raw: `<p>史記 五帝本紀</p>
<p>黃帝者，少典之子。</p>
<p>史記 夏本紀</p>
<p>夏禹，名曰文命。</p>
<p>史記 項羽本紀</p>
<p>項籍者，下相人也。</p>`,
    },
  ], { title: "史記" });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["五帝本紀", "夏本紀", "項羽本紀"]);
  assert.match(chapters[2].text, /項籍者/);
});

test("extractEpubChapters scans same-title Chinese spine continuations before skipping noise titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "史記",
      headTitle: "史記",
      raw: `<p>史記 五帝本紀</p><p>黃帝者，少典之子。</p>`,
    },
    {
      title: "史記",
      headTitle: "史記",
      raw: `<p>前篇餘文。</p><p>史記 秦本紀</p><p>秦之先，帝顓頊之苗裔孫。</p>`,
    },
  ], { title: "史記" });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["五帝本紀", "秦本紀"]);
  assert.match(chapters[1].text, /帝顓頊/);
  assert.doesNotMatch(chapters[1].text, /前篇餘文/);
});

test("extractEpubChapters splits inline Chinese chapter headings in one paragraph", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "老子",
      raw: `<p>第一章
道可道，非常道。
第二章
天下皆知美之為美。
第三章
不尚賢，使民不爭。</p>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["第一章", "第二章", "第三章"]);
  assert.match(chapters[1].text, /^天下皆知美/);
});

test("extractEpubChapters splits Chinese chapter headings after prose punctuation", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "封神演義",
      raw: `<div>第一回&nbsp;&nbsp;紂王女媧宮進香</div>
<div>紂王登殿設朝。且聽下回分解。第二回&nbsp;&nbsp;冀州侯蘇護反商</div>
<div>眾諸侯進殿。</div>
<div>又聽下回分解。第三回&nbsp;&nbsp;姬昌解圍進妲己</div>
<div>話說姬昌已到。</div>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), [
    "第一回 紂王女媧宮進香",
    "第二回 冀州侯蘇護反商",
    "第三回 姬昌解圍進妲己",
  ]);
  assert.match(chapters[1].text, /眾諸侯進殿/);
});

test("extractEpubChapters splits Chinese hui headings without spacing before titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "西遊記",
      raw: `<p>第一回靈根育孕源流出<br/>詩曰：混沌未分天地亂。</p>
<p>第二回悟徹菩提真妙理<br/>話表美猴王得了姓名。</p>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), [
    "第一回靈根育孕源流出",
    "第二回悟徹菩提真妙理",
  ]);
  assert.match(chapters[0].text, /^詩曰/u);
  assert.match(chapters[1].text, /美猴王/);
});

test("extractEpubChapters splits Chinese hui headings with white-circle zero numerals", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "狄公案",
      raw: `<p>第十九回 巧斷金釵案</p><p>狄公升堂問案。</p>
<p>第二○回 夜審群盜</p><p>眾人齊聲稱冤。</p>
<p>第二十一回 水落石出</p><p>案情於是大白。</p>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["第十九回 巧斷金釵案", "第二○回 夜審群盜", "第二十一回 水落石出"]);
  assert.match(chapters[1].text, /眾人齊聲稱冤/);
});

test("extractEpubChapters carries terminal Chinese chapter headings to the next spine file", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "花月痕",
      headTitle: "花月痕",
      raw: `<p>第五十回 一戰平江</p><p>欲知後事如何，且聽下回分解。</p><p>第五十一回 無人無我一衲西歸</p>`,
    },
    {
      title: "花月痕",
      headTitle: "花月痕",
      raw: `<p>話說荷生班師，與小珠一路同行。</p><p>第五十二回 秋心院遺跡話故人</p><p>故人重逢，話及舊事。</p>`,
    },
  ], { title: "花月痕" });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["第五十回 一戰平江", "第五十一回 無人無我一衲西歸", "第五十二回 秋心院遺跡話故人"]);
  assert.match(chapters[1].text, /荷生班師/);
  assert.match(chapters[2].text, /故人重逢/);
});

test("extractEpubChapters prefers spine parsing when Chinese NCX misses chapters", async () => {
  const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const raw = numerals
    .map((n, index) => `<h2 id="c${index + 1}">第${n}回 章目${n}</h2><p>正文${n}。</p>`)
    .join("\n");
  const navPoints = numerals.slice(0, 8)
    .map((n, index) => `<navPoint id="n${index + 1}" playOrder="${index + 1}"><navLabel><text>第${n}回 章目${n}</text></navLabel><content src="chapter1.xhtml#c${index + 1}"/></navPoint>`)
    .join("\n");
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "花月痕",
      raw,
    },
  ], {
    manifestItems: [`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`],
    spineAttrs: `toc="ncx"`,
    extraEntries: [{
      name: "OEBPS/toc.ncx",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${navPoints}</navMap></ncx>`,
    }],
  });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 9);
  assert.deepEqual(chapters.map((ch) => ch.title), numerals.map((n) => `第${n}回 章目${n}`));
});

test("extractEpubChapters splits Chinese angle-bracket story titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "聊齋志異",
      raw: `<p>卷一</p>
<p>〈考城隍〉</p>
<p>予姊丈之祖宋公。</p>
<p>〈耳中人〉</p>
<p>譚晉玄，邑諸生也。</p>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["考城隍", "耳中人"]);
  assert.match(chapters[0].text, /宋公/);
});

test("extractEpubChapters splits Chinese headings inside same-title spine continuations", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "三國志演義",
      headTitle: "三國志演義",
      raw: `<p>第一回：宴桃園豪傑三結義</p><p>話說天下大勢，分久必合。</p>`,
    },
    {
      title: "三國志演義",
      headTitle: "三國志演義",
      raw: `<p>前文續段。</p><p>第二回：張翼德怒鞭督郵</p><p>且說董卓字仲穎。</p>`,
    },
  ], { title: "三國志演義" });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["第一回：宴桃園豪傑三結義", "第二回：張翼德怒鞭督郵"]);
  assert.match(chapters[1].text, /董卓字仲穎/);
});

test("extractEpubChapters merges prose-title continuations into the previous Chinese chapter", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "第二十三回 訊奸情臬司惹笑柄 造假信觀察賺優差",
      body: "卻說賈臬司聽了相士當面罵他的話，憤憤而歸。",
    },
    {
      title: "河南賈臬台：弟與某素無往來，前荐某丞未收。工程浩大，恐非某能勝任。",
      body: "下面注著一個「隱」字，賈臬台父子便知是周中堂的別號了。",
    },
    {
      title: "第二十四回 擺花酒大鬧喜春堂 撞木鐘初訪文殊院",
      body: "話說賈臬台的大少爺，自從造了一封周中堂的假信。",
    },
  ], { title: "官場現形記" });
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), [
    "第二十三回 訊奸情臬司惹笑柄 造假信觀察賺優差",
    "第二十四回 擺花酒大鬧喜春堂 撞木鐘初訪文殊院",
  ]);
  assert.match(chapters[0].text, /河南賈臬台/);
  assert.match(chapters[0].text, /下面注著/);
});

test("extractEpubChapters merges numbered aphorism spine continuations", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "八佾第三",
      body: "1. 孔子謂季氏，「八佾舞於庭，是可忍也，孰不可忍也？」",
    },
    {
      title: "2. 三家者以雍徹。",
      body: "3. 子曰：「人而不仁，如禮何？人而不仁，如樂何？」",
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "八佾第三");
  assert.match(chapters[0].text, /2\. 三家者以雍徹。/);
});

test("extractEpubChapters splits chapter headings that share a paragraph with body", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 韩非子",
      body: `《三守》
1 三守: 人主有三守。

《備內》 1 備內: 人主之患在於信人。

《南面》   提到《南面》的書籍
1 南面: 人主之過，在己任在臣矣。`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["三守", "備內", "南面"]);
  assert.match(chapters[2].text, /人主之過/);
});

test("extractEpubChapters splits numbered poem anthologies", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 唐诗三百首",
      body: `唐詩三百首
001
感遇（四首之一）
作者：張九齡
孤鴻海上來，
池潢不敢顧；
002
感遇（四首之二）
作者：張九齡
蘭葉春葳蕤，
桂華秋皎潔；`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["001 感遇（四首之一） · 張九齡", "002 感遇（四首之二） · 張九齡"]);
  assert.match(chapters[1].text, /蘭葉春葳蕤/);
});

test("extractEpubChapters splits numbered poems without author markers", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 詩經",
      body: `國風

周南

1. 關睢 關關雎鳩、在河之洲。

2. 葛覃 葛之覃兮、施于中谷。

257. 桑柔 菀彼桑柔、其下侯旬。`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["1. 關睢", "2. 葛覃", "257. 桑柔"]);
  assert.match(chapters[0].text, /關關雎鳩/);
});

test("extractEpubChapters does not split numbered collation notes as poems", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 墨子",
      body: `《親士》

1 親士: 入國而不存其士，則亡國矣。

1. 干 : 原錯為“于”。自孫詒讓《墨子閒詁》改。`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "親士");
  assert.match(chapters[0].text, /原錯為/);
});

test("extractEpubChapters splits inline volume titles", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "The Project Gutenberg eBook of 孟子",
      body: `卷之一梁惠王上
孟子見梁惠王。
卷之一梁惠王下
莊暴見孟子。
卷之二公孫丑上
公孫丑問曰。`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((ch) => ch.title), ["卷之一梁惠王上", "卷之一梁惠王下", "卷之二公孫丑上"]);
  assert.match(chapters[2].text, /公孫丑問曰/);
});

test("extractEpubChapters uses bare Chinese volume markers when no finer chapter headings exist", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice", [
    {
      title: "孟子",
      raw: `<p>卷之一<br/>孟子見梁惠王。王曰：「叟不遠千里而來。」</p>
<p>卷之二<br/>公孫丑問曰：「夫子當路於齊。」</p>`,
    },
  ]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((ch) => ch.title), ["卷之一", "卷之二"]);
  assert.match(chapters[0].text, /梁惠王/);
  assert.match(chapters[1].text, /公孫丑/);
});

test("createIngestPayload builds backend ingest payload from a manifest", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph."]);
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  const payload = await createIngestPayload(manifest, { id: "dao" });

  assert.equal(payload.id, "dao");
  assert.equal(payload.title, "Dao De Jing");
  assert.equal(payload.author, "Laozi");
  assert.equal(payload.license, "CC0-1.0");
  assert.equal(payload.epubSha256, manifest.assets.epub.sha256);
  assert.equal(payload.epubMediaType, "application/epub+zip");
  assert.equal(Buffer.from(payload.epubBase64, "base64").toString("utf8").includes("application/epub+zip"), true);
  assert.equal(payload.chapters.length, 1);
  assert.match(payload.chapters[0].text, /First paragraph\./);
});

test("createIngestPayload rejects an EPUB that no longer matches the manifest hash", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["Original paragraph."]);
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  await writeFile(epubPath, "not the packaged epub anymore");

  await assert.rejects(
    () => createIngestPayload(manifest),
    /EPUB file no longer matches/,
  );
});

test("publishBookManifest posts ingest payload with admin authorization", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph."]);
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });

  const requests = [];
  const result = await publishBookManifest(manifest, {
    apiUrl: "https://liber.example",
    adminToken: "secret-token",
    id: "dao",
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, book: { id: "dao" }, chapters: requests[0].body.chapters.length }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://liber.example/api/books/ingest");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.authorization, "Bearer secret-token");
  assert.equal(requests[0].body.chapters.length, 1);
});

test("publishBookManifestChunked posts source, chapters, and finalize requests", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph.", "Second paragraph."]);
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });

  const requests = [];
  const result = await publishBookManifestChunked(manifest, {
    apiUrl: "https://liber.example",
    adminToken: "secret-token",
    id: "dao",
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, init, body });
      const response = url.endsWith("/finalize")
        ? { ok: true, book: { id: "dao" }, chapters: body.chapterNumbers.length, manifest: { key: "book/dao/manifest" } }
        : { ok: true };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url, "https://liber.example/api/books/ingest/begin");
  assert.equal(requests[1].url, "https://liber.example/api/books/ingest/chapter");
  assert.equal(requests[2].body.chapter.title, "Chapter 2");
  assert.equal(requests[3].url, "https://liber.example/api/books/ingest/finalize");
  assert.deepEqual(requests[3].body.chapterNumbers, [1, 2]);
  assert.ok(requests.every((req) => req.init.headers.authorization === "Bearer secret-token"));
});

test("CLI auth login/status/logout persists config without leaking the token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-config-"));
  const configPath = path.join(dir, "config.json");
  const env = { ...process.env, LIBER_CONFIG: configPath };

  await execFileAsync(process.execPath, [CLI_PATH, "auth", "login", "--api-url", "https://liber.example", "--admin-token", "secret-token", "--wallet", "0xabc"], { env });
  const status = await execFileAsync(process.execPath, [CLI_PATH, "auth", "status", "--json"], { env });
  const parsed = JSON.parse(status.stdout);

  assert.equal(parsed.apiUrl, "https://liber.example");
  assert.equal(parsed.wallet, "0xabc");
  assert.equal(parsed.adminTokenConfigured, true);
  assert.doesNotMatch(status.stdout, /secret-token/);

  await execFileAsync(process.execPath, [CLI_PATH, "auth", "logout"], { env });
  const after = await loadCliConfig({ configPath });
  assert.deepEqual(after, {});
});

test("CLI auth browser accepts --no-open as a boolean flag", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [CLI_PATH, "auth", "browser", "--no-open", "--timeout", "0", "--api-url", "not-a-url"]),
    (error) => {
      assert.doesNotMatch(error.stderr, /Missing value for --no-open/);
      return true;
    },
  );
});

test("core auth config helpers persist and clear config", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-core-config-"));
  const configPath = path.join(dir, "config.json");

  await saveCliConfig({ apiUrl: "https://liber.example", adminToken: "secret-token" }, { configPath });
  const loaded = await loadCliConfig({ configPath });
  assert.equal(loaded.apiUrl, "https://liber.example");
  assert.equal(loaded.adminToken, "secret-token");

  await clearCliConfig({ configPath });
  assert.deepEqual(await loadCliConfig({ configPath }), {});
});

test("browser auth flow starts, polls, and returns a publish token", async () => {
  const calls = [];
  const start = await startBrowserAuth({
    apiUrl: "https://liber.example",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        deviceCode: "device-1",
        userCode: "ABC123",
        authorizeUrl: "https://liber.example/?cli_auth=device-1",
        interval: 1,
      }), { status: 200 });
    },
  });
  assert.equal(start.apiUrl, "https://liber.example");
  assert.equal(start.deviceCode, "device-1");

  let polls = 0;
  const approved = await waitForBrowserAuth(start, {
    intervalMs: 1,
    timeoutMs: 100,
    sleep: async () => {},
    fetchImpl: async (url) => {
      polls += 1;
      assert.equal(url, "https://liber.example/api/auth/cli/poll/device-1");
      return new Response(JSON.stringify(polls === 1 ? { status: "pending" } : { status: "approved", token: "cli-token", user: { wallet: "0xabc" } }), { status: 200 });
    },
  });
  assert.equal(approved.token, "cli-token");
  assert.equal(calls[0].url, "https://liber.example/api/auth/cli/start");
});

test("private-key auth signs a nonce and exchanges the session for a publish token", async () => {
  const requests = [];
  const approved = await signInWithSuiPrivateKey({
    apiUrl: "https://liber.example",
    keypair: {
      toSuiAddress: () => "0xabc",
      signPersonalMessage: async (bytes) => {
        assert.equal(new TextDecoder().decode(bytes), "Liber 登录\nnonce: n1");
        return { signature: "signed-message" };
      },
    },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith("/api/auth/nonce")) {
        return new Response(JSON.stringify({ nonce: "n1", message: "Liber 登录\nnonce: n1" }), { status: 200 });
      }
      if (url.endsWith("/api/auth/verify")) {
        const body = JSON.parse(init.body);
        assert.equal(body.address, "0xabc");
        assert.equal(body.signature, "signed-message");
        return new Response(JSON.stringify({ token: "session-token", user: { wallet: "0xabc" } }), { status: 200 });
      }
      if (url.endsWith("/api/auth/cli/token")) {
        assert.equal(init.headers.authorization, "Bearer session-token");
        return new Response(JSON.stringify({ token: "publish-token", wallet: "0xabc", expiresIn: 30 }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  assert.equal(approved.token, "publish-token");
  assert.equal(approved.wallet, "0xabc");
  assert.deepEqual(requests.map((r) => r.url), [
    "https://liber.example/api/auth/nonce",
    "https://liber.example/api/auth/verify",
    "https://liber.example/api/auth/cli/token",
  ]);
});

test("private-key auth requires a scheme for raw hex keys", async () => {
  await assert.rejects(
    () => signInWithSuiPrivateKey({ apiUrl: "https://liber.example", privateKey: "00".repeat(32) }),
    /Raw hex Sui private keys require --scheme/,
  );
});

test("CLI publish supports dry-run and requires a token for real publish", async () => {
  const { epubPath, dir } = await writeEpub();
  const env = {
    ...process.env,
    LIBER_CONFIG: path.join(dir, "empty-config.json"),
    LIBER_ADMIN_TOKEN: "",
    ADMIN_TOKEN: "",
  };
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = await execFileAsync(process.execPath, [CLI_PATH, "book", "publish", manifestPath, "--dry-run"], { env });
  assert.match(result.stdout, /Dry-run publish plan/);

  await assert.rejects(
    () => execFileAsync(process.execPath, [CLI_PATH, "book", "publish", manifestPath], { env }),
    /Publish token is required/,
  );

  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(parsed.schema, "liber.book-manifest.v1");
});
