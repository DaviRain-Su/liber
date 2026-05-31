import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BOOKS,
  DEFAULT_IMPORT_LANGS,
  auditBookCatalog,
  chapterQualityWarnings,
  cleanGutenbergPayload,
  selectBooks,
  summarizeCatalogAudit,
  summarizeOutput,
} from "../scripts/import-gutenberg-classics.mjs";
import { LANGUAGE_LABELS } from "../src/lib/languages.js";

test("Gutenberg import candidates are uniquely keyed and classified by language", () => {
  const audit = auditBookCatalog(BOOKS);
  assert.equal(audit.ok, true, audit.errors.join("\n"));
  assert.equal(audit.total >= 600, true, "candidate list should keep broad multilingual coverage");
  assert.equal(Object.keys(audit.byLang).length >= 20, true, "candidate list should remain multilingual");
  for (const lang of ["zh", "en", "ja", "sa", "ar", "fa", "fr", "de", "pt", "la"]) {
    assert.equal(audit.byLang[lang] > 0, true, `expected ${lang} catalog entries`);
  }
  assert.equal(audit.byLang.ko || 0, 0, "known Gutenberg Korean entry is copyrighted, so it must stay excluded");
});

test("Gutenberg import catalog audit rejects duplicate sources and bad language categories", () => {
  const fixture = [
    { id: "one-gutenberg-en", pg: 1, lang: "en", title: "One", category: "English · Fiction", expect: "One" },
    { id: "two-gutenberg-en", pg: 1, lang: "zh", title: "Two", category: "English · Fiction", expect: "Two" },
  ];
  const audit = auditBookCatalog(fixture);
  assert.equal(audit.ok, false);
  assert.match(audit.errors.join("\n"), /duplicate Project Gutenberg ebook #1/);
  assert.match(audit.errors.join("\n"), /must start with "中文 · "/);
});

test("Gutenberg catalog audit summary reports language buckets without network", () => {
  const summary = summarizeCatalogAudit(auditBookCatalog(BOOKS), BOOKS);
  assert.equal(summary.mode, "catalog-audit");
  assert.equal(summary.ok, true);
  assert.equal(summary.total, BOOKS.length);
  assert.equal(summary.languages, Object.keys(summary.byLang).length);
  assert.equal(summary.byLang.zh >= 300, true);
  assert.equal(summary.byLang.ja >= 10, true);
  assert.equal(summary.byLang.sa, 1);
  assert.equal(summary.byLang.ar, 1);
  assert.equal(summary.byLang.fa, 1);
  assert.equal(summary.firstCandidates[0].source, undefined);
  for (const lang of Object.keys(summary.byLang)) {
    assert.ok(LANGUAGE_LABELS[lang], `book language ${lang} must have a shared UI label`);
  }
  assert.equal(LANGUAGE_LABELS.ko.name, "한국어");
  assert.equal(LANGUAGE_LABELS.sa.name, "संस्कृतम्");
  assert.equal(LANGUAGE_LABELS.ar.name, "العربية");
  assert.equal(LANGUAGE_LABELS.fa.name, "فارسی");
});

test("Gutenberg import batches can be selected by language before network work", () => {
  assert.deepEqual(DEFAULT_IMPORT_LANGS, ["zh"]);
  assert.equal(selectBooks({ defaultLangs: DEFAULT_IMPORT_LANGS }, BOOKS).length, 316);
  assert.equal(selectBooks({ defaultLangs: DEFAULT_IMPORT_LANGS, allLangs: true }, BOOKS).length, BOOKS.length);

  const zh = selectBooks({ langs: ["zh"] }, BOOKS);
  assert.equal(zh.length, 316);
  assert.equal(zh.every((book) => book.lang === "zh"), true);

  const zhPage = selectBooks({ langs: ["zh"], limit: 5, offset: 10 }, BOOKS);
  assert.equal(zhPage.length, 5);
  assert.deepEqual(zhPage, zh.slice(10, 15));

  const jaSample = selectBooks({ langs: ["ja"], ids: ["rashomon-gutenberg-ja"] }, BOOKS);
  assert.deepEqual(jaSample.map((book) => book.id), ["rashomon-gutenberg-ja"]);

  const sanskrit = selectBooks({ langs: ["梵文"] }, BOOKS);
  assert.deepEqual(sanskrit.map((book) => book.id), ["sri-vishnu-sahasranaamam-gutenberg-sa"]);

  const explicitIdBypassesDefaultZh = selectBooks({
    defaultLangs: DEFAULT_IMPORT_LANGS,
    ids: ["frankenstein-gutenberg-en"],
  }, BOOKS);
  assert.deepEqual(explicitIdBypassesDefaultZh.map((book) => book.id), ["frankenstein-gutenberg-en"]);

  const summary = summarizeCatalogAudit(auditBookCatalog(zh), zh);
  assert.deepEqual(summary.byLang, { zh: zh.length });
  assert.throws(() => selectBooks({ langs: ["zz"] }, BOOKS), /Unknown language codes: zz/);
  assert.throws(() => selectBooks({ langs: ["ja"], offset: 99 }, BOOKS), /No matching books/);
});

test("Gutenberg quality checks reject suspicious Chinese chapter numbering gaps", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一回 起首", text: "一" },
    { title: "第二回 承接", text: "二" },
    { title: "第四回 跳號", text: "四" },
    { title: "第五回 繼續", text: "五" },
    { title: "第一一二回 後段", text: "一一二" },
  ]);
  assert.match(warnings.join("\n"), /Chinese 回 headings have numbering gaps/);
  assert.match(warnings.join("\n"), /missing 3, 6-111/);
});

