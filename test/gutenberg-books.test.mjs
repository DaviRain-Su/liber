import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BOOKS,
  DEFAULT_IMPORT_LANGS,
  auditBookCatalog,
  assertImportQuality,
  chapterQualityWarnings,
  cleanGutenbergPayload,
  parseArgs,
  parseGutenbergPlainTextChapters,
  selectBooks,
  summarizeCatalogAudit,
  summarizeOutput,
} from "../scripts/import-gutenberg-classics.mjs";
import { LANGUAGE_LABELS } from "../src/lib/languages.js";

test("Gutenberg import candidates are uniquely keyed and classified by language", () => {
  const audit = auditBookCatalog(BOOKS);
  assert.equal(audit.ok, true, audit.errors.join("\n"));
  assert.equal(audit.total >= 600, true, "candidate list should keep broad multilingual coverage");
  assert.equal(
    Object.keys(audit.byLang).length >= 20,
    true,
    "candidate list should remain multilingual",
  );
  for (const lang of ["zh", "en", "ja", "sa", "ar", "fa", "fr", "de", "pt", "la"]) {
    assert.equal(audit.byLang[lang] > 0, true, `expected ${lang} catalog entries`);
  }
  assert.equal(
    audit.byLang.ko || 0,
    0,
    "known Gutenberg Korean entry is copyrighted, so it must stay excluded",
  );
});

