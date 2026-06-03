import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKS,
  cleanWikisourceWikitext,
  extractWikisourceSection,
  importBookConcurrency,
  parseArgs,
  parseWikisourceChapters,
  rawUrl,
  sourceUrl,
  summarizeOutput,
  textFromRenderedHtml,
  wikisourceRedirectTarget,
  wikisourceTransclusionTitles,
} from "../scripts/import-wikisource-classics.mjs";

test("Wikisource importer catalog is Chinese public-domain curated", () => {
  assert.equal(BOOKS.length >= 9610, true);
  assert.equal(BOOKS.every((book) => book.lang === "zh"), true);
  assert.equal(new Set(BOOKS.map((book) => book.id)).size, BOOKS.length);
  assert.equal(BOOKS.every((book) => book.category.startsWith("中文 · ")), true);
  assert.equal(sourceUrl(BOOKS[0]).startsWith("https://zh.wikisource.org/wiki/"), true);
  assert.equal(rawUrl(BOOKS[0]).includes("action=raw"), true);
});

test("Wikisource importer includes expanded Chinese history series with source volume padding", () => {
  const byId = new Map(BOOKS.map((book) => [book.id, book]));
  assert.equal(byId.get("hanshu-001-wikisource-zh").sourceTitle, "漢書/卷001");
  assert.deepEqual(byId.get("hanshu-015-wikisource-zh").sourceTitles, [
    "漢書/卷015",
    "漢書/卷015b",
  ]);
  assert.deepEqual(byId.get("hanshu-099-wikisource-zh").sourceTitles, [
    "漢書/卷099上",
    "漢書/卷099中",
    "漢書/卷099下",
  ]);
  assert.deepEqual(byId.get("hanshu-100-wikisource-zh").sourceTitles, [
    "漢書/卷100上",
    "漢書/卷100下",
  ]);
  assert.deepEqual(byId.get("houhanshu-001-wikisource-zh").sourceTitles, [
    "後漢書/卷1上",
    "後漢書/卷1下",
  ]);
  assert.equal(byId.get("houhanshu-120-wikisource-zh").sourceTitle, "後漢書/卷120");
  assert.equal(byId.get("nanqishu-001-wikisource-zh").sourceTitle, "南齊書/卷1");
  assert.equal(byId.get("liangshu-001-wikisource-zh").sourceTitle, "梁書/卷01");
  assert.equal(byId.get("zhoushu-009-wikisource-zh").sourceTitle, "周書/卷09");
  assert.deepEqual(byId.get("weishu-105-wikisource-zh").sourceTitles, [
    "魏書/卷105之一",
    "魏書/卷105之二",
    "魏書/卷105之三",
    "魏書/卷105之四",
  ]);
  assert.equal(byId.get("beishi-099-wikisource-zh").sourceTitle, "北史/卷099");
  assert.equal(byId.get("beishi-100-wikisource-zh").sourceTitle, "北史/卷100");
  assert.equal(byId.get("suishu-085-wikisource-zh").category, "中文 · 史書");
  assert.deepEqual(byId.get("jiutangshu-200-wikisource-zh").sourceTitles, [
    "舊唐書/卷200上",
    "舊唐書/卷200下",
  ]);
  assert.equal(byId.get("xintangshu-001-wikisource-zh").sourceTitle, "新唐書/卷001");
  assert.deepEqual(byId.get("xintangshu-225-wikisource-zh").sourceTitles, [
    "新唐書/卷225上",
    "新唐書/卷225中",
    "新唐書/卷225下",
  ]);
  assert.equal(byId.get("jiuwudaishi-150-wikisource-zh").sourceTitle, "舊五代史/卷150");
  assert.equal(byId.get("xinwudaishi-009-wikisource-zh").sourceTitle, "新五代史/卷09");
  assert.equal(byId.get("songshi-496-wikisource-zh").sourceTitle, "宋史/卷496");
  assert.equal(byId.get("liaoshi-116-wikisource-zh").sourceTitle, "遼史/卷116");
  assert.equal(byId.get("jinshi-135-wikisource-zh").sourceTitle, "金史/卷135");
  assert.equal(byId.get("yuanshi-001-wikisource-zh").sourceTitle, "元史/卷001");
  assert.equal(byId.get("yuanshi-210-wikisource-zh").sourceTitle, "元史/卷210");
  assert.equal(byId.get("mingshi-332-wikisource-zh").sourceTitle, "明史/卷332");
  assert.equal(byId.get("zizhi-tongjian-001-wikisource-zh").sourceTitle, "資治通鑑/卷001");
  assert.equal(byId.get("zizhi-tongjian-294-wikisource-zh").sourceTitle, "資治通鑑/卷294");
  assert.equal(byId.get("xu-zizhi-tongjian-220-wikisource-zh").sourceTitle, "續資治通鑑/卷220");
  assert.equal(byId.get("ming-tongjian-090-wikisource-zh").sourceTitle, "明通鑑/卷090");
  assert.equal(byId.get("tongdian-200-wikisource-zh").sourceTitle, "通典/卷200");
  assert.equal(byId.get("tongdian-200-wikisource-zh").category, "中文 · 政書");
  assert.equal(byId.get("tongdian-200-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("quantangshi-001-wikisource-zh").sourceTitle, "全唐詩/卷001");
  assert.equal(byId.get("quantangshi-900-wikisource-zh").sourceTitle, "全唐詩/卷900");
  assert.equal(byId.get("quantangshi-900-wikisource-zh").category, "中文 · 詩歌");
  assert.equal(byId.get("quantangshi-900-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("quantangshi-900-wikisource-zh").renderedTextFallback, true);
  assert.equal(byId.get("taiping-guangji-001-wikisource-zh").sourceTitle, "太平廣記/卷第001");
  assert.equal(byId.get("taiping-guangji-500-wikisource-zh").sourceTitle, "太平廣記/卷第500");
  assert.equal(byId.get("taiping-guangji-500-wikisource-zh").category, "中文 · 筆記");
  assert.equal(byId.get("taiping-guangji-500-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("taiping-yulan-001-wikisource-zh").sourceTitle, "太平御覽/0001");
  assert.equal(byId.get("taiping-yulan-1000-wikisource-zh").title, "太平御覽·卷一千");
  assert.equal(byId.get("taiping-yulan-1000-wikisource-zh").sourceTitle, "太平御覽/1000");
  assert.equal(byId.get("taiping-yulan-1000-wikisource-zh").category, "中文 · 類書");
  assert.equal(byId.get("taiping-yulan-1000-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("cefu-yuangui-001-wikisource-zh").sourceTitle, "冊府元龜/卷0001");
  assert.equal(byId.has("cefu-yuangui-024-wikisource-zh"), false);
  assert.equal(byId.get("cefu-yuangui-956-wikisource-zh").sourceTitle, "冊府元龜/卷0956");
  assert.equal(byId.get("cefu-yuangui-1000-wikisource-zh").title, "冊府元龜·卷一千");
  assert.equal(byId.get("cefu-yuangui-1000-wikisource-zh").sourceTitle, "冊府元龜/卷1000");
  assert.equal(byId.get("cefu-yuangui-1000-wikisource-zh").category, "中文 · 類書");
  assert.equal(byId.get("cefu-yuangui-1000-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("yiwen-leiju-001-wikisource-zh").sourceTitle, "藝文類聚/卷001");
  assert.equal(byId.get("yiwen-leiju-100-wikisource-zh").sourceTitle, "藝文類聚/卷100");
  assert.equal(byId.get("yiwen-leiju-100-wikisource-zh").category, "中文 · 類書");
  assert.equal(byId.get("yiwen-leiju-100-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("chuxueji-030-wikisource-zh").sourceTitle, "初學記/卷第三十");
  assert.equal(byId.get("chuxueji-030-wikisource-zh").category, "中文 · 類書");
  assert.equal(byId.get("shuijingzhu-001-wikisource-zh").sourceTitle, "水經注/01");
  assert.equal(byId.get("shuijingzhu-040-wikisource-zh").sourceTitle, "水經注/40");
  assert.equal(byId.get("shuijingzhu-040-wikisource-zh").category, "中文 · 地理");
  assert.equal(byId.get("shuoyuan-020-wikisource-zh").sourceTitle, "說苑/卷20");
  assert.equal(byId.get("shuoyuan-020-wikisource-zh").category, "中文 · 子部");
  assert.deepEqual(byId.get("zhaoming-wenxuan-019-wikisource-zh").sourceTitles, [
    "昭明文選/卷19",
    "昭明文選/卷19續",
  ]);
  assert.equal(byId.get("zhaoming-wenxuan-060-wikisource-zh").sourceTitle, "昭明文選/卷60");
  assert.equal(byId.get("zhaoming-wenxuan-060-wikisource-zh").category, "中文 · 總集");
  assert.equal(byId.get("baopuzi-waipian-001-wikisource-zh").sourceTitle, "抱朴子/外篇/卷01");
  assert.equal(byId.get("baopuzi-waipian-052-wikisource-zh").sourceTitle, "抱朴子/外篇/卷52");
  assert.equal(byId.get("baopuzi-waipian-052-wikisource-zh").category, "中文 · 子部");
  assert.equal(byId.get("liji-001-wikisource-zh").sourceTitle, "禮記/曲禮上");
  assert.equal(byId.get("liji-047-wikisource-zh").sourceTitle, "禮記/喪服四制");
  assert.equal(byId.get("liji-047-wikisource-zh").category, "中文 · 禮學");
  assert.equal(byId.get("shangshu-004-wikisource-zh").sourceTitle, "尚書/皐陶謨");
  assert.equal(byId.get("shangshu-058-wikisource-zh").sourceTitle, "尚書/秦誓");
  assert.equal(byId.get("shangshu-058-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("zhouli-006-wikisource-zh").sourceTitle, "周禮/冬官考工記");
  assert.equal(byId.get("zhouli-006-wikisource-zh").category, "中文 · 禮學");
  assert.equal(byId.get("yili-017-wikisource-zh").sourceTitle, "儀禮/有司");
  assert.equal(byId.get("yili-017-wikisource-zh").category, "中文 · 禮學");
  assert.equal(byId.get("erya-001-wikisource-zh").sourceTitle, "爾雅");
  assert.equal(byId.get("erya-001-wikisource-zh").sourceSection, "釋詁 第一");
  assert.equal(byId.get("erya-015-wikisource-zh").sourceSection, "釋蟲 第十五");
  assert.equal(byId.get("erya-019-wikisource-zh").category, "中文 · 小學");
  assert.equal(byId.get("xiaojing-001-wikisource-zh").sourceTitle, "今文孝經");
  assert.equal(byId.get("xiaojing-001-wikisource-zh").sourceSection, "開宗明義章·第一");
  assert.equal(byId.get("xiaojing-018-wikisource-zh").sourceSection, "喪親章·第十八");
  assert.equal(byId.get("zuozhuan-001-wikisource-zh").sourceTitle, "春秋左氏傳/隱公");
  assert.equal(byId.get("zuozhuan-012-wikisource-zh").sourceTitle, "春秋左氏傳/哀公");
  assert.equal(byId.get("gongyangzhuan-001-wikisource-zh").sourceTitle, "春秋公羊傳/隱公");
  assert.equal(byId.get("gongyangzhuan-012-wikisource-zh").sourceTitle, "春秋公羊傳/哀公");
  assert.equal(byId.get("guliangzhuan-001-wikisource-zh").sourceTitle, "春秋穀梁傳/隱公");
  assert.equal(byId.get("guliangzhuan-012-wikisource-zh").sourceTitle, "春秋穀梁傳/哀公");
  assert.equal(byId.get("chunqiu-jing-001-wikisource-zh").sourceTitle, "春秋經/隱公");
  assert.equal(byId.get("chunqiu-jing-012-wikisource-zh").sourceTitle, "春秋經/哀公");
  assert.equal(byId.get("zhouyi-001-wikisource-zh").sourceTitle, "周易/乾");
  assert.equal(byId.get("zhouyi-064-wikisource-zh").sourceTitle, "周易/未濟");
  assert.equal(byId.get("shanhaijing-001-wikisource-zh").sourceTitle, "山海經/南山經");
  assert.equal(byId.get("shanhaijing-018-wikisource-zh").sourceTitle, "山海經/海內經");
  assert.equal(byId.get("wenxin-diaolong-001-wikisource-zh").sourceTitle, "文心雕龍/原道");
  assert.equal(byId.get("wenxin-diaolong-050-wikisource-zh").sourceTitle, "文心雕龍/序志");
  assert.equal(byId.get("shipin-001-wikisource-zh").sourceTitle, "詩品/卷上");
  assert.equal(byId.get("shipin-003-wikisource-zh").sourceTitle, "詩品/卷下");
  assert.equal(byId.get("tangshi-sanbaishou-001-wikisource-zh").sourceTitle, "賊退示官吏");
  assert.equal(byId.get("tangshi-sanbaishou-037-wikisource-zh").sourceTitle, "長恨歌");
  assert.equal(byId.get("tangshi-sanbaishou-320-wikisource-zh").sourceTitle, "宮詞 (玉樓天半起笙歌)");
  assert.equal(byId.get("gushi-shijiushou-001-wikisource-zh").sourceTitle, "行行重行行");
  assert.equal(byId.get("gushi-shijiushou-019-wikisource-zh").sourceTitle, "明月何皎皎");
  assert.equal(byId.get("songci-sanbaishou-001-wikisource-zh").sourceTitle, "宋詞三百首");
  assert.equal(byId.get("songci-sanbaishou-001-wikisource-zh").author, "趙佶");
  assert.equal(byId.get("songci-sanbaishou-001-wikisource-zh").sourceSection, "'''宴山亭·北行見杏花'''（[[Author:趙佶|趙佶]]）");
  assert.equal(byId.get("songci-sanbaishou-012-wikisource-zh").author, "晏殊");
  assert.equal(byId.get("songci-sanbaishou-012-wikisource-zh").sourceSection, "'''浣溪沙'''（[[Author:晏殊|晏殊]]）");
  assert.equal(byId.get("songci-sanbaishou-012-wikisource-zh").sourceSectionOccurrence, 2);
  assert.equal(byId.get("songci-sanbaishou-179-wikisource-zh").title, "宋詞三百首·青玉案（辛棄疾）");
  assert.equal(byId.get("songci-sanbaishou-179-wikisource-zh").author, "辛棄疾");
  assert.equal(byId.get("songci-sanbaishou-179-wikisource-zh").sourceSection, "[[青玉案 (辛棄疾)]]");
  assert.equal(byId.get("songci-sanbaishou-283-wikisource-zh").author, "李清照");
  assert.equal(byId.get("songci-sanbaishou-283-wikisource-zh").sourceSection, "'''永遇樂'''（[[Author:李清照|李清照]]）");
  assert.equal(byId.get("qianjiashi-001-wikisource-zh").title, "千家詩·春曉");
  assert.equal(byId.get("qianjiashi-001-wikisource-zh").author, "孟浩然");
  assert.equal(byId.get("qianjiashi-001-wikisource-zh").sourceTitle, "千家詩/卷一");
  assert.equal(byId.get("qianjiashi-072-wikisource-zh").author, "杜甫");
  assert.equal(byId.get("qianjiashi-072-wikisource-zh").sourceTitle, "千家詩/卷二");
  assert.equal(byId.get("qianjiashi-119-wikisource-zh").author, "杜甫");
  assert.equal(byId.get("qianjiashi-119-wikisource-zh").sourceSectionOccurrence, 2);
  assert.equal(byId.get("qianjiashi-163-wikisource-zh").author, "朱熹");
  assert.equal(byId.get("qianjiashi-215-wikisource-zh").title, "千家詩·自詠");
  assert.equal(byId.get("qianjiashi-215-wikisource-zh").author, "韓愈");
  assert.equal(byId.get("qianjiashi-220-wikisource-zh").author, "朱厚熜");
  assert.equal(byId.get("qianjiashi-220-wikisource-zh").sourceTitle, "千家詩/卷四");
  assert.equal(byId.get("chuci-jiusi-wikisource-zh").sourceTitle, "九思");
  assert.equal(byId.get("chuci-jiusi-wikisource-zh").category, "中文 · 楚辭");
  assert.equal(byId.get("shijing-001-wikisource-zh").sourceTitle, "詩經/關雎");
  assert.equal(byId.get("shijing-026-wikisource-zh").sourceTitle, "詩經/柏舟");
  assert.equal(byId.get("shijing-148-wikisource-zh").sourceTitle, "詩經/七月");
  assert.equal(byId.get("shijing-300-wikisource-zh").sourceTitle, "詩經/殷武");
  assert.equal(byId.get("shijing-300-wikisource-zh").category, "中文 · 詩經");
  assert.equal(byId.get("yuefu-shiji-001-wikisource-zh").title, "樂府詩集·卷一·郊廟歌辭一");
  assert.equal(byId.get("yuefu-shiji-001-wikisource-zh").sourceTitle, "樂府詩集/001卷");
  assert.equal(byId.get("yuefu-shiji-001-wikisource-zh").category, "中文 · 詩歌");
  assert.equal(byId.get("yuefu-shiji-050-wikisource-zh").title, "樂府詩集·卷五十·清商曲辭七");
  assert.equal(byId.get("yuefu-shiji-050-wikisource-zh").sourceTitle, "樂府詩集/050卷");
  assert.equal(byId.get("yuefu-shiji-100-wikisource-zh").title, "樂府詩集·卷一百·新樂府辭十一");
  assert.equal(byId.get("yuefu-shiji-100-wikisource-zh").sourceTitle, "樂府詩集/100卷");
  assert.equal(byId.get("yuefu-shiji-100-wikisource-zh").singleVolumeChapter, true);
  assert.equal(byId.get("taoyuanmingji-001-wikisource-zh").title, "陶淵明集·停雲");
  assert.equal(byId.get("taoyuanmingji-001-wikisource-zh").sourceTitle, "陶淵明集/卷一");
  assert.equal(byId.get("taoyuanmingji-001-wikisource-zh").author, "陶淵明");
  assert.equal(byId.get("taoyuanmingji-041-wikisource-zh").title, "陶淵明集·示周續之祖企謝景夷三郎·其二");
  assert.equal(byId.get("taoyuanmingji-041-wikisource-zh").sourceTitle, "陶淵明集/卷三");
  assert.equal(byId.get("taoyuanmingji-063-wikisource-zh").title, "陶淵明集·歸去來辭並序");
  assert.equal(byId.get("taoyuanmingji-064-wikisource-zh").title, "陶淵明集·桃花源記");
  assert.equal(byId.get("taoyuanmingji-066-wikisource-zh").title, "陶淵明集·五柳先生傳");
  assert.equal(byId.get("taoyuanmingji-072-wikisource-zh").sourceSection, "[[自祭文]]");
  assert.equal(byId.get("taoyuanmingji-072-wikisource-zh").category, "中文 · 別集");
  assert.equal(byId.get("mengxi-bitan-001-wikisource-zh").title, "夢溪筆談·序");
  assert.equal(byId.get("mengxi-bitan-029-wikisource-zh").sourceTitle, "夢溪筆談/續筆談");
  assert.equal(byId.get("rongzhai-suibi-001-wikisource-zh").sourceTitle, "容齋隨筆/总序");
  assert.equal(byId.get("laoxuean-biji-010-wikisource-zh").title, "老學庵筆記·卷十");
  assert.equal(byId.get("dongjing-menghualu-001-wikisource-zh").category, "中文 · 城市");
  assert.equal(byId.get("menglianglu-021-wikisource-zh").sourceTitle, "夢粱錄/卷20");
  assert.equal(byId.get("wulin-jiushi-011-wikisource-zh").title, "武林舊事·卷十");
  assert.equal(byId.get("taoan-mengyi-010-wikisource-zh").sourceTitle, "陶庵夢憶/卷08");
  assert.equal(byId.get("yuewei-caotang-biji-026-wikisource-zh").sourceTitle, "閱微草堂筆記/附");
  assert.equal(byId.get("luoyang-qielanji-001-wikisource-zh").title, "洛陽伽藍記·序");
  assert.equal(byId.get("luoyang-qielanji-006-wikisource-zh").sourceTitle, "洛陽伽藍記/卷五");
  assert.equal(byId.get("soushenji-020-wikisource-zh").title, "搜神記·卷二十");
  assert.equal(byId.get("soushenji-020-wikisource-zh").category, "中文 · 志怪小說");
  assert.equal(byId.get("gulie-nvzhuan-008-wikisource-zh").sourceTitle, "古列女傳 (四庫全書本)/卷8");
  assert.equal(byId.get("tang-caizi-zhuan-010-wikisource-zh").author, "辛文房");
  assert.equal(byId.get("chajing-003-wikisource-zh").sourceTitle, "茶經/卷下");
  assert.equal(byId.get("liuzu-tanjing-011-wikisource-zh").title, "六祖壇經·跋");
  assert.equal(byId.get("xijing-zaji-006-wikisource-zh").category, "中文 · 筆記");
});

test("Wikisource importer detects raw redirect targets before parsing", () => {
  assert.equal(
    wikisourceRedirectTarget("#REDIRECT [[戰國策 (士禮居叢書本)/東周]]"),
    "戰國策 (士禮居叢書本)/東周",
  );
  assert.equal(wikisourceRedirectTarget("夫道者，覆天載地。"), null);
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

test("Wikisource cleaner handles nested variants, ul markers, and nested header templates", () => {
  const raw = `{{header
| title = 項脊軒志
| notes = {{Textquality|50%}}
| from = 震川文集
}}
<div>
{{ul|泰山}}之陽，{{ul|汶水}}西流。
女-{zh-hans:叹;zh-hant:{{另|嘆|歎}};}-息。
</div>`;
  const text = cleanWikisourceWikitext(raw);
  assert.equal(text.includes("| from ="), false);
  assert.match(text, /泰山之陽，汶水西流。/);
  assert.match(text, /女嘆息。/);
});

test("Wikisource cleaner strips Chinese navigation link lines", () => {
  const text = cleanWikisourceWikitext(`[[../定公|上一篇]] [[../|回目录]]
----
==哀公元年==
元年春，王正月，公即位。`);
  assert.equal(text, "元年春，王正月，公即位。");
});

test("Wikisource cleaner drops title conversion markers before Chinese body", () => {
  const text = cleanWikisourceWikitext(`-{T|周易/乾}-
{{header2|section=乾}}
周易 第一卦
;乾
乾下乾上
*乾：元亨。利貞。`);
  assert.equal(text.startsWith("T|"), false);
  assert.match(text, /^周易 第一卦/);
});

test("Wikisource cleaner keeps Chinese text from variant and list templates", () => {
  const raw = `{{Header|title=老子}}
{{參|道，可道也|一作「道，可道」}}，{{参|非恆道也|一作「非常道」}}。

# {{ProperNoun|陳仲舉}}言爲士則。
# 棲守道德者，寂寞一時。`;
  const chapters = parseWikisourceChapters({ id: "variant-list-test" }, raw);
  assert.equal(chapters[0].text, "道，可道也，非恆道也。");
  assert.equal(chapters[1].text, "陳仲舉言爲士則。");
  assert.equal(chapters[2].text, "棲守道德者，寂寞一時。");
});

test("Wikisource cleaner drops nested Chinese annotation templates", () => {
  const text = cleanWikisourceWikitext(`{{Header|title=國語}}
正文。{{*|狃，{{!|-{}-𢗗-{}-|-{}-⿰忄犬-{}-}}也。咎，謂敗於韓。}}下文。`);
  assert.equal(text, "正文。下文。");
});

test("Wikisource cleaner drops orphan closing template braces in Chinese prose", () => {
  const text = cleanWikisourceWikitext(`{{Header|title=國語}}
日月會于龍{{!|𧱓|⿰豕尨}}，{{*|{{!|𧱓|⿰豕尨}}，龍尾也。}}謂周十二月、夏十月，日月合辰於尾上。月令：「孟冬，日在尾。」}}土氣含收。`);
  assert.equal(text, "日月會于龍，謂周十二月、夏十月，日月合辰於尾上。月令：「孟冬，日在尾。」土氣含收。");
});

test("Wikisource cleaner keeps nested variant text inside proper nouns", () => {
  const text = cleanWikisourceWikitext(`{{Header|title=史記}}
{{ProperNoun|高辛}}父曰{{ProperNoun|-{zh:蟜;zh-hans:{{!|𫊸|⿰虫乔}};zh-hant:蟜;}-極}}，{{標|長而敦敏}}。`);
  assert.equal(text, "高辛父曰蟜極，長而敦敏。");
});

test("Wikisource cleaner recovers malformed inline Chinese name templates", () => {
  const raw = `<onlyinclude>
# 山濤不學{{ProperNoun|孫}呉而闇與之理會。
# 昨夜聽{{ProperNoun|殷}]王淸言甚佳。
# 支道林、殷淵源倶在相王許。{{*|簡文}相王謂二人。
</onlyinclude>`;
  const chapters = parseWikisourceChapters({ id: "malformed-template-test" }, raw);
  assert.equal(chapters[0].text, "山濤不學孫呉而闇與之理會。");
  assert.equal(chapters[1].text, "昨夜聽殷王淸言甚佳。");
  assert.equal(chapters[2].text, "支道林、殷淵源倶在相王許。相王謂二人。");
});

test("Wikisource cleaner unwraps multiline quote templates in history prose", () => {
  const raw = `{{header2|title=晉書|section=卷三十六}}
張華著《鷦鷯賦》以自寄。其詞曰：
{{quote|何造化之多端，播群形于萬類。尚何懼于{罒童}罻！
動翼而逸，投足而安。}}
陳留阮籍見之，歎曰：「王佐之才也！」`;
  const text = cleanWikisourceWikitext(raw);
  assert.equal(text.includes("{{quote"), false);
  assert.match(text, /何造化之多端，播群形于萬類。/);
  assert.match(text, /陳留阮籍見之，歎曰：「王佐之才也！」/);
});

test("Wikisource cleaner drops navigation, notes, section headings, and inline note numbers", () => {
  const raw = `{{Header|title=秋聲賦|author=歐陽脩}}
< [[作者:歐陽脩]]<br>
< [[古文觀止]]
> [[淮南子|回目录]]
----

=秋水第十七=
==正文==
:秦王<sup>1</sup>使人謂安陵<sup>2</sup>君曰：「可。」唐雎3使於秦。

===註釋===
1秦王，注也。`;
  const text = cleanWikisourceWikitext(raw);
  assert.equal(text.includes("作者:"), false);
  assert.equal(text.includes("古文觀止"), false);
  assert.equal(text.includes("回目录"), false);
  assert.equal(text.includes("----"), false);
  assert.equal(text.includes("註釋"), false);
  assert.equal(text.includes("秋水第十七"), false);
  assert.equal(text.trim(), "秦王使人謂安陵君曰：「可。」唐雎使於秦。");
});

test("Wikisource cleaner drops plain title-author mastheads", () => {
  const raw = `{{Header|title=送薛存義序|author=柳宗元}}
送薛存義序 作者：柳宗元

河東薛存義將行，柳子載肉於俎。`;
  const text = cleanWikisourceWikitext(raw);
  assert.equal(text, "河東薛存義將行，柳子載肉於俎。");
});

test("Wikisource cleaner keeps HTML paragraph bodies and drops collation notes", () => {
  const raw = `{{textquality|25%}}{{header|title=[[../]]|section=藝文一|notes=校本}}
<p>自六經焚於秦而復出於漢，其師傳之道中絕。</p>
<p>六經之道，簡嚴易直而天人備。</p>
==校勘記==
<ref>校勘尾注。</ref>`;
  const text = cleanWikisourceWikitext(raw);
  assert.match(text, /自六經焚於秦而復出於漢/);
  assert.match(text, /六經之道，簡嚴易直/);
  assert.equal(text.includes("校勘記"), false);
});

test("Wikisource cleaner strips header2 templates before same-line history body", () => {
  const raw = `{{header2| title = [[../]]| section = '''卷十一'''<ref name="缺" /><br>補列傳第三| notes ={{textquality|25%}}}} ==河南康献王 ==
河南康献王孝瑜，字正德，文襄長子也。`;
  const chapters = parseWikisourceChapters({ id: "beiqi-header2-test", category: "中文 · 史書" }, raw);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].text, "河南康献王孝瑜，字正德，文襄長子也。");
});

test("Wikisource importer can isolate collection page sections", () => {
  const raw = `{{Header|title=古文觀止}}
=卷一=

==鄭伯克段于鄢==
初，鄭武公娶于申，曰武姜。{{*|注。}} 生莊公。

==周鄭交質==
鄭武公、莊公爲平王卿士。`;
  const section = extractWikisourceSection(raw, "鄭伯克段于鄢");
  const chapters = parseWikisourceChapters({ id: "guwen-test" }, section);
  assert.equal(chapters[0].text, "初，鄭武公娶于申，曰武姜。生莊公。");
  assert.equal(section.includes("周鄭交質"), false);

  const book = BOOKS.find((item) => item.id === "guwen-guanzhi-001-wikisource-zh");
  assert.equal(sourceUrl(book), "https://zh.wikisource.org/wiki/%E5%8F%A4%E6%96%87%E8%A7%80%E6%AD%A2/%E5%8D%B71#%E9%84%AD%E4%BC%AF%E5%85%8B%E6%AE%B5%E4%BA%8E%E9%84%A2");
  assert.equal(rawUrl(book).includes(encodeURIComponent("古文觀止/卷1")), true);
});

test("Wikisource importer matches variant-marked section headings", () => {
  const raw = `== 釋-{蟲}- 第十五 ==\n螜，天螻。\n\n== 釋魚 第十六 ==\n鯉，鱣。`;
  assert.equal(extractWikisourceSection(raw, "釋蟲 第十五").trim(), "螜，天螻。");
});

test("Wikisource importer can select repeated section headings by occurrence", () => {
  const raw = `== '''浣溪沙'''（[[Author:晏殊|晏殊]]） ==\n一曲新詞酒一杯。\n\n== '''浣溪沙'''（[[Author:晏殊|晏殊]]） ==\n一向年光有限身。`;
  assert.equal(
    extractWikisourceSection(raw, "'''浣溪沙'''（[[Author:晏殊|晏殊]]）", 2).trim(),
    "一向年光有限身。",
  );
});

test("Wikisource importer detects transcluded Chinese work pages", () => {
  assert.deepEqual(wikisourceTransclusionTitles("==[[青玉案 (辛棄疾)]]==\n{{:青玉案 (辛棄疾)}}"), [
    "青玉案 (辛棄疾)",
  ]);
});

test("Wikisource importer keeps unclosed onlyinclude bodies", () => {
  const chapters = parseWikisourceChapters(
    { id: "unclosed-onlyinclude", singleVolumeChapter: true },
    `<onlyinclude>
<poem>
:七月流火，九月授衣。
</poem>
<section begin=p1 />
===註釋===`,
  );
  assert.match(chapters[0].text, /七月流火，九月授衣。/);
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

test("Wikisource importer keeps Chinese history volumes as one reader chapter", () => {
  const chapters = parseWikisourceChapters(
    { id: "songshu-sample", title: "宋書·卷二十二", category: "中文 · 史書" },
    `<onlyinclude>甲子，詔曰：「可。」

乙丑，百官奏事。

丙寅，復置郡縣。</onlyinclude>`,
  );
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "全文");
  assert.match(chapters[0].text, /甲子，詔曰/);
  assert.match(chapters[0].text, /\n\n乙丑，百官奏事。/);
});

test("Wikisource importer keeps marked Chinese volume series as one reader chapter", () => {
  const chapters = parseWikisourceChapters(
    { id: "tongdian-sample", title: "通典·卷一", category: "中文 · 政書", singleVolumeChapter: true },
    `<onlyinclude>食貨一

田制上

周制，井田之法。</onlyinclude>`,
  );
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "全文");
  assert.match(chapters[0].text, /周制，井田之法/);
});

test("Wikisource rendered HTML fallback extracts transcluded Chinese poems", () => {
  const text = textFromRenderedHtml(`
<table class="ws-header"><tr><td>全唐詩 卷四十二</td></tr></table>
<div class="mw-heading"><h2><a>酬楊比部員外暮宿琴堂朝躋書閣率爾見贈之作</a></h2><span class="mw-editsection">[编辑]</span></div>
<div class="poem"><p>閑拂簷塵看，鳴琴候月彈。<br />桃源迷漢姓，松<span class="variant-text">徑<span class="variant-tooltip">一作「樹」</span></span>有秦官。</p></div>`);
  assert.match(text, /酬楊比部員外暮宿琴堂朝躋書閣率爾見贈之作/);
  assert.match(text, /閑拂簷塵看，鳴琴候月彈。/);
  assert.match(text, /松徑有秦官。/);
  assert.doesNotMatch(text, /全唐詩 卷四十二/);
  assert.doesNotMatch(text, /编辑/);
  assert.doesNotMatch(text, /一作「樹」/);
});

test("Wikisource importer keeps long Chinese paragraph ordinals in Chinese", () => {
  const chapters = parseWikisourceChapters(
    { id: "sample-long", title: "長篇" },
    `<onlyinclude>${Array.from({ length: 120 }, (_, index) => `第${index + 1}則。`).join("\n\n")}</onlyinclude>`,
  );
  assert.equal(chapters[99].title, "第一百段");
  assert.equal(chapters[100].title, "第一百零一段");
  assert.equal(chapters[109].title, "第一百一十段");
  assert.equal(chapters[119].title, "第一百二十段");
});

test("Wikisource importer removes source div ordinal markers from classical chapters", () => {
  const chapters = parseWikisourceChapters(
    BOOKS.find((book) => book.id === "lunyu-weizheng-wikisource-zh"),
    `<onlyinclude><div id="二之一" style="background-color:#F0F0F0;">子曰：「爲政以德，譬如北辰。」</div>

<div id="二之二">子曰：「詩三百，一言以蔽之，曰思無邪。」</div></onlyinclude>`,
  );
  assert.deepEqual(chapters.map((chapter) => chapter.text), [
    "子曰：「爲政以德，譬如北辰。」",
    "子曰：「詩三百，一言以蔽之，曰思無邪。」",
  ]);
});

test("Wikisource importer starts at section markers when onlyinclude is absent", () => {
  const chapters = parseWikisourceChapters(
    BOOKS.find((book) => book.id === "tengwangge-xu-wikisource-zh"),
    `{{header|notes=頁頭說明<ref>不要導入</ref>}}
<section begin=p1 />
豫章故郡，洪都新府。

時維九月，序屬三秋。
<section end=p1 />`,
  );
  assert.deepEqual(chapters.map((chapter) => chapter.text), [
    "豫章故郡，洪都新府。",
    "時維九月，序屬三秋。",
  ]);
});

test("Wikisource importer keeps poem text before trailing note sections", () => {
  const chapters = parseWikisourceChapters(
    { id: "poem-before-notes", singleVolumeChapter: true },
    `<poem>
一封朝奏九重天，夕貶潮州路八千。<ref>校注</ref>
欲為聖明除弊事，肯將衰朽惜殘年？
</poem>
<section begin=p1 />
===註釋===
<references/>`,
  );
  assert.equal(chapters[0].text, "一封朝奏九重天，夕貶潮州路八千。欲為聖明除弊事，肯將衰朽惜殘年？");
});

test("Wikisource importer parses bounded concurrency options", () => {
  const options = parseArgs(["--publish", "--concurrency", "5", "--chapter-concurrency", "7", "--publish-attempts", "9", "--publish-timeout-ms", "45000", "--summary", "--json", "--quiet", "--no-live-probe"]);
  assert.equal(options.publish, true);
  assert.equal(options.concurrency, 5);
  assert.equal(options.chapterConcurrency, 7);
  assert.equal(options.publishAttempts, 9);
  assert.equal(options.publishTimeoutMs, 45000);
  assert.equal(options.summary, true);
  assert.equal(options.json, true);
  assert.equal(options.quiet, true);
  assert.equal(options.liveProbe, false);
  assert.equal(importBookConcurrency(parseArgs([])), 8);
  assert.equal(importBookConcurrency(parseArgs(["--publish"])), 4);
  assert.equal(parseArgs([]).chapterConcurrency, 10);
  assert.equal(parseArgs([]).publishAttempts, 8);
  assert.equal(parseArgs([]).liveProbe, true);
  assert.throws(() => parseArgs(["--concurrency", "0"]), /--concurrency must be positive/);
  assert.throws(() => parseArgs(["--chapter-concurrency", "0"]), /--chapter-concurrency must be positive/);
  assert.throws(() => parseArgs(["--publish-attempts", "0"]), /--publish-attempts must be positive/);
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