test("Gutenberg quality checks allow contiguous Chinese chapter numbering", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一回 起首", text: "一" },
    { title: "第二回 承接", text: "二" },
    { title: "第三回 轉折", text: "三" },
    { title: "第四回 收束", text: "四" },
    { title: "第五回 後續", text: "五" },
    { title: "第六回 終章", text: "六" },
    { title: "第七回 餘波", text: "七" },
    { title: "第八回 結尾", text: "八" },
  ]);
  assert.doesNotMatch(warnings.join("\n"), /numbering gaps/);
});

test("Gutenberg quality checks parse Chinese white-circle zero numerals", () => {
  const titles = ["第一回", "第二回", "第三回", "第四回", "第五回", "第六回", "第七回", "第八回", "第九回", "第一○回", "第一一回"];
  const warnings = chapterQualityWarnings(titles.map((title) => ({ title, text: "正文" })));
  assert.doesNotMatch(warnings.join("\n"), /numbering gaps/);
});

test("Gutenberg quality checks reject Chinese TOC fragments as headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "第1 回 海瑞初生 第2 回 張居正入朝 第3 回 太后垂簾", text: "目录" },
    { title: "第一回 正文", text: "正文" },
  ]);
  assert.match(warnings.join("\n"), /Chinese TOC-fragment headings/);
});

test("Gutenberg quality checks reject Japanese prose sentence headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "貴樣 きさま 如何 どう したのか？ まあ、 坐 すわ れ。", text: "本文" },
    { title: "第二章", text: "本文" },
  ]);
  assert.match(warnings.join("\n"), /prose-fragment-looking headings/);
});

test("Gutenberg quality checks reject Japanese dialogue-heavy heading sets", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一章", text: "本文" },
    { title: "おまえがそう言うならな", text: "本文" },
    { title: "第二章", text: "本文" },
    { title: "それで？", text: "本文" },
    { title: "第三章", text: "本文" },
    { title: "しかし……殺人となると……", text: "本文" },
    { title: "そうだと思います", text: "本文" },
    { title: "第七章", text: "本文" },
  ]);
  assert.match(warnings.join("\n"), /Japanese prose-fragment-looking headings/);
});

test("Gutenberg quality checks allow structured Japanese headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一章", text: "本文" },
    { title: "第二章", text: "本文" },
    { title: "第三章", text: "本文" },
    { title: "馬具 ばぐ に 入 はい つた 狼 おほかみ", text: "本文" },
    { title: "トルコ 豆 まめ と 月 つき の 話 はなし", text: "本文" },
    { title: "鯨 くぢら と 軍艦 ぐんかん の 話 はなし", text: "本文" },
    { title: "第七章", text: "本文" },
    { title: "第八章", text: "本文" },
  ]);
  assert.doesNotMatch(warnings.join("\n"), /Japanese prose-fragment-looking headings/);
});