test("Gutenberg import catalog audit rejects duplicate sources and bad language categories", () => {
  const fixture = [
    {
      id: "one-gutenberg-en",
      pg: 1,
      lang: "en",
      title: "One",
      category: "English · Fiction",
      expect: "One",
    },
    {
      id: "two-gutenberg-en",
      pg: 1,
      lang: "zh",
      title: "Two",
      category: "English · Fiction",
      expect: "Two",
    },
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
  const zhCount = BOOKS.filter((book) => book.lang === "zh").length;
  assert.equal(selectBooks({ defaultLangs: DEFAULT_IMPORT_LANGS }, BOOKS).length, zhCount);
  assert.equal(
    selectBooks({ defaultLangs: DEFAULT_IMPORT_LANGS, allLangs: true }, BOOKS).length,
    BOOKS.length,
  );

  const zh = selectBooks({ langs: ["zh"] }, BOOKS);
  assert.equal(zh.length, zhCount);
  assert.equal(
    zh.every((book) => book.lang === "zh"),
    true,
  );

  const zhPage = selectBooks({ langs: ["zh"], limit: 5, offset: 10 }, BOOKS);
  assert.equal(zhPage.length, 5);
  assert.deepEqual(zhPage, zh.slice(10, 15));

  const jaSample = selectBooks({ langs: ["ja"], ids: ["rashomon-gutenberg-ja"] }, BOOKS);
  assert.deepEqual(
    jaSample.map((book) => book.id),
    ["rashomon-gutenberg-ja"],
  );

  const sanskrit = selectBooks({ langs: ["梵文"] }, BOOKS);
  assert.deepEqual(
    sanskrit.map((book) => book.id),
    ["sri-vishnu-sahasranaamam-gutenberg-sa"],
  );

  const explicitIdBypassesDefaultZh = selectBooks(
    {
      defaultLangs: DEFAULT_IMPORT_LANGS,
      ids: ["frankenstein-gutenberg-en"],
    },
    BOOKS,
  );
  assert.deepEqual(
    explicitIdBypassesDefaultZh.map((book) => book.id),
    ["frankenstein-gutenberg-en"],
  );

  const summary = summarizeCatalogAudit(auditBookCatalog(zh), zh);
  assert.deepEqual(summary.byLang, { zh: zh.length });
  assert.throws(() => selectBooks({ langs: ["zz"] }, BOOKS), /Unknown language codes: zz/);
  assert.throws(() => selectBooks({ langs: ["ja"], offset: 99 }, BOOKS), /No matching books/);
});

test("Gutenberg importer parses bounded concurrency options", () => {
  const options = parseArgs(["--publish", "--concurrency", "3", "--chapter-concurrency", "4"]);
  assert.equal(options.publish, true);
  assert.equal(options.concurrency, 3);
  assert.equal(options.chapterConcurrency, 4);
  assert.throws(() => parseArgs(["--concurrency", "0"]), /--concurrency must be positive/);
  assert.throws(
    () => parseArgs(["--chapter-concurrency", "0"]),
    /--chapter-concurrency must be positive/,
  );
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

test("Gutenberg plain-text fallback splits Chinese chapter shapes", () => {
  const hui = parseGutenbergPlainTextChapters(
    { title: "恨海", textSource: { kind: "hui" } },
    `*** START OF THE PROJECT GUTENBERG EBOOK 恨海 ***
恨海<br>
第一回&nbsp;&nbsp; 訂婚姻掌判代通詞<br>
正文一
第二回 遇離亂荒村
正文二
*** END OF THE PROJECT GUTENBERG EBOOK 恨海 ***`,
  );
  assert.deepEqual(
    hui.map((chapter) => chapter.title),
    ["第一回 訂婚姻掌判代通詞", "第二回 遇離亂荒村"],
  );

  const pathHui = parseGutenbergPlainTextChapters(
    { title: "老殘遊記續集", textSource: { kind: "hui" } },
    `老殘遊記續集/第01回
正文一
老殘遊記續集/第02回
正文二`,
  );
  assert.deepEqual(
    pathHui.map((chapter) => chapter.title),
    ["第01回", "第02回"],
  );

  const nextLineHui = parseGutenbergPlainTextChapters(
    { title: "常言道", textSource: { kind: "hui-next-title-line" } },
    `第一回
論人我當思人即我我即人
得是失失是得

正文一
第二回
怎肯低頭
正文二`,
  );
  assert.deepEqual(
    nextLineHui.map((chapter) => chapter.title),
    ["第一回 論人我當思人即我我即人 得是失失是得", "第二回 怎肯低頭"],
  );
  assert.equal(nextLineHui[0].text.trim(), "正文一");

  const play = parseGutenbergPlainTextChapters(
    { title: "長生殿", textSource: { kind: "play-act" } },
    `《第一出　傳概》
正文一 接上一段《第二出　定情》
正文二`,
  );
  assert.deepEqual(
    play.map((chapter) => chapter.title),
    ["第一出 傳概", "第二出 定情"],
  );

  const numericPlay = parseGutenbergPlainTextChapters(
    { title: "牡丹亭", textSource: { kind: "play-act" } },
    `第01齣 標目
正文一
第02齣 言懷
正文二`,
  );
  assert.deepEqual(
    numericPlay.map((chapter) => chapter.title),
    ["第一出 標目", "第二出 言懷"],
  );

  const barePlay = parseGutenbergPlainTextChapters(
    { title: "白兔記", textSource: { kind: "play-act" } },
    `第一出開宗
正文一
第二出 訪友
正文二`,
  );
  assert.deepEqual(
    barePlay.map((chapter) => chapter.title),
    ["第一出 開宗", "第二出 訪友"],
  );

  const zaju = parseGutenbergPlainTextChapters(
    { title: "竇娥寃", textSource: { kind: "zaju-fold" } },
    `●楔子
楔子正文
●第一折
第一折正文
●第二折
第二折正文`,
  );
  assert.deepEqual(
    zaju.map((chapter) => chapter.title),
    ["楔子", "第一折", "第二折"],
  );

  const markedChapters = parseGutenbergPlainTextChapters(
    { title: "天妃顯聖錄", textSource: { kind: "zh-chapter" } },
    `●第一章求佳兒大士賜丸
正文一
●第二章聞異香我後降世
正文二`,
  );
  assert.deepEqual(
    markedChapters.map((chapter) => chapter.title),
    ["第一章 求佳兒大士賜丸", "第二章 聞異香我後降世"],
  );

  const classic = parseGutenbergPlainTextChapters(
    {
      title: "春秋繁露",
      textSource: { kind: "classic-ordinal", startPattern: "春秋繁露\\s+卷第一\\s+楚莊王第一" },
    },
    `目錄
楚莊王第一
春秋繁露
卷第一
楚莊王第一
正文一
玉杯第二
正文二
第三[闕]
精華第四
正文四`,
  );
  assert.deepEqual(
    classic.map((chapter) => chapter.title),
    ["楚莊王第一", "玉杯第二", "闕文第三", "精華第四"],
  );
  assert.match(classic[2].text, /原文标为/);

  const shangzi = parseGutenbergPlainTextChapters(
    { title: "商子", textSource: { kind: "classic-ordinal" } },
    `更法第一
正文一
墾令第二
正文二
刑約第十六[缺]
賞刑第十七
正文十七
第二十一[缺]
外內第二十二
正文二十二`,
  );
  assert.deepEqual(
    shangzi.map((chapter) => chapter.title),
    ["更法第一", "墾令第二", "刑約第十六（缺）", "賞刑第十七", "闕文第二十一", "外內第二十二"],
  );
  assert.match(shangzi[2].text, /原文标为/);
  assert.match(shangzi[4].text, /原文标为/);

  const shishuo = parseGutenbergPlainTextChapters(
    { title: "世說新語", textSource: { kind: "classic-ordinal" } },
    `世說新語
德行第一
正文一
言語第二
正文二`,
  );
  assert.deepEqual(
    shishuo.map((chapter) => chapter.title),
    ["德行第一", "言語第二"],
  );

  const wuyue = parseGutenbergPlainTextChapters(
    { title: "吳越春秋", textSource: { kind: "spaced-classic-ordinal" } },
    `吳 越 春 秋 吳 太 伯 傳 第 一
正文一
吳 越 春 秋 吳 王 壽 夢 傳 第 二
正文二`,
  );
  assert.deepEqual(
    wuyue.map((chapter) => chapter.title),
    ["吳越春秋吳太伯傳第一", "吳越春秋吳王壽夢傳第二"],
  );

  const quoted = parseGutenbergPlainTextChapters(
    { title: "隨園詩話", textSource: { kind: "quoted-volume" } },
    `《卷一O》
正文十
《卷一一》
正文十一
《補遺卷一O》
補遺十`,
  );
  assert.deepEqual(
    quoted.map((chapter) => chapter.title),
    ["卷十", "卷十一", "補遺卷十"],
  );

  const shanhaijing = parseGutenbergPlainTextChapters(
    { title: "山海經", textSource: { kind: "known-title-list", titles: ["南山經", "西山經"] } },
    `山海經
南山經
正文一
西山經
正文二`,
  );
  assert.deepEqual(
    shanhaijing.map((chapter) => chapter.title),
    ["南山經", "西山經"],
  );

  const bencao = parseGutenbergPlainTextChapters(
    {
      title: "本草備要",
      textSource: { kind: "known-title-list", titles: ["穀菜部", "金石水土部"] },
    },
    `本草備要
穀菜部
正文一
金石水土部
正文二`,
  );
  assert.deepEqual(
    bencao.map((chapter) => chapter.title),
    ["穀菜部", "金石水土部"],
  );

  const noisyVolume = parseGutenbergPlainTextChapters(
    { title: "清代野记", textSource: { kind: "numbered-volume" } },
    `第一卷????卷上一
正文一
第二卷????卷上二
正文二`,
  );
  assert.deepEqual(
    noisyVolume.map((chapter) => chapter.title),
    ["第一卷 卷上一", "第二卷 卷上二"],
  );

  const mappedTitles = parseGutenbergPlainTextChapters(
    {
      title: "徬徨",
      textSource: {
        kind: "known-title-list",
        titles: ["傷逝【1】 ──涓生的手記", "高老夫子〔１〕"],
        titleMap: { "傷逝【1】 ──涓生的手記": "傷逝", "高老夫子〔１〕": "高老夫子" },
      },
    },
    `傷逝【1】 ──涓生的手記
正文一
高老夫子〔１〕
正文二`,
  );
  assert.deepEqual(
    mappedTitles.map((chapter) => chapter.title),
    ["傷逝", "高老夫子"],
  );

  const xiaoshuo = parseGutenbergPlainTextChapters(
    { title: "中國小說史略", textSource: { kind: "zh-piece" } },
    `題記
題記正文
第一篇　史家對于小說之著錄及論述
正文一
第二篇　神話与傳說
正文二`,
  );
  assert.deepEqual(
    xiaoshuo.map((chapter) => chapter.title),
    ["題記", "第一篇 史家對于小說之著錄及論述", "第二篇 神話与傳說"],
  );
});

test("Gutenberg plain-text fallback splits bracketed Chinese volumes", () => {
  const chapters = parseGutenbergPlainTextChapters(
    { title: "花間集", textSource: { kind: "bracket-volume" } },
    `《花間集》敘
【卷一】 五十首 頁一
正文一
【卷二】 五十首 頁二十
正文二`,
  );
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ["卷一 五十首", "卷二 五十首"],
  );
});

test("Gutenberg plain-text fallback splits Chinese source-specific headings", () => {
  const chajing = parseGutenbergPlainTextChapters(
    { title: "茶經", textSource: { kind: "numbered-zhi" } },
    `茶經
一之源
正文一
二之具
正文二`,
  );
  assert.deepEqual(
    chajing.map((chapter) => chapter.title),
    ["一之源", "二之具"],
  );

  const jinsi = parseGutenbergPlainTextChapters(
    { title: "近思錄", textSource: { kind: "book-prefixed-volume" } },
    `《近思錄》
《近思錄》卷一 道體
正文一
《近思錄》卷二 為學
正文二`,
  );
  assert.deepEqual(
    jinsi.map((chapter) => chapter.title),
    ["卷一 道體", "卷二 為學"],
  );

  const soushen = parseGutenbergPlainTextChapters(
    { title: "搜神記", textSource: { kind: "numbered-volume" } },
    `搜神記
第一卷
正文一
第二卷
正文二`,
  );
  assert.deepEqual(
    soushen.map((chapter) => chapter.title),
    ["第一卷", "第二卷"],
  );

  const places = parseGutenbergPlainTextChapters(
    { title: "瀛涯勝覽", textSource: { kind: "short-place" } },
    `馬敬序
序文
占城國
正文一
爪哇國
正文二
後序
跋文`,
  );
  assert.deepEqual(
    places.map((chapter) => chapter.title),
    ["馬敬序", "占城國", "爪哇國", "後序"],
  );

  const diary = parseGutenbergPlainTextChapters(
    { title: "狂人日記", textSource: { kind: "bare-han-section" } },
    `一
正文一
二
正文二
十三
正文十三`,
  );
  assert.deepEqual(
    diary.map((chapter) => chapter.title),
    ["一", "二", "十三"],
  );

  const chenlun = parseGutenbergPlainTextChapters(
    {
      title: "沉沦",
      textSource: { kind: "bare-han-section", startPattern: "正文一", initialTitle: "一" },
    },
    `书名: 沉沦
正文一
二
正文二
三
正文三`,
  );
  assert.deepEqual(
    chenlun.map((chapter) => chapter.title),
    ["一", "二", "三"],
  );
  assert.match(chenlun[0].text, /正文一/);
  assert.doesNotMatch(chenlun[0].text, /书名/);

  const taiwan = parseGutenbergPlainTextChapters(
    { title: "臺灣通史：唐山過海的故事", textSource: { kind: "taiwan-history" } },
    `序
序文

捲一

開闢紀
正文一`,
  );
  assert.deepEqual(
    taiwan.map((chapter) => chapter.title),
    ["序", "捲一 開闢紀"],
  );
  assert.match(taiwan[1].text, /開闢紀/);

  const single = parseGutenbergPlainTextChapters(
    {
      title: "大英國人事略說",
      textSource: {
        kind: "single-heading",
        startPattern: "英吉利國人品國事略說",
        endPattern: "大英國人事略說終",
        title: "英吉利國人品國事略說",
      },
    },
    `英文導言
英吉利國人品國事略說
英國人原活之地，距中華有七萬里之遠。
大英國人事略說終
page image caption`,
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].title, "英吉利國人品國事略說");
  assert.match(single[0].text, /大英國人事略說終/);
  assert.doesNotMatch(single[0].text, /page image caption/);

  const zhChapter = parseGutenbergPlainTextChapters(
    { title: "阿Ｑ正傳", textSource: { kind: "zh-chapter" } },
    `阿Ｑ正傳
第一章　序
正文一
第二章　優　勝　記　略
正文二`,
  );
  assert.deepEqual(
    zhChapter.map((chapter) => chapter.title),
    ["第一章 序", "第二章 優勝記略"],
  );

  const cleanHui = parseGutenbergPlainTextChapters(
    { title: "紅樓夢", textSource: { kind: "hui-clean" } },
    `第一回 甄士隱夢幻識通靈　賈雨村風塵怀閨秀
正文一
第四回 中既將薛家母子在榮府內寄居等事略已表明，此回則暫不能寫矣．如
正文續
第二回 賈夫人仙逝揚州城　冷子興演說榮國府　話 說賈夫人
正文二`,
  );
  assert.deepEqual(
    cleanHui.map((chapter) => chapter.title),
    ["第一回 甄士隱夢幻識通靈 賈雨村風塵怀閨秀", "第二回 賈夫人仙逝揚州城 冷子興演說榮國府"],
  );
  assert.match(cleanHui[0].text, /正文續/);

  const huyu = parseGutenbergPlainTextChapters(
    { title: "滬語開路", textSource: { kind: "huyu-exercise" } },
    `Exercise 1.
Introductory dialogue.
請先生敎我中國話。
TRANSLATION OF EXERCISE 1.
Please sir teach me Chinese.
Exercise 2.
Based on Lesson 5.
我要儂去呌一个木匠。
Exercise 2.
Based on Lesson 5.
續文。`,
  );
  assert.deepEqual(
    huyu.map((chapter) => chapter.title),
    ["练习一", "练习二"],
  );
  assert.match(huyu[1].text, /續文/);

  const knownTitles = parseGutenbergPlainTextChapters(
    {
      title: "吶喊",
      textSource: {
        kind: "known-title-list",
        titles: ["《吶喊》自序", "狂人日記", "藥", "阿Q正傳"],
        titleMap: { 阿Q正傳: "阿Ｑ正傳" },
      },
    },
    `《吶喊》自序
《吶喊》自序
序文
狂人日記
一
正文一
二
正文二
藥
一
正文三
阿Q正傳
第一章序
正文四`,
  );
  assert.deepEqual(
    knownTitles.map((chapter) => chapter.title),
    ["《吶喊》自序", "狂人日記", "藥", "阿Ｑ正傳"],
  );
  assert.match(knownTitles[1].text, /^一\n正文一/u);
  assert.match(knownTitles[3].text, /第一章序/);

  const duplicateBookTitle = parseGutenbergPlainTextChapters(
    {
      title: "公墓",
      textSource: { kind: "known-title-list", titles: ["公墓", "自序", "被當作消遣品的男子"] },
    },
    `公墓
自序
序文
被當作消遣品的男子
正文`,
  );
  assert.deepEqual(
    duplicateBookTitle.map((chapter) => chapter.title),
    ["自序", "被當作消遣品的男子"],
  );

  const nanqiang = parseGutenbergPlainTextChapters(
    {
      title: "南腔北調集",
      textSource: {
        kind: "known-title-list",
        titles: ["“非所計也”", "題記", "作文秘訣"],
        ignoreRepeatedTitle: true,
        skipLinePattern: "^BB$",
        trimLineSuffixPattern: "\\s*BB$",
      },
    },
    `“非所計也”
正文一。BB
BB
〔１〕注释。
題記
雜文五十一篇。
題記
正文二。
作文秘訣
正文三。`,
  );
  assert.deepEqual(
    nanqiang.map((chapter) => chapter.title),
    ["“非所計也”", "題記", "作文秘訣"],
  );
  assert.doesNotMatch(nanqiang[0].text, /BB/);
  assert.match(nanqiang[1].text, /雜文五十一篇。/);
  assert.match(nanqiang[1].text, /正文二。/);

  const sanzang = parseGutenbergPlainTextChapters(
    {
      title: "大唐三藏取經詩話",
      textSource: { kind: "sanzang-shihua", startPattern: "\\n口口口口口口第一\\n" },
    },
    `目錄
1 口口口口口口第一
口口口口口口第一
（文原缺）
行程遇猴行者處第二
正文二
（題原缺）第八
正文八`,
  );
  assert.deepEqual(
    sanzang.map((chapter) => chapter.title),
    ["闕文第一（缺）", "行程遇猴行者處第二", "題原缺第八"],
  );
  assert.match(sanzang[0].text, /文原缺/);

  const lingli = parseGutenbergPlainTextChapters(
    { title: "灵历集光", textSource: { kind: "lingli-jiguang", startPattern: "滕\\s*序" } },
    `Ling Li Ji Guang
滕    序
序文
前    言
前言正文
致    谢
致谢正文
第一章 从出生到赴美留学之前(1901-1920)
正文一
第一章 从出生到赴美留学之前(1901-1920)
续正文
第五 章神独自引领(1934-1940)
正文五`,
  );
  assert.deepEqual(
    lingli.map((chapter) => chapter.title),
    [
      "滕序",
      "前言",
      "致谢",
      "第一章 从出生到赴美留学之前(1901-1920)",
      "第五章 神独自引领(1934-1940)",
    ],
  );
  assert.match(lingli[3].text, /续正文/);

  const xianqing = parseGutenbergPlainTextChapters(
    { title: "閒情偶寄", textSource: { kind: "xianqing-ouji" } },
    `词曲部
总论
结构第一
正文一
词采第二
正文二
◎格局第六
正文三
演习部
选剧第一
正文四
调饮啜第三
重复片段
调饮啜第三
正文五`,
  );
  assert.deepEqual(
    xianqing.map((chapter) => chapter.title),
    ["词曲部", "结构第一", "词采第二", "格局第六", "演习部", "选剧第一", "调饮啜第三"],
  );
  assert.match(xianqing[4].text, /分部标题/);
  assert.doesNotMatch(xianqing[6].text, /重复片段/);

  const shortHanTitles = parseGutenbergPlainTextChapters(
    { title: "魏鄭公諫錄", textSource: { kind: "short-han-title", maxChars: 18 } },
    `魏鄭公諫錄
○諫聽諫與貞觀初不同
正文一。
太宗臨朝詔群臣
正文二。
十三日
正文續。`,
  );
  assert.deepEqual(
    shortHanTitles.map((chapter) => chapter.title),
    ["諫聽諫與貞觀初不同", "太宗臨朝詔群臣"],
  );
  assert.match(shortHanTitles[1].text, /十三日/);

  const spacedShortHanTitles = parseGutenbergPlainTextChapters(
    { title: "列女傳", textSource: { kind: "short-han-title", startPattern: "卷\\s*之\\s*一" } },
    `列女傳
劉向
卷 之 一
有虞二妃
正文一。
棄 母 姜 嫄
正文二。`,
  );
  assert.deepEqual(
    spacedShortHanTitles.map((chapter) => chapter.title),
    ["有虞二妃", "棄母姜嫄"],
  );

  const leadingTitleChapter = cleanGutenbergPayload(
    {
      id: "gushi-shijiushou-gutenberg-zh",
      lang: "zh",
      title: "古詩十九首",
      keepLeadingTitleChapter: true,
      textSource: { kind: "short-han-title", maxChars: 22 },
    },
    {
      chapters: parseGutenbergPlainTextChapters(
        { title: "古詩十九首", textSource: { kind: "short-han-title", maxChars: 22 } },
        `古詩十九首之一《行行重行行》
正文一。
古詩十九首之二《青青河畔草》
正文二。`,
      ),
    },
  );
  assert.deepEqual(
    leadingTitleChapter.chapters.map((chapter) => chapter.title),
    ["古詩十九首之一《行行重行行》", "古詩十九首之二《青青河畔草》"],
  );

  const wrappedShortTitles = cleanGutenbergPayload(
    { id: "gongsunlongzi-gutenberg-zh", lang: "zh", title: "公孫龍子" },
    {
      chapters: [
        { n: 1, title: "〔白馬論〕", text: "正文" },
        { n: 2, title: "《廣詁》", text: "正文" },
      ],
    },
  );
  assert.deepEqual(
    wrappedShortTitles.chapters.map((chapter) => chapter.title),
    ["白馬論", "廣詁"],
  );

  const yescao = parseGutenbergPlainTextChapters(
    { title: "野草", textSource: { kind: "known-title-list", titles: ["希望", "雪", "風箏"] } },
    `希望
正文一
待你犧牲了極多的寶貝——
正文續
雪
正文二
風箏
正文三`,
  );
  assert.deepEqual(
    yescao.map((chapter) => chapter.title),
    ["希望", "雪", "風箏"],
  );
  assert.match(yescao[0].text, /犧牲了極多/);

  const shenyin = parseGutenbergPlainTextChapters(
    { title: "呻吟語", textSource: { kind: "known-title-list", titles: ["問學", "應務", "養生"] } },
    `問學
正文一
若乎日不
正文續
應務
正文二
養生
正文三`,
  );
  assert.deepEqual(
    shenyin.map((chapter) => chapter.title),
    ["問學", "應務", "養生"],
  );
  assert.match(shenyin[0].text, /若乎日不/);

  const startedShortHanTitles = parseGutenbergPlainTextChapters(
    {
      title: "明夷待訪錄",
      textSource: { kind: "short-han-title", startPattern: "題辭", maxChars: 12 },
    },
    `置相
目錄碎片
題辭
正文一，足以形成正文。
原君
正文二，足以形成正文。
原臣
正文三，足以形成正文。`,
  );
  assert.deepEqual(
    startedShortHanTitles.map((chapter) => chapter.title),
    ["題辭", "原君", "原臣"],
  );
  assert.doesNotMatch(startedShortHanTitles[0].text, /目錄碎片/);

  const bareHanSections = parseGutenbergPlainTextChapters(
    { title: "人間詞話", textSource: { kind: "bare-han-section", startPattern: "\\n一\\n" } },
    `人間詞話
十
目錄碎片
一
正文一
二
正文二
三
正文三`,
  );
  assert.deepEqual(
    bareHanSections.map((chapter) => chapter.title),
    ["一", "二", "三"],
  );
  assert.doesNotMatch(bareHanSections[0].text, /目錄碎片/);

  const heavenlyStemSections = parseGutenbergPlainTextChapters(
    {
      title: "南部新書",
      textSource: {
        kind: "known-title-list",
        startPattern: "\\n甲\\n",
        titles: ["甲", "乙", "丙"],
      },
    },
    `南部新書
序文碎片
甲
正文甲
乙
正文乙
丙
正文丙`,
  );
  assert.deepEqual(
    heavenlyStemSections.map((chapter) => chapter.title),
    ["甲", "乙", "丙"],
  );
  assert.doesNotMatch(heavenlyStemSections[0].text, /序文碎片/);

  const repeatedKnownVolumes = parseGutenbergPlainTextChapters(
    {
      title: "安樂集",
      textSource: {
        kind: "known-title-list",
        titles: ["安樂集卷上", "安樂集卷下"],
        ignoreRepeatedTitle: true,
      },
    },
    `安樂集卷上
正文上
安樂集卷上
重複卷名不另起章
安樂集卷下
正文下`,
  );
  assert.deepEqual(
    repeatedKnownVolumes.map((chapter) => chapter.title),
    ["安樂集卷上", "安樂集卷下"],
  );
  assert.match(repeatedKnownVolumes[0].text, /重複卷名不另起章/);

  const bracketVolumes = parseGutenbergPlainTextChapters(
    { title: "李賀詩選", textSource: { kind: "bracket-volume", startPattern: "【\\s*卷一\\s*】" } },
    `目錄碎片
【卷一】
正文一
【卷二】
正文二`,
  );
  assert.deepEqual(
    bracketVolumes.map((chapter) => chapter.title),
    ["卷一", "卷二"],
  );
  assert.doesNotMatch(bracketVolumes[0].text, /目錄碎片/);

  const travelDiary = parseGutenbergPlainTextChapters(
    { title: "徐霞客遊記", textSource: { kind: "travel-diary", startPattern: "游天台山日記" } },
    `徐霞客遊記
徐霞客著
游天台山日記
正文一
後游黃山日記
正文二
余追憶日記於東樓
正文續
滇游日記十二
正文三
近騰諸彝說略
正文四`,
  );
  assert.deepEqual(
    travelDiary.map((chapter) => chapter.title),
    ["游天台山日記", "後游黃山日記", "滇游日記十二", "近騰諸彝說略"],
  );
  assert.match(travelDiary[1].text, /余追憶日記/);

  const sishierTeachings = Array.from({ length: 42 }, (_, index) => `佛言：第${index + 1}段正文。`);
  const sishier = parseGutenbergPlainTextChapters(
    { title: "佛說四十二章經", textSource: { kind: "sishier-zhangjing" } },
    `Produced by Mao Ching-Chen

佛說四十二章經

後漢摩騰、竺法蘭共譯

世尊成道已，作是思惟。

${sishierTeachings.join("\n\n")}

${sishierTeachings.slice(20).join("\n\n")}`,
  );
  assert.equal(sishier.length, 43);
  assert.deepEqual(
    sishier.slice(0, 4).map((chapter) => chapter.title),
    ["緣起", "第一章", "第二章", "第三章"],
  );
  assert.equal(sishier[42].title, "第四十二章");
  assert.equal(sishier.filter((chapter) => chapter.title === "第二十一章").length, 1);

  const paragraphs = parseGutenbergPlainTextChapters(
    {
      title: "菜根譚",
      textSource: { kind: "paragraph-sections", startPattern: "第一則正文", titleSuffix: "則" },
    },
    `菜根譚

明 洪自誠 著

第一則正文。

第二則正文。`,
  );
  assert.deepEqual(
    paragraphs.map((chapter) => chapter.title),
    ["第1則", "第2則"],
  );
  assert.match(paragraphs[0].text, /第一則正文/);

  const lineSections = parseGutenbergPlainTextChapters(
    {
      title: "幽夢影",
      textSource: { kind: "line-sections", startPattern: "讀經宜冬", titleSuffix: "則" },
    },
    `幽夢影

讀經宜冬，其神專也。
經傳宜獨坐讀；史鑑宜與友共讀。`,
  );
  assert.deepEqual(
    lineSections.map((chapter) => chapter.title),
    ["第1則", "第2則"],
  );
  assert.match(lineSections[1].text, /史鑑宜/);

  const titledLineSections = parseGutenbergPlainTextChapters(
    {
      title: "千字文",
      textSource: { kind: "line-sections", startPattern: "天地玄黃", titleFromLineChars: 8 },
    },
    `千字文

天地玄黃 宇宙洪荒
日月盈昃 辰宿列張`,
  );
  assert.deepEqual(
    titledLineSections.map((chapter) => chapter.title),
    ["天地玄黃宇宙洪荒", "日月盈昃辰宿列張"],
  );

  const markedLineSections = parseGutenbergPlainTextChapters(
    {
      title: "李太白集",
      textSource: {
        kind: "marked-line-sections",
        startPattern: "▲李白十五歲",
        headingPattern: "^▲\\s*李白",
        titlePattern: "^▲\\s*(李白[一二三四五六七八九十百]+歲)",
      },
    },
    `李太白集

▲李白十五歲。好神仙。
明堂賦正文。
▲李白十八歲。在大匡山。
訪戴天山道士不遇正文。`,
  );
  assert.deepEqual(
    markedLineSections.map((chapter) => chapter.title),
    ["李白十五歲", "李白十八歲"],
  );
  assert.match(markedLineSections[0].text, /明堂賦正文/);

  const repeatedMarkedLineSections = parseGutenbergPlainTextChapters(
    {
      title: "水調歌頭",
      textSource: {
        kind: "marked-line-sections",
        startPattern: "水調歌頭",
        headingPattern: "^水[调調]歌[头頭]$",
        skipBodyLinePattern: "^(?:水[调調]歌[头頭]|苏轼蘇軾)$",
        titleFromBodyChars: 8,
      },
    },
    `水調歌頭
苏轼蘇軾
明月幾時有，把酒問青天。
水调歌头
苏轼蘇軾
昵昵兒女語，燈火夜微明。`,
  );
  assert.deepEqual(
    repeatedMarkedLineSections.map((chapter) => chapter.title),
    ["明月幾時有，把酒", "昵昵兒女語，燈火"],
  );
  assert.doesNotMatch(repeatedMarkedLineSections[0].text, /水調歌頭|苏轼/);

  const biographies = parseGutenbergPlainTextChapters(
    { title: "高士傳", textSource: { kind: "biography-paragraphs", startPattern: "被衣" } },
    `高士傳

被衣　　被衣者，堯時高士也。

王倪　　王倪者，齧缺之師也。`,
  );
  assert.deepEqual(
    biographies.map((chapter) => chapter.title),
    ["被衣", "王倪"],
  );
  assert.match(biographies[1].text, /齧缺之師/);

  const pairedParagraphs = parseGutenbergPlainTextChapters(
    {
      title: "周髀算經",
      textSource: {
        kind: "paired-paragraphs",
        startPattern: "周髀算經卷上之一",
        headingPattern: "^周髀算經卷[上下]之[一二三]$",
      },
    },
    `周髀算經

周髀算經卷上之一

昔者周公問於商高曰。

周髀算經卷上之二

凡日月運行。`,
  );
  assert.deepEqual(
    pairedParagraphs.map((chapter) => chapter.title),
    ["周髀算經卷上之一", "周髀算經卷上之二"],
  );
  assert.match(pairedParagraphs[0].text, /周公問/);

  const inlineActs = cleanGutenbergPayload(
    { id: "幽閨記", lang: "zh", title: "幽閨記", repairDuplicateActNumbers: true },
    {
      chapters: parseGutenbergPlainTextChapters(
        { title: "幽閨記", textSource: { kind: "inline-play-act" } },
        `幽閨記

第一出開場始末
正文一

第二出書幃自歎
正文二

第二出書幃自歎
正文三

第四出罔害皤良
正文四`,
      ),
    },
  );
  assert.deepEqual(
    inlineActs.chapters.map((chapter) => chapter.title),
    ["第一出 開場始末", "第二出 書幃自歎", "第三出 書幃自歎", "第四出 罔害皤良"],
  );

  const emptyInlineAct = parseGutenbergPlainTextChapters(
    { title: "幽閨記", textSource: { kind: "inline-play-act", includeEmptyActs: true } },
    `幽閨記

第三十三出(照例開科)

第三十四出姊妹論思
正文`,
  );
  assert.equal(emptyInlineAct.length, 2);
  assert.match(emptyInlineAct[0].text, /只列标题/);

  const questionAnswer = parseGutenbergPlainTextChapters(
    {
      title: "傳法心要",
      textSource: {
        kind: "question-answer",
        initialTitle: "傳法心要",
        questionTitleChars: 8,
      },
    },
    `師謂休曰：諸佛與一切眾生，唯是一心。

問：如何是道，如何修行？師云：道即心也。

問：見法頓了者，見祖師意否？師云：祖師出虛空外。`,
  );
  assert.deepEqual(
    questionAnswer.map((chapter) => chapter.title),
    ["傳法心要", "問：如何是道，如何修...", "問：見法頓了者，見祖..."],
  );
  assert.match(questionAnswer[1].text, /道即心/);

  const rightMarked = parseGutenbergPlainTextChapters(
    {
      title: "中庸章句",
      textSource: {
        kind: "right-marker",
        introTitle: "中庸章句序",
        mainPattern: "中庸章句中者",
        markerPattern: "右第\\s*[一二三四五六七八九十百]+\\s*章",
      },
    },
    `中庸章句序
序文。
中庸章句中者，不偏不倚。
第一章正文。
右第一章。
第二章正文。
右第二章。`,
  );
  assert.deepEqual(
    rightMarked.map((chapter) => chapter.title),
    ["中庸章句序", "第一章", "第二章"],
  );
  assert.match(rightMarked[1].text, /第一章正文/);

  const numberedPoems = parseGutenbergPlainTextChapters(
    {
      title: "李義山詩集",
      textSource: { kind: "numbered-quoted-poems", startPattern: "1「錦瑟」" },
    },
    `李義山詩集

序文不入章。

1「錦瑟」

錦瑟無端五十弦。

2「重過聖女祠」

白石岩扉碧蘚滋。`,
  );
  assert.deepEqual(
    numberedPoems.map((chapter) => chapter.title),
    ["錦瑟", "重過聖女祠"],
  );
  assert.match(numberedPoems[0].text, /五十弦/);

  const lunheng = parseGutenbergPlainTextChapters(
    { title: "論衡", textSource: { kind: "pian-ordinal", startPattern: "王充 - 論衡" } },
    `王充 - 論衡
逢遇篇第一
賢不賢，才也。
累害篇第二
凡人操行。`,
  );
  assert.deepEqual(
    lunheng.map((chapter) => chapter.title),
    ["逢遇篇第一", "累害篇第二"],
  );

  const sanguozhi = parseGutenbergPlainTextChapters(
    { title: "三國志", textSource: { kind: "three-kingdoms-history" } },
    `魏書一　　武帝紀第一
太祖武皇帝。
魏書二　　文帝紀第二
文皇帝諱丕。`,
  );
  assert.deepEqual(
    sanguozhi.map((chapter) => chapter.title),
    ["魏書一 武帝紀第一", "魏書二 文帝紀第二"],
  );

  const dynastyChronicle = parseGutenbergPlainTextChapters(
    { title: "竹書紀年", textSource: { kind: "dynasty-chronicle" } },
    `夏　　　紀
禹都陽城。
殷　　　紀
湯滅夏。`,
  );
  assert.deepEqual(
    dynastyChronicle.map((chapter) => chapter.title),
    ["夏紀", "殷紀"],
  );

  const zhangzai = parseGutenbergPlainTextChapters(
    { title: "張載集", textSource: { kind: "zhangzai-headings", startPattern: "正蒙蘇昺序" } },
    `張載集目錄

正蒙

正蒙蘇昺序
先生著正蒙書。
太和篇第一
太和所謂道。
系辭上
大易不言有無。`,
  );
  assert.deepEqual(
    zhangzai.map((chapter) => chapter.title),
    ["正蒙蘇昺序", "太和篇第一", "系辭上"],
  );

  const stageScenes = parseGutenbergPlainTextChapters(
    { title: "西廂記", textSource: { kind: "inline-stage-scene" } },
    `[外扮老夫人上開]老身姓鄭。
曲文一。

[正末扮張生騎馬引仆上開]小生姓張。
曲文二。

[杜將軍引卒子上開]林下曬衣。
曲文三。`,
  );
  assert.deepEqual(
    stageScenes.map((chapter) => chapter.title),
    ["第1段 老夫人", "第2段 張生", "第3段 杜將軍"],
  );
  assert.match(stageScenes[0].text, /老身姓鄭/);
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
  const titles = [
    "第一回",
    "第二回",
    "第三回",
    "第四回",
    "第五回",
    "第六回",
    "第七回",
    "第八回",
    "第九回",
    "第一○回",
    "第一一回",
  ];
  const warnings = chapterQualityWarnings(titles.map((title) => ({ title, text: "正文" })));
  assert.doesNotMatch(warnings.join("\n"), /numbering gaps/);
});

test("Gutenberg quality checks parse Chinese shorthand and full-width numerals", () => {
  const titles = [
    "第十九回",
    "第廿回",
    "第二十一回",
    "第２２回",
    "第廿三回",
    "第二十四回",
    "第廿五回",
    "第２６回",
    "第廿七回",
    "第二十八回",
    "第廿九回",
    "第卅回",
    "第卅一回",
  ];
  const warnings = chapterQualityWarnings(titles.map((title) => ({ title, text: "正文" })));
  assert.doesNotMatch(warnings.join("\n"), /numbering gaps/);
});

test("Gutenberg quality checks catch gaps in 卷之 volume runs", () => {
  const warnings = chapterQualityWarnings(
    [
      "卷之一",
      "卷之二",
      "卷之三",
      "卷之七",
      "卷之八",
      "卷之九",
      "卷之十",
      "卷之十一",
      "卷之十二",
    ].map((title) => ({ title, text: "正文" })),
  );
  assert.match(warnings.join("\n"), /Chinese 卷 headings have numbering gaps/);
});

test("Gutenberg quality checks catch single gaps in long Chinese volume runs", () => {
  const titles = Array.from({ length: 40 }, (_, index) => {
    const n = index + 1;
    if (n === 26) return null;
    const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const han =
      n <= 10
        ? digits[n]
        : n < 20
          ? `十${digits[n - 10]}`
          : n === 20
            ? "二十"
            : n < 30
              ? `二十${digits[n - 20]}`
              : n === 30
                ? "三十"
                : n < 40
                  ? `三十${digits[n - 30]}`
                  : "四十";
    return `第${han}卷`;
  }).filter(Boolean);
  const warnings = chapterQualityWarnings(titles.map((title) => ({ title, text: "正文" })));
  assert.match(warnings.join("\n"), /Chinese 卷 headings have numbering gaps: missing 26/);
});

test("Gutenberg quality override allows known source volume gaps", () => {
  const book = BOOKS.find((row) => row.id === "yanyi-bian-gutenberg-zh");
  const han = (n) => {
    const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if (n <= 10) return digits[n];
    if (n < 20) return `十${digits[n - 10]}`;
    if (n === 20) return "二十";
    if (n < 30) return `二十${digits[n - 20]}`;
    if (n === 30) return "三十";
    if (n < 40) return `三十${digits[n - 30]}`;
    return "四十";
  };
  const chapters = [
    ...Array.from({ length: 25 }, (_, index) => ({ title: `第${han(index + 1)}卷`, text: "正文" })),
    ...Array.from({ length: 14 }, (_, index) => ({
      title: `第${han(index + 27)}卷`,
      text: "正文",
    })),
  ];
  const warnings = chapterQualityWarnings(chapters, { lang: "zh" });
  assert.match(warnings.join("\n"), /Chinese 卷 headings have numbering gaps/);
  assert.deepEqual(assertImportQuality(book, chapters), []);
});

test("Gutenberg quality checks reject Chinese recitation text inside headings", () => {
  const warnings = chapterQualityWarnings(
    [
      { title: "第四回 活佛慈悲在於擊棒 神仙手段那用栽贓 詩曰： 前頭走的小娃娃", text: "正文" },
      { title: "第五回 正常章名", text: "正文" },
    ],
    { lang: "zh" },
  );
  assert.match(warnings.join("\n"), /recitation-marker headings/);
});

test("Gutenberg quality checks reject Chinese placeholder headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "口口口口口口第一", text: "殘缺" },
    { title: "口口口口第二", text: "殘缺" },
  ]);
  assert.match(warnings.join("\n"), /Chinese placeholder headings/);
});

test("Gutenberg quality checks catch trailing Chinese ordinal gaps", () => {
  const warnings = chapterQualityWarnings(
    [
      "學而第一",
      "為政第二",
      "八佾第三",
      "公冶長第五",
      "雍也第六",
      "述而第七",
      "泰伯第八",
      "子罕第九",
      "鄉黨第十",
      "先進第十一",
    ].map((title) => ({ title, text: "正文" })),
  );
  assert.match(warnings.join("\n"), /Chinese 篇尾第 headings have numbering gaps/);
  assert.match(warnings.join("\n"), /missing 4/);
});

test("Gutenberg quality checks catch short Chinese chapter gaps and missing first chapter", () => {
  const shortGap = chapterQualityWarnings(
    ["第一章", "第二章", "第三章", "第四章", "第六章"].map((title) => ({ title, text: "正文" })),
  );
  assert.match(shortGap.join("\n"), /Chinese 章 headings have numbering gaps/);
  assert.match(shortGap.join("\n"), /missing 5/);

  const missingFirst = chapterQualityWarnings(
    ["第二回", "第三回", "第四回", "第五回", "第六回"].map((title) => ({ title, text: "正文" })),
  );
  assert.match(missingFirst.join("\n"), /missing 1/);
});

test("Gutenberg quality checks segment reset Chinese trailing ordinal runs", () => {
  const warnings = chapterQualityWarnings(
    [
      "捭闔第一",
      "反應第二",
      "內揵第三",
      "抵巇第四",
      "忤合第六",
      "揣篇第七",
      "摩篇第八",
      "權篇第九",
      "謀篇第十",
      "決篇第十一",
      "符言第十二",
      "天官第一",
      "兵談第二",
      "制談第三",
      "戰威第四",
      "攻權第五",
      "守權第六",
      "十二陵第七",
      "武議第八",
    ].map((title) => ({ title, text: "正文" })),
  );
  assert.match(warnings.join("\n"), /Chinese 篇尾第 headings have numbering gaps/);
  assert.match(warnings.join("\n"), /missing 5/);
});