test("Gutenberg quality checks reject Latin-script chapter numbering gaps", () => {
  const warnings = chapterQualityWarnings([
    { title: "CHAPITRE PREMIER UNE PETITE VILLE", text: "texte" },
    { title: "CHAPITRE II UN MAIRE", text: "texte" },
    { title: "CHAPITRE III LE BIEN DES PAUVRES", text: "texte" },
    { title: "CHAPITRE IV UN PÈRE ET UN FILS", text: "texte" },
    { title: "CHAPITRE VI L'ENNUI", text: "texte" },
    { title: "CHAPITRE VII LES AFFINITÉS", text: "texte" },
    { title: "CHAPITRE VIII UNE SOIRÉE", text: "texte" },
    { title: "CHAPITRE IX UNE CAPITALE", text: "texte" },
  ]);
  assert.match(warnings.join("\n"), /CHAPITRE headings have numbering gaps: missing 5/);
});

test("Gutenberg quality checks reject Portuguese CAPITULO numbering gaps", () => {
  const warnings = chapterQualityWarnings([
    ...Array.from({ length: 25 }, (_, index) => ({
      title: `CAPITULO ${index === 0 ? "PRIMEIRO" : ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV"][index - 1]}.`,
      text: "texto",
    })),
    { title: "CAPITULO XXVII.", text: "texto" },
    { title: "CAPITULO XXVIII.", text: "texto" },
    { title: "CAPITULO XXIX.", text: "texto" },
    { title: "CAPITULO XXX.", text: "texto" },
  ]);
  assert.match(warnings.join("\n"), /CAPITULO headings have numbering gaps: missing 26/);
});

test("Gutenberg quality checks reject Catalan CAPÍTOL numbering gaps", () => {
  const warnings = chapterQualityWarnings([
    { title: "CAPÍTOL V", text: "text" },
    { title: "CAPÍTOL VIII", text: "text" },
    { title: "CAPÍTOL XI", text: "text" },
    { title: "CAPÍTOL XIV", text: "text" },
  ]);
  assert.match(warnings.join("\n"), /CAPÍTOL headings have numbering gaps: start at 5/);
});

test("Gutenberg quality checks reject Italian CAPITOLO numbering gaps", () => {
  const warnings = chapterQualityWarnings([
    { title: "CAPITOLO PRIMO", text: "testo" },
    { title: "CAPITOLO II", text: "testo" },
    { title: "CAPITOLO III", text: "testo" },
    { title: "CAPITOLO IV", text: "testo" },
    { title: "CAPITOLO V", text: "testo" },
    { title: "CAPITOLO VI", text: "testo" },
    { title: "CAPITOLO VII", text: "testo" },
    { title: "CAPITOLO VIII", text: "testo" },
    { title: "CAPITOLO X", text: "testo" },
  ]);
  assert.match(warnings.join("\n"), /CAPITOLO headings have numbering gaps: missing 9/);
});

test("Gutenberg quality checks allow Latin-script chapter resets across parts", () => {
  const warnings = chapterQualityWarnings([
    { title: "CHAPTER I. The Start", text: "text" },
    { title: "CHAPTER II. The Road", text: "text" },
    { title: "CHAPTER III. The Turn", text: "text" },
    { title: "CHAPTER IV. The Close", text: "text" },
    { title: "CHAPTER I. The Return", text: "text" },
    { title: "CHAPTER II. The Door", text: "text" },
    { title: "CHAPTER III. The End", text: "text" },
  ]);
  assert.doesNotMatch(warnings.join("\n"), /numbering gaps/);
});

test("Gutenberg quality checks reject pure roman numeral title lists without part markers", () => {
  const warnings = chapterQualityWarnings([
    { title: "I", text: "text" },
    { title: "II", text: "text" },
    { title: "III", text: "text" },
    { title: "IV", text: "text" },
    { title: "V", text: "text" },
    { title: "VI", text: "text" },
    { title: "VII", text: "text" },
    { title: "VIII", text: "text" },
    { title: "IX", text: "text" },
    { title: "X", text: "text" },
    { title: "XI", text: "text" },
    { title: "XII", text: "text" },
  ]);
  assert.match(warnings.join("\n"), /pure roman-numeral headings/);
});