test("Gutenberg quality checks parse Chinese 篇五 style trailing ordinals", () => {
  const warnings = chapterQualityWarnings(
    [
      "捭闔第一",
      "反應第二",
      "內揵第三",
      "抵巇第四",
      "飛箝篇五",
      "忤合第六",
      "揣篇第七",
      "摩篇第八",
      "權篇第九",
    ].map((title) => ({ title, text: "正文" })),
  );
  assert.doesNotMatch(warnings.join("\n"), /numbering gaps/);
});

test("Gutenberg quality checks reject missing Chinese volume numbers", () => {
  const warnings = chapterQualityWarnings(
    ["第一卷", "第二卷", "第三卷", "第四卷", "第六卷", "第七卷", "第八卷", "第九卷", "第十卷"].map(
      (title) => ({ title, text: "正文" }),
    ),
    { lang: "zh" },
  );
  assert.match(warnings.join("\n"), /Chinese 卷 headings have numbering gaps/);
  assert.match(warnings.join("\n"), /missing 5/);
});

test("Gutenberg quality checks reject non-ordinal interruptions in Chinese chapter runs", () => {
  const warnings = chapterQualityWarnings(
    [
      "第一回 開宗明義",
      "第二回 初入城中",
      "第三回 風波又起",
      "第四回 親友相逢",
      "第五回 債務未清",
      "對門王詮進了第二",
      "第六回 真相大白",
    ].map((title) => ({ title, text: "正文" })),
    { lang: "zh" },
  );
  assert.match(warnings.join("\n"), /non-ordinal interruption headings/);
});