test("Gutenberg quality checks reject incomplete pure roman heading runs", () => {
  const warnings = chapterQualityWarnings([
    { title: "La carità del prossimo", text: "text" },
    { title: "V.", text: "text" },
    { title: "VIII.", text: "text" },
    { title: "X.", text: "text" },
    { title: "XIII.", text: "text" },
    { title: "XVII .", text: "text" },
    { title: "XX .", text: "text" },
    { title: "XXIII .", text: "text" },
    { title: "XXVI .", text: "text" },
    { title: "XXX .", text: "text" },
  ]);
  assert.match(warnings.join("\n"), /Pure roman-numeral headings start at 5/);
});

test("Gutenberg quality checks reject mixed generated Chapter N headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "Kåtornas folk", text: "text" },
    { title: "Chapter 2", text: "text" },
    { title: "Chapter 3", text: "text" },
    { title: "Havet.", text: "text" },
  ]);
  assert.match(warnings.join("\n"), /generated-looking Chapter N headings/);
});

test("Gutenberg quality checks reject malformed roman fragment headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "III \" Suomessa.", text: "Text" },
    { title: "KOLMAS NÄYTÖS.", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /malformed roman-fragment headings/);
});

test("Gutenberg quality checks allow roman numeral chapters with part markers", () => {
  const warnings = chapterQualityWarnings([
    { title: "PREMIÈRE PARTIE", text: "text" },
    { title: "II", text: "text" },
    { title: "III", text: "text" },
    { title: "IV", text: "text" },
    { title: "V", text: "text" },
    { title: "VI", text: "text" },
    { title: "VII", text: "text" },
    { title: "VIII", text: "text" },
    { title: "DEUXIÈME PARTIE", text: "text" },
    { title: "II", text: "text" },
    { title: "III", text: "text" },
    { title: "IV", text: "text" },
  ]);
  assert.doesNotMatch(warnings.join("\n"), /pure roman-numeral headings/);
});

test("Gutenberg quality checks reject sparse German Kapitel ordinals", () => {
  const warnings = chapterQualityWarnings([
    { title: "Drittes Kapitel", text: "Text" },
    { title: "Siebentes Kapitel", text: "Text" },
    { title: "Zehntes Kapitel", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /German Kapitel headings have numbering gaps/);
  assert.match(warnings.join("\n"), /missing 4-6, 8-9/);
});

test("Gutenberg quality checks reject sparse Dutch Hoofdstuk ordinals", () => {
  const warnings = chapterQualityWarnings([
    { title: "VYFDE HOOFDSTUK", text: "Text" },
    { title: "ZEVENDE HOOFDSTUK", text: "Text" },
    { title: "ACHTSTE HOOFDSTUK", text: "Text" },
    { title: "TIENDE HOOFDSTUK", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /Dutch Hoofdstuk headings have numbering gaps/);
  assert.match(warnings.join("\n"), /start at 5/);
});

test("Gutenberg quality checks reject sparse Swedish Kapitlet ordinals", () => {
  const warnings = chapterQualityWarnings([
    { title: "SJUNDE KAPITLET. Jesu efterföljelse.", text: "Text" },
    { title: "TIONDE KAPITLET. Tidningsaktiebolaget.", text: "Text" },
    { title: "FJORTONDE KAPITLET. Absint.", text: "Text" },
    { title: "SJUTTONDE KAPITLET. Natura.", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /Swedish Kapitlet headings have numbering gaps/);
  assert.match(warnings.join("\n"), /start at 7/);
});

test("Gutenberg quality checks reject sparse KAP roman ordinals", () => {
  const warnings = chapterQualityWarnings([
    { title: "KAP. IV. Två världar.", text: "Text" },
    { title: "KAP. VII. Drivhusblommor.", text: "Text" },
    { title: "KAP. XVI. Tidsröster.", text: "Text" },
    { title: "KAP. XIX. Colossus.", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /KAP\. headings have numbering gaps/);
  assert.match(warnings.join("\n"), /start at 4/);
});

test("Gutenberg quality checks reject sparse Finnish LUKU and NÄYTÖS ordinals", () => {
  const lukuWarnings = chapterQualityWarnings([
    { title: "KOLMAS LUKU.", text: "Text" },
    { title: "KUUDES LUKU.", text: "Text" },
    { title: "YHDEKSÄS LUKU.", text: "Text" },
  ]);
  assert.match(lukuWarnings.join("\n"), /Finnish LUKU headings have numbering gaps/);
  assert.match(lukuWarnings.join("\n"), /start at 3/);

  const actWarnings = chapterQualityWarnings([
    { title: "KOLMAS NÄYTÖS", text: "Text" },
    { title: "NELJÄS NÄYTÖS.", text: "Text" },
  ]);
  assert.match(actWarnings.join("\n"), /Finnish NÄYTÖS headings have numbering gaps/);
  assert.match(actWarnings.join("\n"), /start at 3/);
});

test("Gutenberg quality checks reject sparse Nordic AKT ordinals", () => {
  const warnings = chapterQualityWarnings([
    { title: "TREDJE AKT.", text: "Text" },
    { title: "FJERDE AKT.", text: "Text" },
    { title: "FEMTE AKT.", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /Nordic AKT headings have numbering gaps/);
  assert.match(warnings.join("\n"), /start at 3/);
});

test("Gutenberg quality checks reject sparse Nordic HANDLING and STYKKE ordinals", () => {
  const handlingWarnings = chapterQualityWarnings([
    { title: "ANDEN HANDLING.", text: "Text" },
    { title: "FJERDE HANDLING.", text: "Text" },
  ]);
  assert.match(handlingWarnings.join("\n"), /Nordic HANDLING headings have numbering gaps/);
  assert.match(handlingWarnings.join("\n"), /missing 3/);

  const stykkeWarnings = chapterQualityWarnings([
    { title: "FEMTE STYKKE. Et veddeløb.", text: "Text" },
    { title: "TIENDE STYKKE. Fremmede reisende.", text: "Text" },
  ]);
  assert.match(stykkeWarnings.join("\n"), /Nordic STYKKE headings have numbering gaps/);
  assert.match(stykkeWarnings.join("\n"), /start at 5/);
});

test("Gutenberg quality checks reject leading roman numeral gaps", () => {
  const warnings = chapterQualityWarnings([
    { title: "I. Baronens reise.", text: "Text" },
    { title: "II. Jagthistorier.", text: "Text" },
    { title: "III. Hunder og hester.", text: "Text" },
    { title: "IV. Krigen.", text: "Text" },
    { title: "V. Hjemreisen.", text: "Text" },
    { title: "VI. Sjøreiser.", text: "Text" },
    { title: "VII. Anden sjøreise.", text: "Text" },
    { title: "VIII. Tredje sjøreise.", text: "Text" },
    { title: "IX. Fjerde sjøreise.", text: "Text" },
    { title: "X. Kairo.", text: "Text" },
    { title: "XII. Adjutantens beretning.", text: "Text" },
    { title: "XIII. Gibraltar.", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /Leading roman-numeral headings have numbering gaps/);
  assert.match(warnings.join("\n"), /missing 11/);
});

test("Gutenberg quality checks reject repeated drama title TOCs", () => {
  const warnings = chapterQualityWarnings([
    { title: "Gildet på Solhaug", text: "Text" },
    { title: "Gildet Paa Solhaug", text: "Text" },
    { title: "Gildet Paa Solhaug", text: "Text" },
    { title: "Gildet Paa Solhaug", text: "Text" },
    { title: "Gildet Paa Solhaug", text: "Text" },
    { title: "Gildet Paa Solhaug", text: "Text" },
  ]);
  assert.match(warnings.join("\n"), /duplicate-looking chapter headings/);
});

test("Gutenberg cleanup can merge known prose-heading books into one chapter", () => {
  const book = BOOKS.find((row) => row.id === "kesshoki-gutenberg-ja");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "貴樣 きさま 如何 どう したのか？ まあ、 坐 すわ れ。", text: "第一段" },
      { n: 2, title: "赤 あか い 笑 わらひ だ", text: "第二段" },
    ],
  });
  assert.equal(payload.chapters.length, 1);
  assert.equal(payload.chapters[0].title, "血笑記");
  assert.match(payload.chapters[0].text, /貴樣/);
  assert.match(payload.chapters[0].text, /第二段/);
});

test("Gutenberg cleanup merges known weak poetry title lists into one chapter", () => {
  const book = BOOKS.find((row) => row.id === "fleurs-du-mal-gutenberg-fr");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "I", text: "Spleen" },
      { n: 2, title: "II", text: "Idéal" },
    ],
  });
  assert.equal(payload.chapters.length, 1);
  assert.equal(payload.chapters[0].title, "Les Fleurs du Mal");
  assert.match(payload.chapters[0].text, /Spleen/);
  assert.match(payload.chapters[0].text, /Idéal/);
});

test("Gutenberg cleanup merges Taugenichts into one chapter", () => {
  const book = BOOKS.find((row) => row.id === "taugenichts-gutenberg-de");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "IM", text: "Erstes Kapitel" },
      { n: 2, title: "Drittes Kapitel", text: "Drittes Kapitel" },
      { n: 3, title: "Zehntes Kapitel", text: "Zehntes Kapitel" },
    ],
  });
  assert.equal(payload.chapters.length, 1);
  assert.equal(payload.chapters[0].title, "Aus dem Leben eines Taugenichts");
  assert.match(payload.chapters[0].text, /Erstes Kapitel/);
  assert.match(payload.chapters[0].text, /Zehntes Kapitel/);
});