test("Gutenberg quality override allows selected sparse trailing Chinese ordinal books", () => {
  const book = BOOKS.find((row) => row.id === "zhuangzi-de-gushi-gutenberg-zh");
  const chapters = [
    "逍遙遊第一",
    "德充符第五",
    "大宗師第六",
    "應帝王第七",
    "駢拇第八",
    "馬蹄第九",
    "胠篋第十",
    "在宥第十一",
  ].map((title) => ({ title, text: "正文" }));
  const warnings = chapterQualityWarnings(chapters, { lang: "zh" });
  assert.match(warnings.join("\n"), /Chinese 篇尾第 headings have numbering gaps/);
  assert.deepEqual(assertImportQuality(book, chapters), []);
});

test("Gutenberg quality checks reject Latin noise headings in Chinese books", () => {
  const warnings = chapterQualityWarnings(
    [
      { title: "南腔北調集", text: "正文" },
      { title: "BB", text: "正文續頁" },
    ],
    { lang: "zh" },
  );
  assert.match(warnings.join("\n"), /Latin-noise headings/);
});

test("Gutenberg quality checks reject embedded Latin noise in Chinese headings", () => {
  const warnings = chapterQualityWarnings(
    [{ title: "第五回 甘心受百忙堬r棄生死 捨不得一家人哭斷肝腸", text: "正文" }],
    { lang: "zh" },
  );
  assert.match(warnings.join("\n"), /Latin-noise headings/);
});