test("Gutenberg cleanup merges Viagens into one chapter", () => {
  const book = BOOKS.find((row) => row.id === "viagens-minha-terra-gutenberg-pt");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "CAPITULO XXV.", text: "vinte cinco" },
      { n: 2, title: "CAPITULO XXVII.", text: "vinte sete" },
    ],
  });
  assert.equal(payload.chapters.length, 1);
  assert.equal(payload.chapters[0].title, "Viagens na Minha Terra");
  assert.match(payload.chapters[0].text, /vinte cinco/);
  assert.match(payload.chapters[0].text, /vinte sete/);
});

test("Gutenberg cleanup merges known weak Dutch TOCs into one chapter", () => {
  for (const id of ["max-havelaar-gutenberg-nl", "onder-moeders-vleugels-gutenberg-nl", "prometheus-geboeid-gutenberg-nl", "noli-me-tangere-gutenberg-nl"]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "VYFDE HOOFDSTUK", text: "vijf" },
        { n: 2, title: "ZEVENDE HOOFDSTUK", text: "zeven" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /vijf/);
    assert.match(payload.chapters[0].text, /zeven/);
  }
});

test("Gutenberg cleanup merges known weak Swedish TOCs into one chapter", () => {
  for (const id of ["roda-rummet-gutenberg-sv", "hemsoborna-gutenberg-sv", "kalevala-sv-gutenberg-sv", "teckningar-drommar-gutenberg-sv", "katornas-folk-gutenberg-sv", "moloks-leende-gutenberg-sv"]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "SJUNDE KAPITLET", text: "sju" },
        { n: 2, title: "TIONDE KAPITLET", text: "tio" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /sju/);
    assert.match(payload.chapters[0].text, /tio/);
  }
});

test("Gutenberg cleanup merges known weak Finnish TOCs into one chapter", () => {
  for (const id of ["agamemnon-gutenberg-fi", "kavaluus-rakkaus-gutenberg-fi", "rautakorko-gutenberg-fi", "sointula-gutenberg-fi"]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "KOLMAS LUKU", text: "kolmas" },
        { n: 2, title: "KUUDES LUKU", text: "kuudes" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /kolmas/);
    assert.match(payload.chapters[0].text, /kuudes/);
  }
});

test("Gutenberg cleanup merges known weak Danish TOCs into one chapter", () => {
  for (const id of ["pelle-erobreren-1-gutenberg-da", "tine-gutenberg-da", "kongens-fald-gutenberg-da"]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "I", text: "første" },
        { n: 2, title: "II", text: "anden" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /første/);
    assert.match(payload.chapters[0].text, /anden/);
  }
});