test("Gutenberg quality checks reject garbled symbols in Chinese headings", () => {
  const warnings = chapterQualityWarnings(
    [
      { title: "第七十二回 破長安媕野~合 入皇宮訴屈伸冤", text: "正文" },
      { title: "第一回???? 靈隱寺禪僧貽寶倡", text: "正文二" },
      { title: "第一零二回 宁國府骨肉病災襟腹@大觀園符水驅妖孽", text: "正文三" },
    ],
    { lang: "zh" },
  );
  assert.match(warnings.join("\n"), /garbled-symbol headings/);
});

test("Gutenberg quality checks reject Chinese TOC fragments as headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "第1 回 海瑞初生 第2 回 張居正入朝 第3 回 太后垂簾", text: "目录" },
    { title: "第一回 正文", text: "正文" },
  ]);
  assert.match(warnings.join("\n"), /Chinese TOC-fragment headings/);
});

test("Gutenberg quality checks reject short Chinese prose sentence headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "封禪書", text: "正文" },
    { title: "可。", text: "正文續頁" },
    { title: "仲尼弟子列傳", text: "正文" },
    { title: "過猶不及。", text: "正文續頁" },
    {
      title: "故曰非長生難也，聞道難也；非聞道難也，行之難也；非行之難也，終之難也。",
      text: "正文續頁",
    },
  ]);
  assert.match(warnings.join("\n"), /prose-fragment-looking headings/);
});

test("Gutenberg quality checks reject Chinese full-width prose fragments", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一章", text: "正文" },
    { title: "得得﹐……", text: "正文續頁" },
    { title: "你不知道﹐他們已經來革過了﹗", text: "正文續頁" },
  ]);
  assert.match(warnings.join("\n"), /prose-fragment-looking headings/);
});

test("Gutenberg quality checks reject long ordinal Chinese body fragments", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一回是民國元年我初到北京的時候，當時一個朋友對我說，北京戲最好，你", text: "正文" },
    { title: "第二回 正常章名", text: "正文" },
  ]);
  assert.match(warnings.join("\n"), /prose-fragment-looking headings/);
});

test("Gutenberg quality checks reject out-of-order Chinese volume headings", () => {
  const warnings = chapterQualityWarnings([
    { title: "第一卷 譚楚玉戲裡傳情", text: "正文" },
    { title: "第十二卷 貞女守貞來異謗", text: "正文" },
    { title: "第二卷 老星家戲改八字", text: "正文" },
    { title: "第三卷 乞兒行好事", text: "正文" },
    { title: "第四卷 清官不受扒灰", text: "正文" },
    { title: "第五卷 美女同遭花燭冤", text: "正文" },
    { title: "第六卷 遭風遇盜致奇贏", text: "正文" },
    { title: "第七卷 妒妻守有夫之寡", text: "正文" },
    { title: "第八卷 妻妾敗綱常", text: "正文" },
  ]);
  assert.match(warnings.join("\n"), /Chinese 卷 headings are out of order/);
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
    { title: 'III " Suomessa.', text: "Text" },
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

test("Gutenberg cleanup trims trailing Chinese verse from chapter titles", () => {
  const book = BOOKS.find((row) => row.id === "xingmeng-pianyan-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第九回 倩明媒但求一美 央冥判竟得雙姝", text: "第九回正文" },
      {
        n: 2,
        title: "第十回 從左道一時失足 納忠言立刻回頭 神器難僥倖，奸雄漫起爭。",
        text: "第十回正文",
      },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第九回 倩明媒但求一美 央冥判竟得雙姝", "第十回 從左道一時失足 納忠言立刻回頭"],
  );
});

test("Gutenberg cleanup merges short Chinese review chapters", () => {
  const book = BOOKS.find((row) => row.id === "wushengxi-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一回 丑郎君怕嬌偏得艷", text: "正文一" },
      { n: 2, title: "評", text: "短評一" },
      { n: 3, title: "第二回 美男子避惑反生疑", text: "正文二" },
      { n: 4, title: "評", text: "短評二" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第一回 丑郎君怕嬌偏得艷", "第二回 美男子避惑反生疑"],
  );
  assert.match(payload.chapters[0].text, /短評一/);
  assert.match(payload.chapters[1].text, /短評二/);
});

test("Gutenberg cleanup merges short Chinese interlude titles inside chapter runs", () => {
  const book = BOOKS.find((row) => row.id === "mengzhong-yuan-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一回 才子佳人初相會", text: "正文一" },
      { n: 2, title: "蝶戀花", text: "詞牌後正文一" },
      { n: 3, title: "第二回 花前月下訂終身", text: "正文二" },
      { n: 4, title: "第三回 風波忽起", text: "正文三" },
      { n: 5, title: "南鄉子", text: "詞牌後正文三" },
      { n: 6, title: "第四回 雲開月明", text: "正文四" },
      { n: 7, title: "第五回 團圓", text: "正文五" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    [
      "第一回 才子佳人初相會",
      "第二回 花前月下訂終身",
      "第三回 風波忽起",
      "第四回 雲開月明",
      "第五回 團圓",
    ],
  );
  assert.match(payload.chapters[0].text, /蝶戀花/);
  assert.match(payload.chapters[2].text, /南鄉子/);
});

test("Gutenberg cleanup merges a single short Chinese interlude in a strong chapter run", () => {
  const book = BOOKS.find((row) => row.id === "laocan-youji-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一回 土不制水歷年成患", text: "正文一" },
      { n: 2, title: "第二回 歷山山下古帝遺蹤", text: "正文二" },
      { n: 3, title: "第三回 金線東來尋黑虎", text: "正文三" },
      { n: 4, title: "第四回 宮保愛才求賢若渴", text: "正文四" },
      { n: 5, title: "第五回 烈婦有心殉節", text: "正文五" },
      { n: 6, title: "銀鼠諺", text: "短題後正文" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    [
      "第一回 土不制水歷年成患",
      "第二回 歷山山下古帝遺蹤",
      "第三回 金線東來尋黑虎",
      "第四回 宮保愛才求賢若渴",
      "第五回 烈婦有心殉節",
    ],
  );
  assert.match(payload.chapters[4].text, /銀鼠諺/);
});

test("Gutenberg cleanup restores Tiangong Kaiwu's missing sixth title marker", () => {
  const book = BOOKS.find((row) => row.id === "tiangong-kaiwu-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "作咸第五", text: "作咸正文\n\n甘嗜\n\n甘嗜正文" },
      { n: 2, title: "陶埏第七", text: "陶埏正文" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["作咸第五", "甘嗜第六", "陶埏第七"],
  );
  assert.match(payload.chapters[0].text, /作咸正文/);
  assert.doesNotMatch(payload.chapters[0].text, /甘嗜正文/);
  assert.match(payload.chapters[1].text, /^甘嗜正文$/u);
});

test("Gutenberg cleanup can split a missing leading Chinese first chapter from body text", () => {
  const book = BOOKS.find((row) => row.id === "jiuming-qiyuan-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      {
        n: 1,
        title: "第二回 廣源店股東拆股 馬鞍街星士談星",
        text: "第一回正文。\n\n卻說廣東素稱繁盛之區，向來商賈雲集。",
      },
      { n: 2, title: "第三回 接京函陳大人賣關節 除孝服凌貴興考鄉科", text: "第三回正文。" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    [
      "第一回 亂哄哄強盜作先聲 慢悠悠閒文標引首",
      "第二回 廣源店股東拆股 馬鞍街星士談星",
      "第三回 接京函陳大人賣關節 除孝服凌貴興考鄉科",
    ],
  );
  assert.match(payload.chapters[0].text, /第一回正文/);
  assert.match(payload.chapters[1].text, /^卻說廣東/u);
});

test("Gutenberg cleanup replaces configured Chinese title mojibake", () => {
  const book = BOOKS.find((row) => row.id === "jin-yunqiao-zhuan-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第五回 甘心受百忙堬r棄生死 捨不得一家人哭斷肝腸", text: "正文" },
      { n: 2, title: "第六回 孝女捨身行孝猶費周旋", text: "正文二" },
    ],
  });
  assert.equal(payload.chapters[0].title, "第五回 甘心受百忙裏猛棄生死 捨不得一家人哭斷肝腸");
});

test("Gutenberg cleanup trims Chinese recitation markers from chapter titles", () => {
  const payload = cleanGutenbergPayload(
    { title: "癡人福", lang: "zh", skipTitles: [] },
    {
      blurb: "",
      chapters: [
        { n: 1, title: "第三回醜媳婦隱妒侍夫 詞曰：", text: "正文" },
        { n: 2, title: "第五回唐夫人背夫遣妾 詩曰：", text: "正文二" },
      ],
    },
  );
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第三回醜媳婦隱妒侍夫", "第五回唐夫人背夫遣妾"],
  );
});

test("Gutenberg cleanup normalizes Chinese book and appendix display titles", () => {
  const book = BOOKS.find((row) => row.id === "guwen-guanzhi-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    title: "古文觀止, Complete",
    blurb: "",
    chapters: [
      { n: 1, title: "古文觀止", text: "正文".repeat(1200) },
      { n: 2, title: "附錄A‧蓼莪 詩經", text: "附錄正文" },
      { n: 3, title: "附錄B‧尚志齋說 虞集", text: "附錄正文二" },
    ],
  });
  assert.equal(payload.title, "古文觀止");
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["古文觀止", "附錄甲‧蓼莪 詩經", "附錄乙‧尚志齋說 虞集"],
  );
});

test("Gutenberg cleanup repairs Chuke Paian Jingqi split volume titles", () => {
  const book = BOOKS.find((row) => row.id === "chuke-paian-jingqi-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      {
        n: 1,
        title: "第七卷唐明皇好道集奇人",
        text: "武惠妃崇禪鬥異法 詩曰： 燕市人皆去，函關馬不歸。 正文七。",
      },
      {
        n: 2,
        title: "第十九卷李公佐巧解夢中言 謝小娥智擒船上盜 贊云： 士或巾幗，女或弁冕。",
        text: "正文十九。",
      },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第七卷唐明皇好道集奇人 武惠妃崇禪鬥異法", "第十九卷李公佐巧解夢中言 謝小娥智擒船上盜"],
  );
  assert.match(payload.chapters[0].text, /^詩曰/u);
  assert.match(payload.chapters[1].text, /^贊云/u);
});

test("Gutenberg Chinese catalog has no configured single-chapter fallback", () => {
  assert.deepEqual(
    BOOKS.filter((book) => book.lang === "zh" && book.mergeAsSingleChapter).map((book) => book.id),
    [],
  );
});

test("Gutenberg cleanup removes Shenlou Zhi's early duplicate final volume", () => {
  const book = BOOKS.find((row) => row.id === "shenlou-zhi-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一卷", text: "正文一。" },
      { n: 2, title: "第十二卷", text: "提前重複。" },
      { n: 3, title: "第二卷", text: "正文二。" },
      { n: 4, title: "第三卷", text: "正文三。" },
      { n: 5, title: "第十二卷", text: "正文十二。" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第一卷", "第二卷", "第三卷", "第十二卷"],
  );
  assert.doesNotMatch(payload.chapters.map((chapter) => chapter.text).join("\n"), /提前重複/);
});

test("Gutenberg cleanup removes Kuoyi Zhi duplicate volume summary run", () => {
  const book = BOOKS.find((row) => row.id === "kuoyi-zhi-gutenberg-zh");
  const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      ...numerals.map((n, index) => ({ n: index + 1, title: `卷${n}`, text: "目錄摘要" })),
      ...numerals.map((n, index) => ({
        n: index + 11,
        title: `卷${n}`,
        text: `正文第${index + 1}卷。`.repeat(80),
      })),
    ],
  });

  assert.equal(payload.chapters.length, 10);
  assert.equal(payload.chapters[0].title, "卷一");
  assert.match(payload.chapters[0].text, /正文第1卷/);
  assert.deepEqual(assertImportQuality({ ...book, minChapters: 3 }, payload.chapters), []);
});

test("Gutenberg cleanup removes exact duplicate Chinese source chapters", () => {
  const book = BOOKS.find((row) => row.id === "zhongguo-xiaoshuo-shilue-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一篇 史家對于小說之著錄及論述", text: "正文一" },
      { n: 2, title: "第二篇 神話与傳說", text: "正文二" },
      { n: 3, title: "第二篇 神話与傳說", text: "正文二" },
      { n: 4, title: "第三篇 《漢書》《藝文志》所載小說", text: "正文三" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第一篇 史家對于小說之著錄及論述", "第二篇 神話与傳說", "第三篇 《漢書》《藝文志》所載小說"],
  );
  assert.deepEqual(assertImportQuality({ ...book, minChapters: 3 }, payload.chapters), []);
});

test("Gutenberg cleanup merges Shanghan Lun section split back into volume", () => {
  const book = BOOKS.find((row) => row.id === "shanghan-lun-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "傷寒例第三", text: "正文一" },
      { n: 2, title: "捲第三", text: "正文二" },
      { n: 3, title: "捲第四", text: "正文三" },
      { n: 4, title: "捲第五", text: "辨陽明病脈證並治第八" },
      { n: 5, title: "辨少陽病脈證並治第九", text: "少陽正文" },
      { n: 6, title: "捲第六", text: "正文六" },
    ],
  });

  assert.equal(payload.chapters.length, 5);
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["傷寒例第三", "捲第三", "捲第四", "捲第五", "捲第六"],
  );
  assert.match(payload.chapters[3].text, /辨少陽病脈證並治第九/);
  assert.deepEqual(assertImportQuality(book, payload.chapters), []);
});

test("Gutenberg cleanup replaces configured Chinese garbled title", () => {
  const book = BOOKS.find((row) => row.id === "fenzhuang-lou-quanzhuan-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第七十二回 破長安媕野~合 入皇宮訴屈伸冤", text: "正文" },
      { n: 2, title: "第七十三回 眾爵位遇赦征番 各英雄提兵平寇", text: "正文二" },
    ],
  });
  assert.equal(payload.chapters[0].title, "第七十二回 破長安裏應外合 入皇宮訴屈伸冤");
});

test("Gutenberg catalog keeps Fenzhuang Lou split volumes chaptered", () => {
  const ids = [
    "fenzhuang-lou-1-10-gutenberg-zh",
    "fenzhuang-lou-11-20-gutenberg-zh",
    "fenzhuang-lou-21-30-gutenberg-zh",
    "fenzhuang-lou-31-40-gutenberg-zh",
    "fenzhuang-lou-41-50-gutenberg-zh",
    "fenzhuang-lou-51-60-gutenberg-zh",
    "fenzhuang-lou-61-70-gutenberg-zh",
    "fenzhuang-lou-71-80-gutenberg-zh",
  ];
  const books = ids.map((id) => BOOKS.find((row) => row.id === id));

  assert.deepEqual(
    books.map((book) => book?.pg),
    [4572, 4573, 4574, 4575, 4576, 4577, 4578, 4579],
  );
  for (const book of books) {
    assert.equal(book.lang, "zh");
    assert.equal(book.minChapters, 10);
    assert.equal(book.maxChapters, 10);
    assert.equal(book.textSource.kind, "hui");
    assert.equal(book.textSource.prefer, "plain");
  }
});

test("Gutenberg catalog keeps recovered Chinese plain-text sources chaptered", () => {
  const expected = new Map([
    ["yangjia-jiang-gutenberg-zh", [23842, 50, "hui"]],
    ["wenming-xiaoshi-gutenberg-zh", [25379, 60, "hui"]],
    ["shigong-an-gutenberg-zh", [23825, 528, "hui"]],
    ["yuli-hun-gutenberg-zh", [25521, 30, "zh-chapter"]],
    ["yuzhiji-gutenberg-zh", [27105, 20, "hui"]],
    ["shuangfeng-qiyuan-gutenberg-zh", [25348, 80, "hui"]],
    ["xu-xiake-youji-gutenberg-zh", [23876, 42, "travel-diary"]],
    ["changyan-dao-gutenberg-zh", [24170, 16, "hui-next-title-line"]],
    ["qianziwen-gutenberg-zh", [24075, 20, "line-sections", 22]],
    ["baijiaxing-gutenberg-zh", [25196, 30, "line-sections", 50]],
    ["sanzijing-gutenberg-zh", [12479, 5, "paragraph-sections"]],
    ["zhuzi-zhijia-geyan-gutenberg-zh", [23816, 6, "paragraph-sections"]],
    ["dayingguo-renshi-lueshuo-gutenberg-zh", [54820, 9, "paragraph-sections"]],
    ["manjianghong-gutenberg-zh", [27204, 2, "marked-line-sections"]],
    ["changhen-ge-gutenberg-zh", [25352, 30, "line-sections"]],
    ["shuidiao-getou-gutenberg-zh", [27123, 4, "marked-line-sections"]],
    ["kongque-dongnanfei-gutenberg-zh", [52275, 184, "line-sections", 185]],
    ["luoshen-fu-gutenberg-zh", [24041, 30, "line-sections"]],
    ["li-taibai-ji-gutenberg-zh", [24060, 40, "marked-line-sections", 45]],
    ["youmeng-ying-gutenberg-zh", [25381, 200, "line-sections", 230]],
    ["youming-lu-gutenberg-zh", [52278, 200, "line-sections", 350]],
    ["xihu-jiahua-gutenberg-zh", [24273, 16, "numbered-volume"]],
    ["chibei-outan-gutenberg-zh", [25162, 26, "numbered-volume"]],
    ["bu-hongloumeng-gutenberg-zh", [25202, 48, "hui"]],
    ["shitou-dian-gutenberg-zh", [25399, 14, "hui"]],
  ]);

  for (const [id, [pg, chapters, kind, maxChapters = chapters]] of expected) {
    const book = BOOKS.find((row) => row.id === id);
    assert.equal(book?.pg, pg);
    assert.equal(book.lang, "zh");
    assert.equal(book.minChapters, chapters);
    assert.equal(book.maxChapters, maxChapters);
    assert.equal(book.textSource.kind, kind);
    assert.equal(book.textSource.prefer, "plain");
  }
});