test("Gutenberg cleanup merges known weak Norwegian TOCs into one chapter", () => {
  for (const id of [
    "vildanden-gutenberg-no",
    "sult-gutenberg-no",
    "markens-grode-1-gutenberg-no",
    "markens-grode-2-gutenberg-no",
    "fru-inger-gutenberg-no",
    "haermaendene-helgeland-gutenberg-no",
    "gildet-solhaug-gutenberg-no",
    "baron-munchhausen-gutenberg-no",
    "onkel-toms-hytte-gutenberg-no",
  ]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "I", text: "første" },
        { n: 2, title: "II", text: "andre" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /første/);
    assert.match(payload.chapters[0].text, /andre/);
  }
});

test("Gutenberg cleanup merges known weak Polish TOCs into one chapter", () => {
  for (const id of [
    "pan-tadeusz-gutenberg-pl",
    "tajemnica-baskerville-gutenberg-pl",
    "romeo-julia-gutenberg-pl",
    "grazyna-gutenberg-pl",
    "balady-romanse-gutenberg-pl",
    "sonety-mickiewicza-gutenberg-pl",
    "odkrycia-wynalazki-gutenberg-pl",
    "sklepy-cynamonowe-gutenberg-pl",
    "laka-lesmian-gutenberg-pl",
  ]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "UWAGI DO WYDANIA ELEKTRONICZNEGO", text: "uwagi" },
        { n: 2, title: "IV", text: "cztery" },
        { n: 3, title: "SCENA III.", text: "scena" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /uwagi/);
    assert.match(payload.chapters[0].text, /scena/);
  }
});

test("Gutenberg cleanup merges known weak Catalan TOCs into one chapter", () => {
  for (const id of [
    "un-pis-ensanche-gutenberg-ca",
    "auca-senyor-esteve-gutenberg-ca",
    "estudiant-garrotxa-gutenberg-ca",
    "alegres-comares-windsor-gutenberg-ca",
    "tres-homes-barca-gutenberg-ca",
    "aventures-tom-sawyer-gutenberg-ca",
    "contes-andersen-gutenberg-ca",
    "pinya-rosa-vol1-gutenberg-ca",
    "orfaneta-menargues-gutenberg-ca",
    "reina-del-cor-gutenberg-ca",
    "marxant-venecia-gutenberg-ca",
    "els-idols-gutenberg-ca",
    "tres-anglesos-gutenberg-ca",
    "pinya-rosa-vol2-gutenberg-ca",
  ]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "CAPÍTOL V", text: "cinc" },
        { n: 2, title: "ESCENA XI", text: "escena" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /cinc/);
    assert.match(payload.chapters[0].text, /escena/);
  }
});

test("Gutenberg cleanup merges known weak Latin TOCs into one chapter", () => {
  for (const id of [
    "de-officiis-gutenberg-la",
    "confessiones-gutenberg-la",
    "catulli-carmina-gutenberg-la",
    "de-bello-catilinario-gutenberg-la",
    "plautus-comedies-gutenberg-la",
    "horace-works-gutenberg-la",
    "cato-maior-senectute-gutenberg-la",
    "de-bello-gallico-gutenberg-la",
    "fasti-gutenberg-la",
    "robinson-crusoe-latin-gutenberg-la",
    "cicero-orations-gutenberg-la",
  ]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "VI", text: "sex" },
        { n: 2, title: "Footnotes for Bellum Catilinarium", text: "notae" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /sex/);
    assert.match(payload.chapters[0].text, /notae/);
  }
});

test("Gutenberg cleanup merges known weak Tagalog TOCs into one chapter", () => {
  for (const id of [
    "noli-me-tangere-gutenberg-tl",
    "bagong-robinson-tomo1-gutenberg-tl",
    "doctrina-christiana-gutenberg-tl",
    "ibong-adarna-gutenberg-tl",
    "florante-laura-gutenberg-tl",
    "urbana-feliza-gutenberg-tl",
    "buhay-rizal-gutenberg-tl",
    "dating-pilipinas-gutenberg-tl",
  ]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "VIII.", text: "walong kabanata" },
        { n: 2, title: "The book, printed in Gothic letters", text: "mahabang paliwanag" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /walong kabanata/);
    assert.match(payload.chapters[0].text, /mahabang paliwanag/);
  }
});