test("Gutenberg cleanup replaces Hongloumeng source title garble", () => {
  const book = BOOKS.find((row) => row.id === "hongloumeng-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第六十二回 憨湘云醉眠芍藥茵屆@呆香菱情解石榴裙", text: "正文" },
      { n: 2, title: "第一零二回 宁國府骨肉病災襟腹@大觀園符水驅妖孽", text: "正文二" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    [
      "第六十二回 憨湘云醉眠芍藥裀 呆香菱情解石榴裙",
      "第一零二回 宁國府骨肉病災襟腹 大觀園符水驅妖孽",
    ],
  );
});

test("Gutenberg cleanup repairs Mudanting source scene order and titles", () => {
  const book = BOOKS.find((row) => row.id === "mudanting-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一出 標目", text: "正文一" },
      { n: 2, title: "第三出 訓女", text: "正文三" },
      { n: 3, title: "第二出 言懷", text: "正文二" },
      { n: 4, title: "第四出 腐歡", text: "正文四" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第一出 標目", "第二出 言懷", "第三出 訓女", "第四出 腐歡"],
  );

  const titlePayload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第三十四出 ?", text: "正文三十四" },
      { n: 2, title: "第五十二出 榜下", text: "正文五十二" },
    ],
  });
  assert.deepEqual(
    titlePayload.chapters.map((chapter) => chapter.title),
    ["第三十四出 詗藥", "第五十二出 索元"],
  );
});

test("Gutenberg cleanup removes repeated question marks after Chinese ordinals", () => {
  const book = BOOKS.find((row) => row.id === "hudie-mei-gutenberg-zh");
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: [
      { n: 1, title: "第一回???? 靈隱寺禪僧貽寶倡", text: "正文" },
      { n: 2, title: "第二回???? 華柔玉命題親考試", text: "正文二" },
    ],
  });
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["第一回 靈隱寺禪僧貽寶倡", "第二回 華柔玉命題親考試"],
  );
  assert.deepEqual(assertImportQuality(book, payload.chapters), []);
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
  for (const id of [
    "max-havelaar-gutenberg-nl",
    "onder-moeders-vleugels-gutenberg-nl",
    "prometheus-geboeid-gutenberg-nl",
    "noli-me-tangere-gutenberg-nl",
  ]) {
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
  for (const id of [
    "roda-rummet-gutenberg-sv",
    "hemsoborna-gutenberg-sv",
    "kalevala-sv-gutenberg-sv",
    "teckningar-drommar-gutenberg-sv",
    "katornas-folk-gutenberg-sv",
    "moloks-leende-gutenberg-sv",
  ]) {
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
  for (const id of [
    "agamemnon-gutenberg-fi",
    "kavaluus-rakkaus-gutenberg-fi",
    "rautakorko-gutenberg-fi",
    "sointula-gutenberg-fi",
  ]) {
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
  for (const id of [
    "pelle-erobreren-1-gutenberg-da",
    "tine-gutenberg-da",
    "kongens-fald-gutenberg-da",
  ]) {
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
  for (const id of [
    "divina-dottrina-gutenberg-it",
    "demagoghi-gutenberg-it",
    "carita-prossimo-gutenberg-it",
    "favorita-mahdi-gutenberg-it",
  ]) {
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
  const payload = cleanGutenbergPayload(
    { title: "Notre-Dame", skipTitles: [] },
    {
      blurb: "",
      chapters: [
        { n: 1, title: "LIVRE PREMIER", text: "I" },
        { n: 2, title: "I LA GRAND’SALLE", text: "long texte" },
        { n: 3, title: "LIVRE SIXIÈME", text: "VI" },
        { n: 4, title: "II LE TROU AUX RATS", text: "suite" },
      ],
    },
  );
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["I LA GRAND’SALLE", "II LE TROU AUX RATS"],
  );
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.n),
    [1, 2],
  );
});

test("Gutenberg cleanup names single-chapter Chinese books after the book", () => {
  const payload = cleanGutenbergPayload(
    { title: "公孫龍子", lang: "zh", skipTitles: [] },
    {
      blurb: "",
      chapters: [{ n: 1, title: "羊有角、牛有角。牛之而羊也；羊之而牛也，未可。", text: "正文" }],
    },
  );
  assert.equal(payload.chapters[0].title, "公孫龍子");
});

test("Gutenberg cleanup inserts configured Chinese missing chapter placeholders", () => {
  const book = BOOKS.find((row) => row.id === "datang-xinyu-gutenberg-zh");
  const sourceChapterNumbers = [
    ...Array.from({ length: 22 }, (_, index) => index + 1),
    ...Array.from({ length: 7 }, (_, index) => index + 25),
  ];
  const payload = cleanGutenbergPayload(book, {
    blurb: "",
    chapters: sourceChapterNumbers.map((n) => ({
      n,
      title: `第${n}章 原章${n}`,
      text: `正文${n}`,
    })),
  });
  assert.equal(payload.chapters.length, 31);
  assert.equal(payload.chapters[22].n, 23);
  assert.equal(payload.chapters[22].title, "第二十三章（缺）");
  assert.match(payload.chapters[22].text, /原文中标为缺失/);
  assert.equal(payload.chapters[23].n, 24);
  assert.equal(payload.chapters[23].title, "第二十四章（缺）");
  assert.equal(payload.chapters[24].title, "第25章 原章25");
  assert.deepEqual(assertImportQuality(book, payload.chapters), []);
});

test("Gutenberg cleanup repairs Kongcongzi Xiaoeerya subheadings", () => {
  const payload = cleanGutenbergPayload(
    { id: "kongcongzi-gutenberg-zh", lang: "zh", title: "孔叢子" },
    {
      blurb: "",
      chapters: [
        { n: 1, title: "孔叢卷上", text: "漢．魯人孔鮒著" },
        { n: 2, title: "〈嘉言〉第一", text: "正文一" },
        { n: 3, title: "〈抗志〉第十", text: "正文十" },
        { n: 4, title: "〈廣詁〉第一", text: "廣詁正文" },
        { n: 5, title: "〈廣言〉第二", text: "廣言正文" },
        { n: 6, title: "〈廣獸〉第十", text: "廣獸正文" },
        { n: 7, title: "〈公孫龍〉第十二", text: "正文十二" },
      ],
    },
  );
  assert.deepEqual(
    payload.chapters.map((chapter) => chapter.title),
    ["孔叢卷上", "〈嘉言〉第一", "〈抗志〉第十", "〈小爾雅〉第十一", "〈公孫龍〉第十二"],
  );
  assert.match(payload.chapters[3].text, /〈廣詁〉第一/);
  assert.match(payload.chapters[3].text, /廣獸正文/);
});

test("Gutenberg importer verifies public-domain rights before publishing candidates", async () => {
  const source = await readFile(
    new URL("../scripts/import-gutenberg-classics.mjs", import.meta.url),
    "utf8",
  );
  const importOneStart = source.indexOf("async function importOne");
  const importOneEnd = source.indexOf("function summarizeOutput");
  assert.notEqual(importOneStart, -1);
  assert.notEqual(importOneEnd, -1);
  const importOne = source.slice(importOneStart, importOneEnd);

  assert.ok(
    importOne.indexOf("verifyGutenbergPublicDomain(book, metadata)") <
      importOne.indexOf("downloadEpub(book, filePath)"),
    "RDF rights check should happen before downloading and publishing",
  );
  assert.match(
    importOne,
    /verifyPublishLicense\(info,\s*\{\s*source: sourceUrl\(book\),\s*license: metadataLicense\.license,\s*evidence: metadata\.rights\.join/,
  );
  assert.match(
    importOne,
    /createBookManifest\(filePath,\s*\{\s*source: sourceUrl\(book\),\s*license: metadataLicense\.license/,
  );
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
        skipped: true,
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
  assert.equal(summary.skipped, 1);
  assert.equal(summary.results[0].skipped, true);
  assert.equal(summary.results[0].license, "public-domain");
  assert.equal(summary.failures[0].id, "sample-en");
});