test("Gutenberg cleanup merges known weak Russian, Romanian, and Hebrew TOCs into one chapter", () => {
  for (const id of [
    "duhovnye-ody-gutenberg-ru",
    "moskovia-inostrantsev-gutenberg-ru",
    "poezii-eminescu-gutenberg-ro",
    "nuvele-caragiale-gutenberg-ro",
    "hunger-book-one-gutenberg-he",
  ]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "I", text: "prima parte" },
        { n: 2, title: "הערות שוליים:", text: "note finale" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /prima parte/);
    assert.match(payload.chapters[0].text, /note finale/);
  }
});

test("Gutenberg cleanup merges known weak Italian TOCs into one chapter", () => {
  for (const id of ["divina-dottrina-gutenberg-it", "demagoghi-gutenberg-it", "carita-prossimo-gutenberg-it", "favorita-mahdi-gutenberg-it"]) {
    const book = BOOKS.find((row) => row.id === id);
    const payload = cleanGutenbergPayload(book, {
      blurb: "",
      chapters: [
        { n: 1, title: "CAPITOLO VIII", text: "ottavo" },
        { n: 2, title: "CAPITOLO X", text: "decimo" },
      ],
    });
    assert.equal(payload.chapters.length, 1);
    assert.equal(payload.chapters[0].title, book.title);
    assert.match(payload.chapters[0].text, /ottavo/);
    assert.match(payload.chapters[0].text, /decimo/);
  }
});

test("Gutenberg cleanup removes short standalone part marker chapters", () => {
  const payload = cleanGutenbergPayload({ title: "Notre-Dame", skipTitles: [] }, {
    blurb: "",
    chapters: [
      { n: 1, title: "LIVRE PREMIER", text: "I" },
      { n: 2, title: "I LA GRAND’SALLE", text: "long texte" },
      { n: 3, title: "LIVRE SIXIÈME", text: "VI" },
      { n: 4, title: "II LE TROU AUX RATS", text: "suite" },
    ],
  });
  assert.deepEqual(payload.chapters.map((chapter) => chapter.title), ["I LA GRAND’SALLE", "II LE TROU AUX RATS"]);
  assert.deepEqual(payload.chapters.map((chapter) => chapter.n), [1, 2]);
});

test("Gutenberg importer verifies public-domain rights before publishing candidates", async () => {
  const source = await readFile(new URL("../scripts/import-gutenberg-classics.mjs", import.meta.url), "utf8");
  const importOneStart = source.indexOf("async function importOne");
  const importOneEnd = source.indexOf("function summarizeOutput");
  assert.notEqual(importOneStart, -1);
  assert.notEqual(importOneEnd, -1);
  const importOne = source.slice(importOneStart, importOneEnd);

  assert.ok(
    importOne.indexOf("verifyGutenbergPublicDomain(book, metadata)") < importOne.indexOf("downloadEpub(book, filePath)"),
    "RDF rights check should happen before downloading and publishing",
  );
  assert.match(
    importOne,
    /verifyPublishLicense\(info, \{ source: sourceUrl\(book\), license: metadataLicense\.license, evidence: metadata\.rights\.join/,
  );
  assert.match(importOne, /createBookManifest\(filePath, \{ source: sourceUrl\(book\), license: metadataLicense\.license/);
});

test("Gutenberg summary keeps language counts and rejected books visible", () => {
  const summary = summarizeOutput({
    mode: "dry-run",
    apiUrl: "https://example.test",
    results: [
      {
        id: "sample-zh",
        pg: 1,
        title: "Sample",
        lang: "zh",
        category: "中文 · 小说",
        accepted: true,
        license: "public-domain",
        chapters: 2,
      },
      {
        id: "sample-en",
        pg: 2,
        title: "Sample EN",
        lang: "en",
        category: "English · Fiction",
        accepted: false,
        error: "Rejected sample",
      },
    ],
  });

  assert.deepEqual(summary.byLang, { zh: 1, en: 1 });
  assert.equal(summary.accepted, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.results[0].license, "public-domain");
  assert.equal(summary.failures[0].id, "sample-en");
});
