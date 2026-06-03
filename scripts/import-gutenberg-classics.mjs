#!/usr/bin/env node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createBookManifest,
  createIngestPayload,
  garbledTextWarnings,
  inspectEpub,
  publishBookManifestChunked,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";
import { LANGUAGE_CATEGORY_PREFIX, languageCodeFor } from "../src/lib/languages.js";

const API_URL = "https://liber.davirain.xyz";
const DEFAULT_IMPORT_LANGS = ["zh"];
const MAX_CHAPTERS_FOR_AUTO_PUBLISH = 300;
const FETCH_RETRIES = 3;
const FETCH_RETRY_BASE_MS = 750;
const DEFAULT_DRY_RUN_CONCURRENCY = 4;
const DEFAULT_PUBLISH_CONCURRENCY = 2;
const DEFAULT_CHAPTER_PUBLISH_CONCURRENCY = 6;

const PANGHUANG_TITLES = [
  "祝福",
  "傷逝【1】 ──涓生的手記",
  "在酒樓上",
  "孤獨者",
  "示眾",
  "高老夫子〔１〕",
  "離婚",
  "長明燈〔１〕",
];
const PANGHUANG_TITLE_MAP = {
  "傷逝【1】 ──涓生的手記": "傷逝",
  "高老夫子〔１〕": "高老夫子",
  "長明燈〔１〕": "長明燈",
};
const CHAOHUA_XISHI_TITLES = [
  "小引",
  "狗·貓·鼠",
  "阿長與山海經",
  "《二十四孝圖》",
  "五猖會",
  "無常",
  "瑣記",
  "藤野先生",
  "范愛農",
];
const CHAOHUA_XISHI_TITLE_MAP = {
  阿長與山海經: "阿長與《山海經》",
  "《二十四孝圖》": "二十四孝圖",
};
const ERYA_TITLES = [
  "釋詁",
  "釋言",
  "釋訓",
  "釋親",
  "釋宮",
  "釋器",
  "釋樂",
  "釋天",
  "釋地",
  "釋丘",
  "釋山",
  "釋水",
  "釋草",
  "釋木",
  "釋蟲",
  "釋魚",
  "釋鳥",
  "釋獸",
  "釋畜",
];
const ZHOULI_TITLES = ["天官冢宰", "地官司徒", "春官宗伯", "夏官司馬", "秋官司寇", "冬官考工記"];
const YESCAO_TITLES = [
  "《野草》題辭",
  "秋夜",
  "影的告別",
  "求乞者",
  "我的失戀",
  "復仇",
  "希望",
  "雪",
  "風箏",
  "好的故事",
  "過客",
  "死火",
  "狗的駁詰",
  "失掉的好地獄",
  "墓碣文",
  "頹敗線的顫動",
  "立論",
  "死後",
  "這樣的戰士",
  "聰明人和傻子和奴才",
  "臘葉",
  "淡淡的血痕中",
  "一覺",
];
const YESCAO_TITLE_MAP = { "《野草》題辭": "題辭" };
const SHENYIN_YU_TITLES = [
  "性命",
  "存心",
  "倫理",
  "談道",
  "修身",
  "問學",
  "應務",
  "養生",
  "天地",
  "世運",
  "聖賢",
  "品藻",
  "治道",
  "人情",
  "物理",
  "廣喻",
  "詞章",
];

const BOOKS = [
  {
    id: "daodejing-gutenberg-zh",
    pg: 7337,
    lang: "zh",
    title: "道德經",
    category: "中文 · 道家",
    expect: "道德經",
  },
  {
    id: "laozi-gutenberg-zh",
    pg: 24039,
    lang: "zh",
    title: "老子",
    category: "中文 · 道家",
    expect: "老子",
  },
  {
    id: "liezi-gutenberg-zh",
    pg: 7341,
    lang: "zh",
    title: "列子",
    category: "中文 · 道家",
    expect: "列子",
  },
  {
    id: "lunyu-gutenberg-zh",
    pg: 23839,
    lang: "zh",
    title: "論語",
    category: "中文 · 儒家",
    expect: "論語",
  },
  {
    id: "mengzi-gutenberg-zh",
    pg: 24178,
    lang: "zh",
    title: "孟子",
    category: "中文 · 儒家",
    expect: "孟子",
  },
  {
    id: "yijing-gutenberg-zh",
    pg: 25501,
    lang: "zh",
    title: "易經",
    category: "中文 · 易学",
    expect: "易經",
  },
  {
    id: "shijing-gutenberg-zh",
    pg: 23873,
    lang: "zh",
    title: "詩經",
    category: "中文 · 诗经",
    expect: "詩經",
    maxChapters: 330,
  },
  {
    id: "liji-gutenberg-zh",
    pg: 24048,
    lang: "zh",
    title: "禮記",
    category: "中文 · 礼学",
    expect: "禮記",
  },
  {
    id: "sunzi-bingfa-gutenberg-zh",
    pg: 23864,
    lang: "zh",
    title: "孫子兵法",
    category: "中文 · 兵法",
    expect: "孫子",
  },
  {
    id: "mozi-gutenberg-zh",
    pg: 24240,
    lang: "zh",
    title: "墨子",
    category: "中文 · 先秦",
    expect: "墨子",
  },
  {
    id: "hanfeizi-gutenberg-zh",
    pg: 24049,
    lang: "zh",
    title: "韩非子",
    category: "中文 · 法家",
    expect: "韩非子",
  },
  {
    id: "tangshi300-gutenberg-zh",
    pg: 52323,
    lang: "zh",
    title: "唐诗三百首",
    category: "中文 · 诗歌",
    expect: "唐诗",
    maxChapters: 340,
  },
  {
    id: "suitang-yanyi-gutenberg-zh",
    pg: 23835,
    lang: "zh",
    title: "隋唐演義",
    category: "中文 · 古典小说",
    expect: "隋唐演義",
  },
  {
    id: "niehaihua-gutenberg-zh",
    pg: 25128,
    lang: "zh",
    title: "孽海花",
    category: "中文 · 古典小说",
    expect: "孽海花",
  },
  {
    id: "sanzijing-gutenberg-zh",
    pg: 12479,
    lang: "zh",
    title: "三字經",
    category: "中文 · 蒙学",
    expect: "三字經",
    minChapters: 5,
    maxChapters: 5,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "人之初",
      titleSuffix: "段",
    },
  },
  {
    id: "baijiaxing-gutenberg-zh",
    pg: 25196,
    lang: "zh",
    title: "百家姓",
    category: "中文 · 蒙学",
    expect: "百家姓",
    minChapters: 30,
    maxChapters: 50,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "趙錢孫李",
      titleSuffix: "行",
      titleFromLineChars: 8,
    },
  },
  {
    id: "qianziwen-gutenberg-zh",
    pg: 24075,
    lang: "zh",
    title: "千字文",
    category: "中文 · 蒙学",
    expect: "千字文",
    minChapters: 20,
    maxChapters: 22,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "天地玄黃",
      titleSuffix: "段",
      titleFromLineChars: 8,
    },
  },
  {
    id: "daxue-zhangju-gutenberg-zh",
    pg: 7375,
    lang: "zh",
    title: "大學 章句",
    category: "中文 · 儒家",
    expect: "大學",
    minChapters: 12,
    maxChapters: 12,
    textSource: {
      kind: "right-marker",
      prefer: "plain",
      introTitle: "大學章句序",
      mainPattern: "\\n大學章句\\n",
      markerPattern: "右(?:經一章|傳之(?:首|[一二三四五六七八九十]+)章)",
    },
  },
  {
    id: "zhongyong-zhangju-gutenberg-zh",
    pg: 7376,
    lang: "zh",
    title: "中庸 章句",
    category: "中文 · 儒家",
    expect: "中庸",
    minChapters: 34,
    maxChapters: 34,
    textSource: {
      kind: "right-marker",
      prefer: "plain",
      introTitle: "中庸章句序",
      mainPattern: "中庸章句中者",
      markerPattern: "右第\\s*[一二三四五六七八九十百]+\\s*章",
    },
  },
  {
    id: "shuihu-zhuan-gutenberg-zh",
    pg: 23863,
    lang: "zh",
    title: "水滸傳",
    category: "中文 · 古典小说",
    expect: "水滸傳",
  },
  {
    id: "xingshi-yinyuan-gutenberg-zh",
    pg: 26161,
    lang: "zh",
    title: "醒世姻緣",
    category: "中文 · 古典小说",
    expect: "醒世姻緣",
  },
  {
    id: "laocan-youji-gutenberg-zh",
    pg: 25124,
    lang: "zh",
    title: "老殘遊記",
    category: "中文 · 近代小说",
    expect: "老殘遊記",
  },
  {
    id: "huayuehen-gutenberg-zh",
    pg: 25219,
    lang: "zh",
    title: "花月痕",
    category: "中文 · 古典小说",
    expect: "花月痕",
  },
  {
    id: "liuzu-tanjing-gutenberg-zh",
    pg: 23844,
    lang: "zh",
    title: "六祖壇經",
    category: "中文 · 佛典",
    expect: "六祖壇經",
  },
  {
    id: "jingangjing-gutenberg-zh",
    pg: 24098,
    lang: "zh",
    title: "金剛般若波羅蜜經",
    category: "中文 · 佛典",
    expect: "金剛般若",
  },
  {
    id: "mengxi-bitan-gutenberg-zh",
    pg: 27292,
    lang: "zh",
    title: "夢溪筆談",
    category: "中文 · 笔记",
    expect: "夢溪筆談",
  },
  {
    id: "yanshi-jiaxun-gutenberg-zh",
    pg: 25365,
    lang: "zh",
    title: "顔氏家訓",
    category: "中文 · 家训",
    expect: "顔氏家訓",
  },
  {
    id: "wenxin-diaolong-gutenberg-zh",
    pg: 23822,
    lang: "zh",
    title: "文心雕龍",
    category: "中文 · 文论",
    expect: "文心雕龍",
  },
  {
    id: "lin-er-bao-gutenberg-zh",
    pg: 27399,
    lang: "zh",
    title: "麟兒報",
    category: "中文 · 古典小说",
    expect: "麟兒報",
  },
  {
    id: "shuihu-houzhuan-gutenberg-zh",
    pg: 25217,
    lang: "zh",
    title: "水滸後傳",
    category: "中文 · 古典小说",
    expect: "水滸後傳",
  },
  {
    id: "xueyuemei-zhuan-gutenberg-zh",
    pg: 26739,
    lang: "zh",
    title: "雪月梅傳",
    category: "中文 · 古典小说",
    expect: "雪月梅傳",
  },
  {
    id: "zuixing-shi-gutenberg-zh",
    pg: 24027,
    lang: "zh",
    title: "醉醒石",
    category: "中文 · 古典小说",
    expect: "醉醒石",
  },
  {
    id: "jingshi-tongyan-gutenberg-zh",
    pg: 24141,
    lang: "zh",
    title: "警世通言",
    category: "中文 · 古典小说",
    expect: "警世通言",
  },
  {
    id: "suiyuan-shihua-gutenberg-zh",
    pg: 52206,
    lang: "zh",
    title: "隨園詩話",
    category: "中文 · 诗话",
    expect: "隨園詩話",
    minChapters: 26,
    maxChapters: 26,
    textSource: { kind: "quoted-volume", prefer: "plain" },
  },
  {
    id: "jingu-qiguan-gutenberg-zh",
    pg: 24230,
    lang: "zh",
    title: "今古奇觀",
    category: "中文 · 古典小说",
    expect: "今古奇觀",
  },
  {
    id: "jinpingmei-gutenberg-zh",
    pg: 52200,
    lang: "zh",
    title: "金瓶梅",
    category: "中文 · 古典小说",
    expect: "金瓶梅",
  },
  {
    id: "rizhilu-gutenberg-zh",
    pg: 25262,
    lang: "zh",
    title: "日知錄",
    category: "中文 · 笔记",
    expect: "日知錄",
    minChapters: 32,
    maxChapters: 32,
    textSource: { kind: "bare-volume", prefer: "plain" },
    ordinalPlaceholders: [{ kind: "卷", n: 31, title: "卷三十一（缺）" }],
  },
  {
    id: "zhongguo-xiaoshuo-shilue-gutenberg-zh",
    pg: 25559,
    lang: "zh",
    title: "中國小說史略",
    category: "中文 · 文论",
    expect: "中國小說史略",
    minChapters: 29,
    maxChapters: 30,
    textSource: { kind: "zh-piece", prefer: "plain", startPattern: "\\n題記\\n" },
  },
  {
    id: "pingyao-zhuan-gutenberg-zh",
    pg: 57227,
    lang: "zh",
    title: "平妖傳",
    category: "中文 · 神魔小说",
    expect: "平妖傳",
  },
  {
    id: "erke-paian-jingqi-gutenberg-zh",
    pg: 26729,
    lang: "zh",
    title: "二刻拍案驚奇",
    category: "中文 · 古典小说",
    expect: "二刻拍案",
  },
  {
    id: "chuke-paian-jingqi-gutenberg-zh",
    pg: 57248,
    lang: "zh",
    title: "初刻拍案驚奇",
    category: "中文 · 古典小说",
    expect: "初刻拍案",
  },
  {
    id: "yushi-mingyan-gutenberg-zh",
    pg: 27582,
    lang: "zh",
    title: "喻世明言",
    category: "中文 · 古典小说",
    expect: "喻世明言",
  },
  {
    id: "doupeng-xianhua-gutenberg-zh",
    pg: 25328,
    lang: "zh",
    title: "豆棚閒話",
    category: "中文 · 古典小说",
    expect: "豆棚閒話",
    minChapters: 14,
    maxChapters: 14,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      maxChars: 18,
      requirePattern: "^(?:弁言|敘|第)",
    },
    titleReplacements: [{ from: "第 虎丘山賈清客聯盟", to: "第十則 虎丘山賈清客聯盟" }],
  },
  {
    id: "bimuyu-gutenberg-zh",
    pg: 24185,
    lang: "zh",
    title: "比目魚",
    category: "中文 · 古典小说",
    expect: "比目魚",
  },
  {
    id: "shanhaijing-gutenberg-zh",
    pg: 25288,
    lang: "zh",
    title: "山海經",
    category: "中文 · 神话地理",
    expect: "山海經",
    minChapters: 18,
    maxChapters: 18,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: [
        "南山經",
        "西山經",
        "北山經",
        "東山經",
        "中山經",
        "海外南經",
        "海外西經",
        "海外北經",
        "海外東經",
        "海內南經",
        "大荒南經",
        "海內西經",
        "海內北經",
        "海內東經",
        "大荒東經",
        "大荒西經",
        "大荒北經",
        "海內經",
      ],
    },
  },
  {
    id: "mulan-qinv-zhuan-gutenberg-zh",
    pg: 23938,
    lang: "zh",
    title: "木蘭奇女傳",
    category: "中文 · 古典小说",
    expect: "木蘭奇女傳",
  },
  {
    id: "yandan-zi-gutenberg-zh",
    pg: 24068,
    lang: "zh",
    title: "燕丹子",
    category: "中文 · 史传",
    expect: "燕丹子",
    minChapters: 3,
    maxChapters: 3,
    keepLeadingTitleChapter: true,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "digong-an-gutenberg-zh",
    pg: 27686,
    lang: "zh",
    title: "狄公案",
    category: "中文 · 公案小说",
    expect: "狄公案",
  },
  {
    id: "tianbao-tu-gutenberg-zh",
    pg: 26904,
    lang: "zh",
    title: "天豹圖",
    category: "中文 · 古典小说",
    expect: "天豹圖",
  },
  {
    id: "lianggong-jiujian-gutenberg-zh",
    pg: 26886,
    lang: "zh",
    title: "梁公九諫",
    category: "中文 · 史传",
    expect: "梁公九諫",
    minChapters: 9,
    maxChapters: 9,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "第一諫", maxChars: 18 },
  },
  {
    id: "changhen-ge-gutenberg-zh",
    pg: 25352,
    lang: "zh",
    title: "長恨歌",
    category: "中文 · 诗歌",
    expect: "長恨歌",
    minChapters: 30,
    maxChapters: 30,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "漢皇重色思傾國",
      endPattern: "在天願作比翼鳥，在地願為連理枝，天長地久有時盡，此恨綿綿無絕期。",
      titleFromLineChars: 8,
    },
  },
  {
    id: "liwa-zhuan-gutenberg-zh",
    pg: 24051,
    lang: "zh",
    title: "李娃傳",
    category: "中文 · 唐传奇",
    expect: "李娃傳",
  },
  {
    id: "yulou-chun-gutenberg-zh",
    pg: 25422,
    lang: "zh",
    title: "玉樓春",
    category: "中文 · 古典小说",
    expect: "玉樓春",
  },
  {
    id: "hanshu-gutenberg-zh",
    pg: 23841,
    lang: "zh",
    title: "漢書",
    category: "中文 · 史书",
    expect: "漢書",
  },
  {
    id: "hou-xiyouji-gutenberg-zh",
    pg: 27332,
    lang: "zh",
    title: "後西游記",
    category: "中文 · 神魔小说",
    expect: "後西游記",
  },
  {
    id: "luoshen-fu-gutenberg-zh",
    pg: 24041,
    lang: "zh",
    title: "洛神賦",
    category: "中文 · 辞赋",
    expect: "洛神賦",
    minChapters: 30,
    maxChapters: 30,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "黃初三年",
      endPattern: "攬騑轡以抗策，悵盤桓而不能去。",
      titleFromLineChars: 8,
    },
  },
  {
    id: "youxue-qionglin-gutenberg-zh",
    pg: 52269,
    lang: "zh",
    title: "幼學瓊林",
    category: "中文 · 蒙学",
    expect: "幼學瓊林",
    minChapters: 4,
    maxChapters: 4,
    textSource: { kind: "bare-volume", prefer: "plain" },
  },
  {
    id: "pipa-ji-gutenberg-zh",
    pg: 25246,
    lang: "zh",
    title: "琵琶記",
    category: "中文 · 戏曲",
    expect: "琵琶記",
    minChapters: 42,
    maxChapters: 45,
    textSource: { kind: "play-act", prefer: "plain" },
  },
  {
    id: "sanguo-zhi-gutenberg-zh",
    pg: 25606,
    lang: "zh",
    title: "三國志",
    category: "中文 · 史书",
    expect: "三國志",
    minChapters: 25,
    maxChapters: 35,
    allowSparseTrailingOrdinals: true,
    textSource: { kind: "three-kingdoms-history", prefer: "plain" },
  },
  {
    id: "baigui-zhi-gutenberg-zh",
    pg: 27023,
    lang: "zh",
    title: "白圭志",
    category: "中文 · 古典小说",
    expect: "白圭志",
  },
  {
    id: "mengzi-ziyi-shuzheng-gutenberg-zh",
    pg: 25360,
    lang: "zh",
    title: "孟子字義疏證",
    category: "中文 · 儒家",
    expect: "孟子字義疏證",
    minChapters: 8,
    maxChapters: 8,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "理十五條",
      maxChars: 12,
    },
  },
  {
    id: "anle-ji-gutenberg-zh",
    pg: 24106,
    lang: "zh",
    title: "安樂集",
    category: "中文 · 佛典",
    expect: "安樂集",
    minChapters: 2,
    maxChapters: 2,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      startPattern: "安樂集卷上",
      titles: ["安樂集卷上", "安樂集卷下"],
      ignoreRepeatedTitle: true,
    },
  },
  {
    id: "dengxizi-gutenberg-zh",
    pg: 7215,
    lang: "zh",
    title: "鄧析子",
    category: "中文 · 名家",
    expect: "鄧析子",
    minChapters: 2,
    maxChapters: 2,
    textSource: { kind: "known-title-list", prefer: "plain", titles: ["無厚篇", "轉辭篇"] },
  },
  {
    id: "qiuranke-zhuan-gutenberg-zh",
    pg: 23915,
    lang: "zh",
    title: "虬髯客傳",
    category: "中文 · 唐传奇",
    expect: "虬髯客傳",
    minChapters: 10,
    maxChapters: 10,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "隋煬帝之幸江都也",
      titleSuffix: "段",
    },
  },
  {
    id: "wuchuan-lu-gutenberg-zh",
    pg: 27581,
    lang: "zh",
    title: "吳船錄",
    category: "中文 · 地理游记",
    expect: "吳船錄",
    minChapters: 2,
    maxChapters: 2,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      startPattern: "石湖居士",
      initialTitle: "卷上",
      titles: ["卷下"],
    },
  },
  {
    id: "xingcha-shenglan-gutenberg-zh",
    pg: 24143,
    lang: "zh",
    title: "星槎勝覽",
    category: "中文 · 地理游记",
    expect: "星槎勝覽",
    minChapters: 38,
    maxChapters: 40,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "○真臘國", maxChars: 18 },
  },
  {
    id: "dongzhou-lieguo-zhi-gutenberg-zh",
    pg: 25349,
    lang: "zh",
    title: "東周列國志",
    category: "中文 · 历史小说",
    expect: "東周列國志",
  },
  {
    id: "xingshi-hengyan-gutenberg-zh",
    pg: 24239,
    lang: "zh",
    title: "醒世恆言",
    category: "中文 · 话本小说",
    expect: "醒世恆言",
  },
  {
    id: "soushen-ji-gutenberg-zh",
    pg: 25362,
    lang: "zh",
    title: "搜神記",
    category: "中文 · 志怪",
    expect: "搜神記",
    minChapters: 20,
    maxChapters: 20,
    textSource: { kind: "numbered-volume", prefer: "plain" },
  },
  {
    id: "baopuzi-gutenberg-zh",
    pg: 25696,
    lang: "zh",
    title: "抱朴子",
    category: "中文 · 道家",
    expect: "抱朴子",
  },
  {
    id: "xijing-zaji-gutenberg-zh",
    pg: 25368,
    lang: "zh",
    title: "西京雜記",
    category: "中文 · 笔记",
    expect: "西京雜記",
    minChapters: 6,
    maxChapters: 6,
    textSource: { kind: "numbered-volume", prefer: "plain" },
  },
  {
    id: "youming-lu-gutenberg-zh",
    pg: 52278,
    lang: "zh",
    title: "幽明錄",
    category: "中文 · 志怪",
    expect: "幽明錄",
    minChapters: 200,
    maxChapters: 350,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "幽明錄\\s+（南朝宋）劉義慶\\s+撰",
      skipLinePattern: "^幽明錄",
      titleSuffix: "則",
    },
  },
  {
    id: "mingjing-gongan-gutenberg-zh",
    pg: 52280,
    lang: "zh",
    title: "明鏡公案",
    category: "中文 · 公案小说",
    expect: "明鏡公案",
    minChapters: 4,
    maxChapters: 4,
    textSource: { kind: "numbered-volume", prefer: "plain" },
  },
  {
    id: "dou-e-yuan-gutenberg-zh",
    pg: 52276,
    lang: "zh",
    title: "竇娥冤",
    category: "中文 · 戏曲",
    expect: "竇娥冤",
    minChapters: 5,
    maxChapters: 5,
    textSource: { kind: "zaju-fold", prefer: "plain" },
  },
  {
    id: "guanzi-gutenberg-zh",
    pg: 7367,
    lang: "zh",
    title: "管子",
    category: "中文 · 诸子",
    expect: "管子",
    minChapters: 30,
    maxChapters: 40,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "\\n上編\\n",
      maxChars: 18,
      excludePattern: "^右",
    },
  },
  {
    id: "guiguzi-gutenberg-zh",
    pg: 25168,
    lang: "zh",
    title: "鬼谷子",
    category: "中文 · 纵横家",
    expect: "鬼谷子",
    minChapters: 23,
    maxChapters: 23,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "mutianzi-zhuan-gutenberg-zh",
    pg: 24058,
    lang: "zh",
    title: "穆天子传",
    category: "中文 · 史传",
    expect: "穆天子",
    minChapters: 6,
    maxChapters: 6,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "穆 天 子 傳 卷 之 一",
      titleSuffix: "卷",
    },
  },
  {
    id: "haishanghua-liezhuan-gutenberg-zh",
    pg: 26872,
    lang: "zh",
    title: "海上花列傳",
    category: "中文 · 近代小说",
    expect: "海上花列傳",
  },
  {
    id: "fengyue-meng-gutenberg-zh",
    pg: 26931,
    lang: "zh",
    title: "風月夢",
    category: "中文 · 近代小说",
    expect: "風月夢",
  },
  {
    id: "hanshi-waizhuan-gutenberg-zh",
    pg: 7290,
    lang: "zh",
    title: "韓詩外傳",
    category: "中文 · 儒家",
    expect: "韓詩外傳",
  },
  {
    id: "sanguo-yanyi-gutenberg-zh",
    pg: 23950,
    lang: "zh",
    title: "三國志演義",
    category: "中文 · 历史小说",
    expect: "三國志演義",
  },
  {
    id: "zhuye-ting-zaji-gutenberg-zh",
    pg: 43010,
    lang: "zh",
    title: "竹葉亭雜記",
    category: "中文 · 笔记",
    expect: "竹葉亭雜記",
    minChapters: 8,
    maxChapters: 8,
    textSource: { kind: "bare-volume", prefer: "plain" },
  },
  {
    id: "jinghua-yuan-gutenberg-zh",
    pg: 25377,
    lang: "zh",
    title: "鏡花緣",
    category: "中文 · 神魔小说",
    expect: "鏡花緣",
  },
  {
    id: "yuewei-caotang-biji-gutenberg-zh",
    pg: 23817,
    lang: "zh",
    title: "閱微草堂筆記",
    category: "中文 · 志怪笔记",
    expect: "閱微草堂筆記",
    minChapters: 12,
  },
  {
    id: "fengshen-yanyi-gutenberg-zh",
    pg: 23910,
    lang: "zh",
    title: "封神演義",
    category: "中文 · 神魔小说",
    expect: "封神演義",
    minChapters: 80,
  },
  {
    id: "ershinian-muduzhi-guaixianzhuang-gutenberg-zh",
    pg: 24099,
    lang: "zh",
    title: "二十年目睹之怪現狀",
    category: "中文 · 近代小说",
    expect: "二十年目睹",
    minChapters: 95,
  },
  // Gutenberg #23962 西遊記 is public-domain metadata, but this generated EPUB
  // is missing the tenth, twentieth, thirtieth, and other round-numbered 回.
  // Gutenberg #25327 兒女英雄傳, #24264 紅樓夢, #24032 儒林外史,
  // #24029 冷眼观, #26970 彭公案, #54494 海公案, and #27330 綠牡丹
  // expose missing 回/卷 runs, TOC fragments, or visible mojibake in current
  // sources; keep them out until clean sources are available. The same
  // active-quality rule currently excludes #54756 官場現形記, #23838 楊家將,
  // #25245 子不語, and #25393 施公案 because dry-run extraction either produced
  // too few chapters or detected required 回 gaps.
  // Gutenberg #25142 is titled 王陽明全集 but the generated EPUB spine also
  // mixes unrelated military classics into the extracted TOC; do not publish
  // until the source can be split or replaced cleanly.
  {
    id: "shiji-gutenberg-zh",
    pg: 24226,
    lang: "zh",
    title: "史記",
    category: "中文 · 史书",
    expect: "史記",
    minChapters: 100,
  },
  {
    id: "tang-caizi-zhuan-gutenberg-zh",
    pg: 28714,
    lang: "zh",
    title: "唐才子傳",
    category: "中文 · 史传",
    expect: "唐才子傳",
    minChapters: 8,
  },
  {
    id: "sanxia-wuyi-gutenberg-zh",
    pg: 25376,
    lang: "zh",
    title: "三俠五義",
    category: "中文 · 公案侠义",
    expect: "三俠五義",
    minChapters: 100,
  },
  {
    id: "liaozhai-zhiyi-gutenberg-zh",
    pg: 51828,
    lang: "zh",
    title: "聊齋志異",
    category: "中文 · 志怪",
    expect: "聊齋志異",
    minChapters: 300,
    maxChapters: 550,
  },
  {
    id: "oubei-shihua-gutenberg-zh",
    pg: 25391,
    lang: "zh",
    title: "甌北詩話",
    category: "中文 · 诗话",
    expect: "甌北詩話",
    minChapters: 5,
  },
  {
    id: "xihu-erji-gutenberg-zh",
    pg: 25392,
    lang: "zh",
    title: "西湖二集",
    category: "中文 · 话本小说",
    expect: "西湖二集",
    minChapters: 30,
  },
  {
    id: "datang-xinyu-gutenberg-zh",
    pg: 25280,
    lang: "zh",
    title: "大唐新語",
    category: "中文 · 笔记",
    expect: "大唐新語",
    ordinalPlaceholders: [
      { kind: "章", n: 23, title: "第二十三章（缺）" },
      { kind: "章", n: 24, title: "第二十四章（缺）" },
    ],
  },
  {
    id: "taiwan-tongshi-guohai-gutenberg-zh",
    pg: 25557,
    lang: "zh",
    title: "臺灣通史：唐山過海的故事",
    category: "中文 · 史书",
    expect: "臺灣通史",
    textSource: { kind: "taiwan-history", prefer: "plain" },
  },
  {
    id: "taohuayuan-ji-gutenberg-zh",
    pg: 2090,
    lang: "zh",
    title: "桃花源記",
    category: "中文 · 古文",
    expect: "桃花源",
    textSource: {
      kind: "single-heading",
      prefer: "plain",
      startPattern: "桃花源記",
      title: "桃花源記",
    },
  },
  {
    id: "dayingguo-renshi-lueshuo-gutenberg-zh",
    pg: 54820,
    lang: "zh",
    title: "大英國人事略說",
    category: "中文 · 近代文献",
    expect: "大英國人事略說",
    minChapters: 9,
    maxChapters: 9,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "英吉利國人品國事略說",
      endPattern: "大英國人事略說終",
      skipParagraphPattern: "^(?:英吉利國人品國事略說|大英國人事略說終)$",
      titleSuffix: "段",
    },
  },
  {
    id: "yangjia-jiang-gutenberg-zh",
    pg: 23842,
    lang: "zh",
    title: "楊家將",
    category: "中文 · 英雄传奇",
    expect: "楊家將",
    minChapters: 50,
    maxChapters: 50,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "wenming-xiaoshi-gutenberg-zh",
    pg: 25379,
    lang: "zh",
    title: "文明小史",
    category: "中文 · 近代小说",
    expect: "文明小史",
    minChapters: 60,
    maxChapters: 60,
    textSource: { kind: "hui", prefer: "plain" },
    ordinalPlaceholders: [{ kind: "回", n: 50, title: "第五十回（缺）" }],
  },
  {
    id: "shigong-an-gutenberg-zh",
    pg: 23825,
    lang: "zh",
    title: "施公案",
    category: "中文 · 公案小说",
    expect: "施公案",
    minChapters: 528,
    maxChapters: 528,
    textSource: { kind: "hui", prefer: "plain" },
    ordinalPlaceholders: [
      { kind: "回", n: 457, title: "第四五七回（缺）" },
      { kind: "回", n: 469, title: "第四六九回（缺）" },
      { kind: "回", n: 482, title: "第四八二回（缺）" },
    ],
  },
  {
    id: "yuli-hun-gutenberg-zh",
    pg: 25521,
    lang: "zh",
    title: "玉梨魂",
    category: "中文 · 近代小说",
    expect: "玉梨魂",
    minChapters: 30,
    maxChapters: 30,
    textSource: { kind: "zh-chapter", prefer: "plain" },
    ordinalPlaceholders: [{ kind: "章", n: 20, title: "第二十章（缺）" }],
  },
  {
    id: "yuzhiji-gutenberg-zh",
    pg: 27105,
    lang: "zh",
    title: "玉支机",
    category: "中文 · 古典小说",
    expect: "玉支机",
    minChapters: 20,
    maxChapters: 20,
    textSource: { kind: "hui", prefer: "plain" },
    ordinalPlaceholders: [
      { kind: "回", n: 7, title: "第七回（缺）" },
      { kind: "回", n: 11, title: "第十一回（缺）" },
      { kind: "回", n: 13, title: "第十三回（缺）" },
    ],
  },
  // Gutenberg #24231, #27218, #24169, and #25142 pass public-domain metadata
  // checks but still need cleaner source selection or Chinese splitting before
  // auto-publish.
  // Gutenberg #24040 metadata is public-domain, but its text/EPUB body is
  // mojibake. Keep it out until we find a clean public-domain/CC0 source.
  // Gutenberg #4580 粉妝樓 is superseded by its clean 10回 split-volume
  // sources. Gutenberg #27330 綠牡丹 can be split, but its body contains
  // visible mojibake in the current text source.
  // Gutenberg #25498 佛說無量壽經 has a garbled EPUB body, #27104 歸蓮夢 has
  // missing 回 headings, and #24183 宋史 is over-split into hundreds of chapters.
  {
    id: "xizhongxi-gutenberg-zh",
    pg: 24225,
    lang: "zh",
    title: "戲中戲",
    category: "中文 · 古典小说",
    expect: "戲中戲",
  },
  {
    id: "shanshuiqing-gutenberg-zh",
    pg: 25146,
    lang: "zh",
    title: "山水情",
    category: "中文 · 古典小说",
    expect: "山水情",
  },
  {
    id: "yinfengxiao-gutenberg-zh",
    pg: 26921,
    lang: "zh",
    title: "引鳳蕭",
    category: "中文 · 古典小说",
    expect: "引鳳蕭",
  },
  {
    id: "feituo-quanzhuan-gutenberg-zh",
    pg: 27331,
    lang: "zh",
    title: "飛跎全傳",
    category: "中文 · 古典小说",
    expect: "飛跎全傳",
  },
  {
    id: "sishier-zhangjing-gutenberg-zh",
    pg: 23585,
    lang: "zh",
    title: "佛說四十二章經",
    category: "中文 · 佛典",
    expect: "四十二章經",
    minChapters: 43,
    maxChapters: 43,
    textSource: { kind: "sishier-zhangjing", prefer: "plain" },
  },
  {
    id: "chunqiu-fanlou-gutenberg-zh",
    pg: 25385,
    lang: "zh",
    title: "春秋繁露",
    category: "中文 · 儒家",
    expect: "春秋繁露",
    textSource: { kind: "classic-ordinal", startPattern: "春秋繁露\\s+卷第一\\s+楚莊王第一" },
  },
  {
    id: "changsheng-dian-gutenberg-zh",
    pg: 52270,
    lang: "zh",
    title: "長生殿",
    category: "中文 · 戏曲",
    expect: "長生殿",
    textSource: { kind: "play-act" },
  },
  {
    id: "henhai-gutenberg-zh",
    pg: 23865,
    lang: "zh",
    title: "恨海",
    category: "中文 · 近代小说",
    expect: "恨海",
    textSource: { kind: "hui" },
  },
  {
    id: "jingwu-zhong-gutenberg-zh",
    pg: 24294,
    lang: "zh",
    title: "警悟鐘",
    category: "中文 · 古典小说",
    expect: "警悟鐘",
    textSource: { kind: "hui" },
  },
  {
    id: "huajian-ji-gutenberg-zh",
    pg: 24316,
    lang: "zh",
    title: "花間集",
    category: "中文 · 词集",
    expect: "花間集",
    textSource: { kind: "bracket-volume" },
  },
  {
    id: "shangzi-gutenberg-zh",
    pg: 7383,
    lang: "zh",
    title: "商子",
    category: "中文 · 法家",
    expect: "商子",
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "youmengying-gutenberg-zh",
    pg: 7420,
    lang: "zh",
    title: "幽夢影",
    category: "中文 · 笔记",
    expect: "幽夢影",
    minChapters: 210,
    maxChapters: 220,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "讀經宜冬",
      endPattern: "(?=\\n\\s*跋\\s*\\n)",
      titleSuffix: "則",
    },
  },
  {
    id: "badongtian-gutenberg-zh",
    pg: 27016,
    lang: "zh",
    title: "八洞天",
    category: "中文 · 神魔小说",
    expect: "八洞天",
    textSource: { kind: "bare-volume", prefer: "plain" },
  },
  {
    id: "hudie-mei-gutenberg-zh",
    pg: 27059,
    lang: "zh",
    title: "蝴蝶媒",
    category: "中文 · 古典小说",
    expect: "蝴蝶媒",
  },
  {
    id: "wudi-ji-gutenberg-zh",
    pg: 27087,
    lang: "zh",
    title: "吳地記",
    category: "中文 · 地理",
    expect: "吳地",
    minChapters: 15,
    maxChapters: 15,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "古館八所",
      maxChars: 12,
    },
  },
  {
    id: "huyu-kailu-gutenberg-zh",
    pg: 62791,
    lang: "zh",
    title: "滬語開路",
    category: "中文 · 方言",
    expect: "滬語開路",
    minChapters: 50,
    maxChapters: 60,
    textSource: { kind: "huyu-exercise", prefer: "plain" },
  },
  {
    id: "chaoshi-ruyan-gutenberg-zh",
    pg: 43014,
    lang: "zh",
    title: "晁氏儒言 一卷",
    category: "中文 · 儒家",
    expect: "晁氏儒言",
    minChapters: 65,
    maxChapters: 66,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "春秋", maxChars: 12 },
    titleReplacements: [{ from: "[聖賢之言", to: "聖賢之言" }],
  },
  {
    id: "zhishi-yuwen-gutenberg-zh",
    pg: 26932,
    lang: "zh",
    title: "治世餘聞",
    category: "中文 · 笔记",
    expect: "治世餘聞",
  },
  {
    id: "longchuan-ci-gutenberg-zh",
    pg: 26873,
    lang: "zh",
    title: "龍川詞",
    category: "中文 · 词集",
    expect: "龍川詞",
    minChapters: 35,
    maxChapters: 40,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "水調歌頭",
      maxChars: 18,
    },
  },
  {
    id: "tang-zhongkui-pinggui-zhuan-gutenberg-zh",
    pg: 27329,
    lang: "zh",
    title: "唐鍾馗平鬼傳",
    category: "中文 · 神魔小说",
    expect: "唐鍾馗",
  },
  {
    id: "caigentan-gutenberg-zh",
    pg: 24050,
    lang: "zh",
    title: "菜根譚",
    category: "中文 · 修身",
    expect: "菜根譚",
    minChapters: 220,
    maxChapters: 230,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "棲守道德者",
      titleSuffix: "則",
    },
  },
  {
    id: "huangbo-chuanxin-fayao-gutenberg-zh",
    pg: 25236,
    lang: "zh",
    title: "筠州黃檗山斷際禪師傳法心要",
    category: "中文 · 佛典",
    expect: "傳法心要",
    minChapters: 40,
    maxChapters: 40,
    allowProseFragmentTitles: true,
    textSource: {
      kind: "question-answer",
      prefer: "plain",
      startPattern: "師謂休曰",
      endPattern: "(?=\\n\\s*工作準備\\s*\\n)",
      initialTitle: "傳法心要",
      questionTitleChars: 22,
    },
  },
  {
    id: "shanshui-xiaodu-gutenberg-zh",
    pg: 23914,
    lang: "zh",
    title: "山水小牘",
    category: "中文 · 志怪",
    expect: "山水小牘",
    minChapters: 35,
    maxChapters: 35,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "趙知微雨夕登天柱峰翫月",
      endPattern: "(?=\\n\\s*逸文\\s*\\n)",
      maxChars: 24,
      excludePattern: "^(?:第一卷|第二卷|山水小牘)$",
    },
  },
  {
    id: "gaoshi-zhuan-gutenberg-zh",
    pg: 23948,
    lang: "zh",
    title: "高士傳",
    category: "中文 · 史传",
    expect: "高士傳",
    minChapters: 83,
    maxChapters: 83,
    textSource: { kind: "biography-paragraphs", prefer: "plain", startPattern: "被衣" },
  },
  {
    id: "tianfei-xiansheng-lu-gutenberg-zh",
    pg: 54777,
    lang: "zh",
    title: "天妃顯聖錄",
    category: "中文 · 宗教",
    expect: "天妃顯聖錄",
    minChapters: 43,
    textSource: { kind: "zh-chapter", prefer: "plain", startPattern: "●第一章求佳兒" },
  },
  {
    id: "sanlue-gutenberg-zh",
    pg: 7218,
    lang: "zh",
    title: "三略",
    category: "中文 · 兵法",
    expect: "三略",
  },
  {
    id: "mingyi-daifang-lu-gutenberg-zh",
    pg: 23855,
    lang: "zh",
    title: "明夷待訪錄",
    category: "中文 · 政论",
    expect: "明夷待訪錄",
    minChapters: 20,
    maxChapters: 22,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "題辭", maxChars: 12 },
  },
  {
    id: "yantielun-gutenberg-zh",
    pg: 26920,
    lang: "zh",
    title: "鹽鐵論",
    category: "中文 · 史论",
    expect: "鹽鐵論",
    minChapters: 60,
    maxChapters: 60,
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "yizhenqi-gutenberg-zh",
    pg: 27753,
    lang: "zh",
    title: "一枕奇",
    category: "中文 · 古典小说",
    expect: "一枕奇",
  },
  {
    id: "xingmeng-pianyan-gutenberg-zh",
    pg: 27108,
    lang: "zh",
    title: "醒夢駢言",
    category: "中文 · 古典小说",
    expect: "醒夢駢言",
  },
  {
    id: "taohua-shan-gutenberg-zh",
    pg: 24234,
    lang: "zh",
    title: "桃花扇",
    category: "中文 · 戏曲",
    expect: "桃花扇",
  },
  {
    id: "jinshi-yuan-gutenberg-zh",
    pg: 25369,
    lang: "zh",
    title: "金石緣",
    category: "中文 · 古典小说",
    expect: "金石緣",
  },
  {
    id: "xu-shishuo-gutenberg-zh",
    pg: 25287,
    lang: "zh",
    title: "續世說",
    category: "中文 · 笔记",
    expect: "續世說",
    minChapters: 35,
    maxChapters: 40,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 12 },
  },
  {
    id: "kongcongzi-gutenberg-zh",
    pg: 25374,
    lang: "zh",
    title: "孔叢子",
    category: "中文 · 儒家",
    expect: "孔叢子",
    minChapters: 22,
    maxChapters: 22,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "孔叢卷上",
      maxChars: 12,
    },
  },
  {
    id: "fengshi-wenjianji-gutenberg-zh",
    pg: 27207,
    lang: "zh",
    title: "封氏聞見記",
    category: "中文 · 笔记",
    expect: "封氏聞見記",
  },
  {
    id: "jiayi-xinshu-gutenberg-zh",
    pg: 23814,
    lang: "zh",
    title: "賈誼新書",
    category: "中文 · 政论",
    expect: "賈誼新書",
  },
  {
    id: "gongsunlongzi-gutenberg-zh",
    pg: 7216,
    lang: "zh",
    title: "公孫龍子",
    category: "中文 · 名家",
    expect: "公孫龍子",
    minChapters: 6,
    maxChapters: 6,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "sunzi-suanjing-gutenberg-zh",
    pg: 24038,
    lang: "zh",
    title: "孫子算經",
    category: "中文 · 算学",
    expect: "孫子算經",
  },
  {
    id: "lihe-shixuan-gutenberg-zh",
    pg: 25417,
    lang: "zh",
    title: "李賀詩選",
    category: "中文 · 诗歌",
    expect: "李賀詩選",
    minChapters: 4,
    maxChapters: 4,
    textSource: { kind: "bracket-volume", prefer: "plain", startPattern: "【\\s*卷一\\s*】" },
  },
  {
    id: "shuyu-ci-gutenberg-zh",
    pg: 25367,
    lang: "zh",
    title: "漱玉詞",
    category: "中文 · 词集",
    expect: "漱玉詞",
    minChapters: 45,
    maxChapters: 50,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "滿庭霜", maxChars: 12 },
  },
  {
    id: "liyi-shan-shiji-gutenberg-zh",
    pg: 25247,
    lang: "zh",
    title: "李義山詩集",
    category: "中文 · 诗歌",
    expect: "李義山詩集",
    minChapters: 500,
    maxChapters: 600,
    textSource: { kind: "numbered-quoted-poems", prefer: "plain", startPattern: "1「錦瑟」" },
  },
  {
    id: "huainanzi-gutenberg-zh",
    pg: 24059,
    lang: "zh",
    title: "淮南子",
    category: "中文 · 诸子",
    expect: "淮南子",
    minChapters: 21,
    maxChapters: 21,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "laocan-youji-xuji-gutenberg-zh",
    pg: 56291,
    lang: "zh",
    title: "老殘遊記續集",
    category: "中文 · 近代小说",
    expect: "老殘遊記續集",
    minChapters: 9,
    maxChapters: 9,
    textSource: { kind: "hui", prefer: "plain", startPattern: "老殘遊記續集/第01回" },
  },
  {
    id: "haidao-suanjing-gutenberg-zh",
    pg: 26979,
    lang: "zh",
    title: "海島算經",
    category: "中文 · 算学",
    expect: "海島算經",
    minChapters: 9,
    maxChapters: 9,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "今有望海島",
      titleSuffix: "問",
    },
  },
  {
    id: "yulizi-gutenberg-zh",
    pg: 25298,
    lang: "zh",
    title: "郁離子",
    category: "中文 · 寓言",
    expect: "郁離子",
    minChapters: 160,
    maxChapters: 190,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "renwuzhi-gutenberg-zh",
    pg: 7217,
    lang: "zh",
    title: "人物志",
    category: "中文 · 品鉴",
    expect: "人物志",
  },
  {
    id: "suitang-jiahua-gutenberg-zh",
    pg: 27596,
    lang: "zh",
    title: "隋唐嘉話",
    category: "中文 · 笔记",
    expect: "隋唐嘉話",
    minChapters: 4,
    maxChapters: 4,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "述曰",
      initialTitle: "隋唐嘉話上",
      maxChars: 18,
    },
  },
  {
    id: "liexian-zhuan-gutenberg-zh",
    pg: 25414,
    lang: "zh",
    title: "列仙傳",
    category: "中文 · 神仙传记",
    expect: "列仙傳",
    minChapters: 70,
    maxChapters: 70,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "lienv-zhuan-gutenberg-zh",
    pg: 24228,
    lang: "zh",
    title: "列女傳",
    category: "中文 · 史传",
    expect: "列女傳",
    minChapters: 100,
    maxChapters: 120,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "卷\\s*之\\s*一",
      maxChars: 18,
    },
    titleReplacements: [{ from: "湯妃有", to: "湯妃有㜪" }],
  },
  {
    id: "xinxu-gutenberg-zh",
    pg: 23945,
    lang: "zh",
    title: "新序",
    category: "中文 · 儒家",
    expect: "新序",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "spaced-classic-ordinal", prefer: "plain" },
  },
  {
    id: "shuoyuan-gutenberg-zh",
    pg: 7332,
    lang: "zh",
    title: "說苑",
    category: "中文 · 儒家",
    expect: "說苑",
  },
  {
    id: "shishuo-xinyu-gutenberg-zh",
    pg: 24047,
    lang: "zh",
    title: "世說新語",
    category: "中文 · 笔记",
    expect: "世說新語",
    minChapters: 36,
    maxChapters: 40,
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "wushengxi-gutenberg-zh",
    pg: 23907,
    lang: "zh",
    title: "無聲戲",
    category: "中文 · 古典小说",
    expect: "無聲戲",
  },
  {
    id: "xianqing-ouji-gutenberg-zh",
    pg: 25471,
    lang: "zh",
    title: "閒情偶寄",
    category: "中文 · 文论",
    expect: "闲情",
    textSource: { kind: "xianqing-ouji", prefer: "plain" },
  },
  {
    id: "dizigui-gutenberg-zh",
    pg: 23823,
    lang: "zh",
    title: "弟子規",
    category: "中文 · 蒙学",
    expect: "弟子規",
  },
  {
    id: "liutao-gutenberg-zh",
    pg: 7340,
    lang: "zh",
    title: "六韜",
    category: "中文 · 兵法",
    expect: "六韜",
  },
  {
    id: "nahan-gutenberg-zh",
    pg: 27166,
    lang: "zh",
    title: "吶喊",
    category: "中文 · 现代小说",
    expect: "吶喊",
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: [
        "《吶喊》自序",
        "一件小事",
        "狂人日記",
        "鴨的喜劇",
        "端午節",
        "故鄉",
        "孔乙己",
        "藥",
        "阿Q正傳",
        "兔和貓",
        "社戲",
        "風波",
        "頭發的故事",
        "明天",
        "白光",
      ],
      titleMap: { 阿Q正傳: "阿Ｑ正傳" },
    },
  },
  {
    id: "panghuang-gutenberg-zh",
    pg: 24042,
    lang: "zh",
    title: "徬徨",
    category: "中文 · 现代小说",
    expect: "徬徨",
    minChapters: 8,
    maxChapters: 8,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: PANGHUANG_TITLES,
      titleMap: PANGHUANG_TITLE_MAP,
    },
  },
  {
    id: "chaohua-xishi-gutenberg-zh",
    pg: 25271,
    lang: "zh",
    title: "朝花夕拾",
    category: "中文 · 散文",
    expect: "朝花夕拾",
    minChapters: 9,
    maxChapters: 9,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: CHAOHUA_XISHI_TITLES,
      titleMap: CHAOHUA_XISHI_TITLE_MAP,
    },
  },
  {
    id: "kuangren-riji-gutenberg-zh",
    pg: 25423,
    lang: "zh",
    title: "狂人日記",
    category: "中文 · 现代小说",
    expect: "狂人日記",
    textSource: { kind: "bare-han-section", prefer: "plain" },
  },
  {
    id: "yescao-gutenberg-zh",
    pg: 25242,
    lang: "zh",
    title: "野草",
    category: "中文 · 散文诗",
    expect: "野草",
    minChapters: 23,
    maxChapters: 23,
    allowProseFragmentTitles: true,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: YESCAO_TITLES,
      titleMap: YESCAO_TITLE_MAP,
    },
  },
  {
    id: "aq-zhengzhuan-gutenberg-zh",
    pg: 25332,
    lang: "zh",
    title: "阿Ｑ正傳",
    category: "中文 · 现代小说",
    expect: "阿Ｑ正傳",
    textSource: { kind: "zh-chapter", prefer: "plain" },
  },
  {
    id: "chajing-gutenberg-zh",
    pg: 23949,
    lang: "zh",
    title: "茶經",
    category: "中文 · 茶学",
    expect: "茶經",
    textSource: { kind: "numbered-zhi", prefer: "plain" },
  },
  {
    id: "jinsi-lu-gutenberg-zh",
    pg: 25249,
    lang: "zh",
    title: "近思錄",
    category: "中文 · 理学",
    expect: "近思錄",
    textSource: { kind: "book-prefixed-volume", prefer: "plain" },
  },
  {
    id: "mudanting-gutenberg-zh",
    pg: 23849,
    lang: "zh",
    title: "牡丹亭",
    category: "中文 · 戏曲",
    expect: "牡丹亭",
    minChapters: 55,
    maxChapters: 60,
    textSource: { kind: "play-act", prefer: "plain" },
    titleReplacements: [
      { from: "第三十四出 ?", to: "第三十四出 詗藥" },
      { from: "第五十二出 榜下", to: "第五十二出 索元" },
    ],
  },
  {
    id: "hongloumeng-gutenberg-zh",
    pg: 24264,
    lang: "zh",
    title: "紅樓夢",
    category: "中文 · 古典小说",
    expect: "紅樓夢",
    minChapters: 120,
    maxChapters: 130,
    textSource: { kind: "hui-clean", prefer: "plain" },
    titleReplacements: [
      {
        from: "第六十二回 憨湘云醉眠芍藥茵屆@呆香菱情解石榴裙",
        to: "第六十二回 憨湘云醉眠芍藥裀 呆香菱情解石榴裙",
      },
      {
        from: "第一零二回 宁國府骨肉病災襟腹@大觀園符水驅妖孽",
        to: "第一零二回 宁國府骨肉病災襟腹 大觀園符水驅妖孽",
      },
    ],
  },
  {
    id: "guwen-guanzhi-gutenberg-zh",
    pg: 25225,
    lang: "zh",
    title: "古文觀止",
    category: "中文 · 古文选本",
    expect: "古文觀止",
  },
  {
    id: "hanwudi-bieguo-dongmingji-gutenberg-zh",
    pg: 52271,
    lang: "zh",
    title: "漢武帝別國洞冥記",
    category: "中文 · 志怪",
    expect: "洞冥記",
    minChapters: 5,
    maxChapters: 5,
    keepLeadingTitleChapter: true,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "xiaoeerya-gutenberg-zh",
    pg: 24223,
    lang: "zh",
    title: "小爾雅",
    category: "中文 · 小学",
    expect: "小爾雅",
    minChapters: 13,
    maxChapters: 13,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "li-taibai-ji-gutenberg-zh",
    pg: 24060,
    lang: "zh",
    title: "李太白集",
    category: "中文 · 诗歌",
    expect: "李太白集",
    minChapters: 40,
    maxChapters: 45,
    textSource: {
      kind: "marked-line-sections",
      prefer: "plain",
      startPattern: "▲李白十五歲",
      headingPattern: "^▲\\s*李白",
      titlePattern: "^▲\\s*(李白[一二三四五六七八九十百]+歲)",
    },
  },
  {
    id: "piwei-lun-gutenberg-zh",
    pg: 25123,
    lang: "zh",
    title: "脾胃論",
    category: "中文 · 医学",
    expect: "脾胃論",
    minChapters: 2,
    maxChapters: 2,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: ["==大標題== 脾胃論卷上 金 真定李杲著", "==大標題== 脾胃論卷下 金 真定李杲著"],
      titleMap: {
        "==大標題== 脾胃論卷上 金 真定李杲著": "卷上",
        "==大標題== 脾胃論卷下 金 真定李杲著": "卷下",
      },
    },
  },
  {
    id: "shazi-bao-gutenberg-zh",
    pg: 27415,
    lang: "zh",
    title: "殺子報",
    category: "中文 · 古典小说",
    expect: "殺子報",
  },
  {
    id: "jiutangshu-gutenberg-zh",
    pg: 24229,
    lang: "zh",
    title: "舊唐書",
    category: "中文 · 史书",
    expect: "舊唐書",
  },
  {
    id: "yuezhang-ji-gutenberg-zh",
    pg: 25228,
    lang: "zh",
    title: "樂章集",
    category: "中文 · 词集",
    expect: "樂章集",
  },
  {
    id: "zhangui-zhuan-gutenberg-zh",
    pg: 23867,
    lang: "zh",
    title: "斬鬼傳",
    category: "中文 · 神魔小说",
    expect: "斬鬼傳",
  },
  {
    id: "mengzhong-yuan-gutenberg-zh",
    pg: 23908,
    lang: "zh",
    title: "夢中緣",
    category: "中文 · 古典小说",
    expect: "夢中緣",
  },
  {
    id: "hejin-huiwen-zhuan-gutenberg-zh",
    pg: 25250,
    lang: "zh",
    title: "合錦回文傳",
    category: "中文 · 古典小说",
    expect: "合錦回文傳",
  },
  {
    id: "gengsi-bian-gutenberg-zh",
    pg: 27172,
    lang: "zh",
    title: "庚巳編",
    category: "中文 · 笔记",
    expect: "庚巳編",
  },
  {
    id: "shenyin-yu-gutenberg-zh",
    pg: 25558,
    lang: "zh",
    title: "呻吟語",
    category: "中文 · 修身",
    expect: "呻吟語",
    minChapters: 17,
    maxChapters: 17,
    textSource: { kind: "known-title-list", prefer: "plain", titles: SHENYIN_YU_TITLES },
  },
  {
    id: "cantang-wudaishi-yanyi-gutenberg-zh",
    pg: 27145,
    lang: "zh",
    title: "殘唐五代史演義傳",
    category: "中文 · 历史小说",
    expect: "殘唐五代史",
  },
  {
    id: "shuotang-gutenberg-zh",
    pg: 23824,
    lang: "zh",
    title: "說唐",
    category: "中文 · 历史小说",
    expect: "說唐",
  },
  {
    id: "datang-sanzang-qujing-shihua-gutenberg-zh",
    pg: 54784,
    lang: "zh",
    title: "大唐三藏取經詩話",
    category: "中文 · 取经故事",
    expect: "取經詩話",
    textSource: { kind: "sanzang-shihua", prefer: "plain", startPattern: "\\n口口口口口口第一\\n" },
  },
  {
    id: "chiren-shuomengji-gutenberg-zh",
    pg: 24154,
    lang: "zh",
    title: "癡人說夢記",
    category: "中文 · 近代小说",
    expect: "癡人說夢記",
  },
  {
    id: "nanqiang-beidiao-ji-gutenberg-zh",
    pg: 25346,
    lang: "zh",
    title: "南腔北調集",
    category: "中文 · 散文",
    expect: "南腔北調集",
    minChapters: 40,
    maxChapters: 60,
    allowProseFragmentTitles: true,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      ignoreRepeatedTitle: true,
      skipLinePattern: "^BB$",
      trimLineSuffixPattern: "\\s*BB$",
      titles: [
        "“非所計也”",
        "連環圖畫”辯護",
        "“論語一年”",
        "“蜜蜂”与“蜜”",
        "《木刻創作法》序",
        "《守常全集》題記",
        "《豎琴》前記",
        "《蕭伯納在上海》序",
        "《一個人的受難》序",
        "《自選集》自序",
        "《總退卻》序",
        "大家降一級試試看",
        "搗鬼心傳",
        "聲明",
        "給文學社信",
        "關于翻譯",
        "關于婦女解放",
        "關于女人",
        "火",
        "家庭為中國之基本",
        "經驗",
        "看蕭和“看蕭的人們”記",
        "論“第三种人”",
        "林克多《蘇聯聞見錄》序",
        "論“赴難”和“逃難”",
        "論翻印木刻",
        "漫与",
        "辱罵和恐嚇決不是戰斗",
        "沙",
        "世故三昧",
        "誰的矛盾",
        "談金圣歎",
        "題記",
        "听說夢",
        "為了忘卻的記念",
        "我們不再受騙了",
        "我怎么做起小說來？",
        "小品文的危机",
        "學生和玉佛",
        "諺語",
        "謠言世家",
        "由中國女人的腳",
        "又論“第三种人”",
        "真假堂吉訶德",
        "祝《濤聲》",
        "作文秘訣",
      ],
    },
  },
  {
    id: "wenzi-gutenberg-zh",
    pg: 23854,
    lang: "zh",
    title: "文子",
    category: "中文 · 道家",
    expect: "文子",
  },
  {
    id: "laoxuean-biji-gutenberg-zh",
    pg: 27122,
    lang: "zh",
    title: "老學庵筆記",
    category: "中文 · 笔记",
    expect: "老學庵筆記",
  },
  {
    id: "yingya-shenglan-gutenberg-zh",
    pg: 24144,
    lang: "zh",
    title: "瀛涯勝覽",
    category: "中文 · 地理游记",
    expect: "瀛涯勝覽",
    textSource: { kind: "short-place", prefer: "plain" },
  },
  {
    id: "hangong-qiu-gutenberg-zh",
    pg: 52199,
    lang: "zh",
    title: "漢宮秋",
    category: "中文 · 戏曲",
    expect: "漢宮秋",
    minChapters: 5,
    maxChapters: 5,
    textSource: { kind: "zaju-fold", prefer: "plain" },
  },
  {
    id: "dongjing-menghua-lu-gutenberg-zh",
    pg: 24137,
    lang: "zh",
    title: "東京夢華錄",
    category: "中文 · 笔记",
    expect: "東京夢華錄",
  },
  {
    id: "baitu-ji-gutenberg-zh",
    pg: 57238,
    lang: "zh",
    title: "白兔記",
    category: "中文 · 戏曲",
    expect: "白兔記",
    minChapters: 33,
    maxChapters: 35,
    textSource: { kind: "play-act", prefer: "plain" },
  },
  {
    id: "haoqiu-zhuan-gutenberg-zh",
    pg: 27414,
    lang: "zh",
    title: "好逑傳",
    category: "中文 · 古典小说",
    expect: "好逑傳",
  },
  {
    id: "yinshui-ci-gutenberg-zh",
    pg: 25194,
    lang: "zh",
    title: "飲水詞集",
    category: "中文 · 词集",
    expect: "飲水詞",
    minChapters: 120,
    maxChapters: 135,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "夢江南", maxChars: 12 },
  },
  {
    id: "chunliuying-gutenberg-zh",
    pg: 26922,
    lang: "zh",
    title: "春柳鶯",
    category: "中文 · 古典小说",
    expect: "春柳鶯",
  },
  {
    id: "liuyi-ci-gutenberg-zh",
    pg: 25218,
    lang: "zh",
    title: "六一詞",
    category: "中文 · 词集",
    expect: "六一詞",
    minChapters: 220,
    maxChapters: 230,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "采桑子", maxChars: 12 },
  },
  {
    id: "guitian-lu-gutenberg-zh",
    pg: 25431,
    lang: "zh",
    title: "歸田錄",
    category: "中文 · 笔记",
    expect: "歸田錄",
    minChapters: 4,
    maxChapters: 4,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: ["自序", "歸田錄卷一", "歸田錄卷二", "佚文"],
      ignoreRepeatedTitle: true,
    },
  },
  {
    id: "shubi-gutenberg-zh",
    pg: 23947,
    lang: "zh",
    title: "蜀碧",
    category: "中文 · 史料",
    expect: "蜀碧",
  },
  {
    id: "jiuweihu-gutenberg-zh",
    pg: 25134,
    lang: "zh",
    title: "九尾狐",
    category: "中文 · 近代小说",
    expect: "九尾狐",
  },
  {
    id: "nanbu-xinshu-gutenberg-zh",
    pg: 27088,
    lang: "zh",
    title: "南部新書",
    category: "中文 · 笔记",
    expect: "南部新書",
    minChapters: 10,
    maxChapters: 10,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      startPattern: "\\n甲\\n",
      titles: ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"],
    },
  },
  {
    id: "dongdu-ji-gutenberg-zh",
    pg: 24233,
    lang: "zh",
    title: "東度記",
    category: "中文 · 神魔小说",
    expect: "東度記",
  },
  {
    id: "jin-yunqiao-zhuan-gutenberg-zh",
    pg: 27107,
    lang: "zh",
    title: "金雲翹傳",
    category: "中文 · 古典小说",
    expect: "金雲翹傳",
    titleReplacements: [
      {
        from: "第五回 甘心受百忙堬r棄生死 捨不得一家人哭斷肝腸",
        to: "第五回 甘心受百忙裏猛棄生死 捨不得一家人哭斷肝腸",
      },
    ],
  },
  {
    id: "shiyi-ji-gutenberg-zh",
    pg: 56202,
    lang: "zh",
    title: "拾遺記",
    category: "中文 · 志怪",
    expect: "拾遺記",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "book-prefixed-volume", prefer: "plain", startPattern: "《拾遺記》者" },
  },
  {
    id: "fubao-xiantan-gutenberg-zh",
    pg: 25226,
    lang: "zh",
    title: "負曝閒談",
    category: "中文 · 近代小说",
    expect: "負曝閒談",
  },
  {
    id: "huanxi-yuanjia-gutenberg-zh",
    pg: 25286,
    lang: "zh",
    title: "歡喜冤家",
    category: "中文 · 话本小说",
    expect: "歡喜冤家",
    minChapters: 24,
    maxChapters: 30,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "shitou-dian-gutenberg-zh",
    pg: 25399,
    lang: "zh",
    title: "石點頭",
    category: "中文 · 话本小说",
    expect: "石點頭",
    minChapters: 14,
    maxChapters: 14,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "yanzi-jian-gutenberg-zh",
    pg: 24193,
    lang: "zh",
    title: "燕子箋",
    category: "中文 · 戏曲",
    expect: "燕子箋",
  },
  {
    id: "jiaoye-pa-gutenberg-zh",
    pg: 27148,
    lang: "zh",
    title: "蕉葉帕",
    category: "中文 · 戏曲",
    expect: "蕉葉帕",
  },
  {
    id: "shangjun-shu-gutenberg-zh",
    pg: 23833,
    lang: "zh",
    title: "商君書",
    category: "中文 · 法家",
    expect: "商君書",
  },
  {
    id: "suhua-qingtan-gutenberg-zh",
    pg: 25223,
    lang: "zh",
    title: "俗話傾談",
    category: "中文 · 粤语俗文学",
    expect: "俗話傾談",
  },
  {
    id: "shenzi-gutenberg-zh",
    pg: 25366,
    lang: "zh",
    title: "慎子",
    category: "中文 · 法家",
    expect: "慎子",
  },
  {
    id: "fusheng-liuji-gutenberg-zh",
    pg: 25192,
    lang: "zh",
    title: "浮生六記",
    category: "中文 · 散文",
    expect: "浮生六記",
  },
  {
    id: "zhenzhong-ji-gutenberg-zh",
    pg: 52238,
    lang: "zh",
    title: "枕中記",
    category: "中文 · 唐传奇",
    expect: "枕中記",
    minChapters: 3,
    maxChapters: 3,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "開元七年",
      titleSuffix: "段",
    },
  },
  {
    id: "xieduo-gutenberg-zh",
    pg: 25375,
    lang: "zh",
    title: "諧鐸",
    category: "中文 · 志怪",
    expect: "諧鐸",
  },
  {
    id: "yougui-ji-gutenberg-zh",
    pg: 26737,
    lang: "zh",
    title: "幽閨記",
    category: "中文 · 戏曲",
    expect: "幽閨記",
    minChapters: 40,
    maxChapters: 40,
    repairDuplicateActNumbers: true,
    textSource: { kind: "inline-play-act", prefer: "plain", includeEmptyActs: true },
  },
  {
    id: "simafa-gutenberg-zh",
    pg: 25167,
    lang: "zh",
    title: "司馬法",
    category: "中文 · 兵法",
    expect: "司馬法",
  },
  {
    id: "tiangong-kaiwu-gutenberg-zh",
    pg: 25273,
    lang: "zh",
    title: "天工開物",
    category: "中文 · 科技",
    expect: "天工開物",
    splitTextMarkers: [{ title: "作咸第五", marker: "甘嗜", newTitle: "甘嗜第六" }],
  },
  {
    id: "jinxiang-ting-gutenberg-zh",
    pg: 25279,
    lang: "zh",
    title: "錦香亭",
    category: "中文 · 古典小说",
    expect: "錦香亭",
  },
  {
    id: "duyang-zabian-gutenberg-zh",
    pg: 25253,
    lang: "zh",
    title: "杜陽雜編",
    category: "中文 · 笔记",
    expect: "杜陽雜編",
  },
  {
    id: "duanhong-lingyan-ji-gutenberg-zh",
    pg: 23983,
    lang: "zh",
    title: "斷鴻零雁記",
    category: "中文 · 近代小说",
    expect: "斷鴻零雁記",
  },
  {
    id: "beimeng-suoyan-gutenberg-zh",
    pg: 25173,
    lang: "zh",
    title: "北夢瑣言",
    category: "中文 · 笔记",
    expect: "北夢瑣言",
    minChapters: 240,
    maxChapters: 270,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "dongpo-zhilin-gutenberg-zh",
    pg: 24114,
    lang: "zh",
    title: "東坡志林",
    category: "中文 · 笔记",
    expect: "東坡志林",
    minChapters: 5,
    maxChapters: 5,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: ["卷一", "卷二", "卷三", "卷四", "卷五"],
    },
  },
  {
    id: "dongpo-yuefu-gutenberg-zh",
    pg: 24028,
    lang: "zh",
    title: "東坡樂府",
    category: "中文 · 词集",
    expect: "東坡樂府",
    minChapters: 3,
    maxChapters: 3,
    textSource: { kind: "book-prefixed-volume", prefer: "plain", startPattern: "卷一\\s+編年" },
  },
  {
    id: "shuidiao-getou-gutenberg-zh",
    pg: 27123,
    lang: "zh",
    title: "水調歌頭",
    category: "中文 · 词",
    expect: "水調歌頭",
    minChapters: 4,
    maxChapters: 4,
    textSource: {
      kind: "marked-line-sections",
      prefer: "plain",
      startPattern: "水調歌頭",
      headingPattern: "^水[调調]歌[头頭]$",
      skipBodyLinePattern: "^(?:水[调調]歌[头頭]|苏轼蘇軾)$",
      titleFromBodyChars: 8,
    },
  },
  {
    id: "suxun-ji-gutenberg-zh",
    pg: 25321,
    lang: "zh",
    title: "蘇洵集",
    category: "中文 · 文集",
    expect: "蘇洵集",
  },
  {
    id: "wuxiao-zhuan-gutenberg-zh",
    pg: 30544,
    lang: "zh",
    title: "五孝傳",
    category: "中文 · 伦理",
    expect: "五孝傳",
    minChapters: 5,
    maxChapters: 5,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "soushen-houji-gutenberg-zh",
    pg: 7266,
    lang: "zh",
    title: "搜神後記",
    category: "中文 · 志怪",
    expect: "搜神後記",
    textSource: { kind: "bare-volume", prefer: "plain" },
  },
  {
    id: "hongtianlei-gutenberg-zh",
    pg: 24142,
    lang: "zh",
    title: "轟天雷",
    category: "中文 · 近代小说",
    expect: "轟天雷",
  },
  {
    id: "renjian-le-gutenberg-zh",
    pg: 23878,
    lang: "zh",
    title: "人間樂",
    category: "中文 · 古典小说",
    expect: "人間樂",
  },
  {
    id: "dingqing-ren-gutenberg-zh",
    pg: 24422,
    lang: "zh",
    title: "定情人",
    category: "中文 · 古典小说",
    expect: "定情人",
  },
  {
    id: "pingshan-lengyan-gutenberg-zh",
    pg: 24224,
    lang: "zh",
    title: "平山冷燕",
    category: "中文 · 古典小说",
    expect: "平山冷燕",
  },
  {
    id: "yujiaoli-gutenberg-zh",
    pg: 23877,
    lang: "zh",
    title: "玉嬌梨",
    category: "中文 · 古典小说",
    expect: "玉嬌梨",
  },
  {
    id: "lengyan-guan-gutenberg-zh",
    pg: 24029,
    lang: "zh",
    title: "冷眼观",
    category: "中文 · 近代小说",
    expect: "冷眼观",
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "yushuangyu-gutenberg-zh",
    pg: 25636,
    lang: "zh",
    title: "玉雙魚",
    category: "中文 · 古典小说",
    expect: "玉雙魚",
  },
  {
    id: "huatuyuan-gutenberg-zh",
    pg: 26738,
    lang: "zh",
    title: "畫圖緣",
    category: "中文 · 古典小说",
    expect: "畫圖緣",
  },
  {
    id: "shangjie-xianxingji-gutenberg-zh",
    pg: 24079,
    lang: "zh",
    title: "商界現形記",
    category: "中文 · 近代小说",
    expect: "商界現形記",
  },
  {
    id: "yuchan-ji-gutenberg-zh",
    pg: 25137,
    lang: "zh",
    title: "玉蟾記",
    category: "中文 · 戏曲",
    expect: "玉蟾記",
  },
  {
    id: "fenzhuang-lou-quanzhuan-gutenberg-zh",
    pg: 26871,
    lang: "zh",
    title: "粉妝樓全傳",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    titleReplacements: [
      {
        from: "第七十二回 破長安媕野~合 入皇宮訴屈伸冤",
        to: "第七十二回 破長安裏應外合 入皇宮訴屈伸冤",
      },
    ],
  },
  {
    id: "fenzhuang-lou-1-10-gutenberg-zh",
    pg: 4572,
    lang: "zh",
    title: "粉妝樓（一至十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-11-20-gutenberg-zh",
    pg: 4573,
    lang: "zh",
    title: "粉妝樓（十一至二十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-21-30-gutenberg-zh",
    pg: 4574,
    lang: "zh",
    title: "粉妝樓（二十一至三十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-31-40-gutenberg-zh",
    pg: 4575,
    lang: "zh",
    title: "粉妝樓（三十一至四十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-41-50-gutenberg-zh",
    pg: 4576,
    lang: "zh",
    title: "粉妝樓（四十一至五十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-51-60-gutenberg-zh",
    pg: 4577,
    lang: "zh",
    title: "粉妝樓（五十一至六十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-61-70-gutenberg-zh",
    pg: 4578,
    lang: "zh",
    title: "粉妝樓（六十一至七十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "fenzhuang-lou-71-80-gutenberg-zh",
    pg: 4579,
    lang: "zh",
    title: "粉妝樓（七十一至八十回）",
    category: "中文 · 古典小说",
    expect: "粉妝樓",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "yuzhi-guanghandian-ji-gutenberg-zh",
    pg: 30465,
    lang: "zh",
    title: "御製廣寒殿記",
    category: "中文 · 辞赋",
    expect: "廣寒殿記",
    textSource: {
      kind: "single-heading",
      prefer: "plain",
      startPattern: "北京之萬歲山",
      endPattern: "紀錄彙編卷七終",
      title: "御製廣寒殿記",
    },
  },
  {
    id: "chiren-fu-gutenberg-zh",
    pg: 27184,
    lang: "zh",
    title: "癡人福",
    category: "中文 · 古典小说",
    expect: "癡人福",
  },
  {
    id: "haigong-an-gutenberg-zh",
    pg: 54494,
    lang: "zh",
    title: "海公案",
    category: "中文 · 公案小说",
    expect: "海公案",
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "gongmu-gutenberg-zh",
    pg: 25259,
    lang: "zh",
    title: "公墓",
    category: "中文 · 现代小说",
    expect: "公墓",
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: [
        "公墓",
        "自序",
        "被當作消遣品的男子",
        "蓮花落",
        "夜總會裡的五個人",
        "CRAVEN「A」",
        "夜",
        "上海的狐步舞(一個片斷)",
        "黑牡丹",
      ],
    },
  },
  {
    id: "lingli-jiguang-gutenberg-zh",
    pg: 25716,
    lang: "zh",
    title: "灵历集光",
    category: "中文 · 宗教",
    expect: "灵历集光",
    textSource: { kind: "lingli-jiguang", prefer: "plain", startPattern: "滕\\s*序" },
  },
  {
    id: "zhuangzi-de-gushi-gutenberg-zh",
    pg: 23913,
    lang: "zh",
    title: "莊子的故事",
    category: "中文 · 道家",
    expect: "莊子的故事",
    allowSparseTrailingOrdinals: true,
  },
  {
    id: "sunzi-bingfa-daojia-xinzhu-gutenberg-zh",
    pg: 7349,
    lang: "zh",
    title: "孫子兵法道家新註解",
    category: "中文 · 兵法",
    expect: "孫子兵法道家",
  },
  {
    id: "zhoubi-suanjing-gutenberg-zh",
    pg: 12408,
    lang: "zh",
    title: "周髀算經",
    category: "中文 · 算学",
    expect: "周髀算經",
    minChapters: 6,
    maxChapters: 6,
    keepLeadingTitleChapter: true,
    textSource: {
      kind: "paired-paragraphs",
      prefer: "plain",
      startPattern: "周髀算經卷上之一",
      headingPattern: "^周髀算經卷[上下]之[一二三]$",
    },
  },
  {
    id: "kongque-dongnanfei-gutenberg-zh",
    pg: 52275,
    lang: "zh",
    title: "孔雀東南飛",
    category: "中文 · 诗歌",
    expect: "孔雀東南飛",
    minChapters: 184,
    maxChapters: 185,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "漢末建安中",
      endPattern: "多謝後世人\\s+戒之慎勿忘",
      titleFromLineChars: 8,
    },
  },
  {
    id: "xiaojing-gutenberg-zh",
    pg: 24232,
    lang: "zh",
    title: "孝經",
    category: "中文 · 儒家",
    expect: "孝經",
    minChapters: 18,
    maxChapters: 18,
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "chunqiu-pei-gutenberg-zh",
    pg: 25329,
    lang: "zh",
    title: "春秋配",
    category: "中文 · 戏曲",
    expect: "春秋配",
  },
  {
    id: "erya-gutenberg-zh",
    pg: 51620,
    lang: "zh",
    title: "爾雅",
    category: "中文 · 小学",
    expect: "爾雅",
    minChapters: 19,
    maxChapters: 19,
    textSource: { kind: "known-title-list", prefer: "plain", titles: ERYA_TITLES },
  },
  {
    id: "zhushu-jinian-gutenberg-zh",
    pg: 24111,
    lang: "zh",
    title: "竹書紀年",
    category: "中文 · 史书",
    expect: "竹書紀年",
    minChapters: 5,
    maxChapters: 5,
    textSource: { kind: "dynasty-chronicle", prefer: "plain" },
  },
  {
    id: "huangdi-zhaijing-gutenberg-zh",
    pg: 27858,
    lang: "zh",
    title: "黄帝宅經",
    category: "中文 · 术数",
    expect: "黄帝宅經",
    minChapters: 3,
    maxChapters: 3,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: ["提要", "宅經卷上", "宅經卷下"],
    },
  },
  {
    id: "wenyuan-ge-siku-quanshu-gutenberg-zh",
    pg: 7221,
    lang: "zh",
    title: "文淵閣四庫全書",
    category: "中文 · 总集",
    expect: "文淵閣四庫全書",
  },
  {
    id: "bencao-beiyao-gutenberg-zh",
    pg: 26888,
    lang: "zh",
    title: "本草備要",
    category: "中文 · 医学",
    expect: "本草備要",
    minChapters: 4,
    maxChapters: 10,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: ["穀菜部", "金石水土部", "禽獸部", "鱗介魚蟲部"],
    },
  },
  {
    id: "lunheng-gutenberg-zh",
    pg: 25397,
    lang: "zh",
    title: "論衡",
    category: "中文 · 诸子",
    expect: "論衡",
    minChapters: 65,
    maxChapters: 90,
    allowSparseTrailingOrdinals: true,
    textSource: { kind: "pian-ordinal", prefer: "plain", startPattern: "王充 - 論衡" },
  },
  {
    id: "wei-zhenggong-jianlu-gutenberg-zh",
    pg: 25161,
    lang: "zh",
    title: "魏鄭公諫錄",
    category: "中文 · 史传",
    expect: "魏鄭公諫錄",
    minChapters: 120,
    maxChapters: 140,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "renjian-cihua-gutenberg-zh",
    pg: 24112,
    lang: "zh",
    title: "人間詞話",
    category: "中文 · 词话",
    expect: "人間詞話",
    minChapters: 64,
    maxChapters: 64,
    textSource: { kind: "bare-han-section", prefer: "plain", startPattern: "\\n一\\n" },
  },
  {
    id: "haiguo-chunqiu-gutenberg-zh",
    pg: 29032,
    lang: "zh",
    title: "海國春秋",
    category: "中文 · 古典小说",
    expect: "海國春秋",
  },
  {
    id: "zhuzhai-ji-gutenberg-zh",
    pg: 7220,
    lang: "zh",
    title: "竹齋集",
    category: "中文 · 文集",
    expect: "竹齋集",
  },
  {
    id: "xixiang-ji-gutenberg-zh",
    pg: 23906,
    lang: "zh",
    title: "西廂記",
    category: "中文 · 戏曲",
    expect: "西廂記",
    minChapters: 20,
    maxChapters: 24,
    textSource: { kind: "inline-stage-scene", prefer: "plain" },
  },
  {
    id: "yanyi-bian-gutenberg-zh",
    pg: 27026,
    lang: "zh",
    title: "豔異編",
    category: "中文 · 志怪",
    expect: "豔異編",
    allowSparseVolumeOrdinals: true,
  },
  {
    id: "fengan-yuhua-gutenberg-zh",
    pg: 26746,
    lang: "zh",
    title: "分甘余話",
    category: "中文 · 笔记",
    expect: "分甘余話",
  },
  {
    id: "jianxia-zhuan-gutenberg-zh",
    pg: 25214,
    lang: "zh",
    title: "劍俠傳",
    category: "中文 · 侠义",
    expect: "劍俠傳",
    minChapters: 34,
    maxChapters: 34,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "wenzhongzi-zhongshuo-gutenberg-zh",
    pg: 27291,
    lang: "zh",
    title: "文中子中說",
    category: "中文 · 儒家",
    expect: "文中子中說",
  },
  {
    id: "xunzi-jijie-gutenberg-zh",
    pg: 25314,
    lang: "zh",
    title: "荀子集解",
    category: "中文 · 儒家",
    expect: "荀子集解",
    minChapters: 32,
    maxChapters: 32,
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "chuanxi-lu-gutenberg-zh",
    pg: 25517,
    lang: "zh",
    title: "傳習錄",
    category: "中文 · 理学",
    expect: "傳習錄",
    minChapters: 20,
    maxChapters: 22,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "徐愛引言",
      maxChars: 12,
    },
  },
  {
    id: "huawai-ji-gutenberg-zh",
    pg: 25121,
    lang: "zh",
    title: "花外集",
    category: "中文 · 词集",
    expect: "花外集",
    minChapters: 59,
    maxChapters: 65,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "天香\\s+龍涎香",
      maxChars: 12,
    },
  },
  {
    id: "weilu-yehua-gutenberg-zh",
    pg: 25421,
    lang: "zh",
    title: "圍爐夜話",
    category: "中文 · 修身",
    expect: "圍爐夜話",
    minChapters: 220,
    maxChapters: 225,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "博學篤誌",
      titleSuffix: "則",
    },
  },
  {
    id: "weiliaozi-gutenberg-zh",
    pg: 7219,
    lang: "zh",
    title: "尉繚子",
    category: "中文 · 兵法",
    expect: "尉繚子",
  },
  {
    id: "mingyue-tai-gutenberg-zh",
    pg: 23843,
    lang: "zh",
    title: "明月台",
    category: "中文 · 古典小说",
    expect: "明月台",
  },
  {
    id: "yuhu-qinghua-gutenberg-zh",
    pg: 24052,
    lang: "zh",
    title: "玉壺淸話",
    category: "中文 · 笔记",
    expect: "玉壺淸話",
  },
  {
    id: "qingxiang-zaji-gutenberg-zh",
    pg: 23834,
    lang: "zh",
    title: "青箱雜記",
    category: "中文 · 笔记",
    expect: "青箱雜記",
  },
  {
    id: "haiyou-ji-gutenberg-zh",
    pg: 25243,
    lang: "zh",
    title: "海遊記",
    category: "中文 · 神魔小说",
    expect: "海遊記",
  },
  {
    id: "zhuchun-yuan-xiaoshi-gutenberg-zh",
    pg: 27328,
    lang: "zh",
    title: "駐春園小史",
    category: "中文 · 古典小说",
    expect: "駐春園小史",
  },
  {
    id: "jiuming-qiyuan-gutenberg-zh",
    pg: 25402,
    lang: "zh",
    title: "九命奇冤",
    category: "中文 · 近代小说",
    expect: "九命奇冤",
    splitTextMarkers: [
      {
        title: "第二回 廣源店股東拆股 馬鞍街星士談星",
        marker: "卻說廣東素稱繁盛之區",
        beforeTitle: "第一回 亂哄哄強盜作先聲 慢悠悠閒文標引首",
        newTitle: "第二回 廣源店股東拆股 馬鞍街星士談星",
        keepMarkerInNewChapter: true,
      },
    ],
  },
  {
    id: "qingbian-gutenberg-zh",
    pg: 24227,
    lang: "zh",
    title: "情變",
    category: "中文 · 近代小说",
    expect: "情變",
  },
  {
    id: "xiapian-qiwen-gutenberg-zh",
    pg: 27768,
    lang: "zh",
    title: "瞎騙奇聞",
    category: "中文 · 近代小说",
    expect: "瞎騙奇聞",
  },
  {
    id: "hutu-shijie-gutenberg-zh",
    pg: 23827,
    lang: "zh",
    title: "胡涂世界",
    category: "中文 · 近代小说",
    expect: "胡涂世界",
  },
  {
    id: "zhenguan-zhengyao-gutenberg-zh",
    pg: 25347,
    lang: "zh",
    title: "貞觀政要",
    category: "中文 · 史论",
    expect: "貞觀政要",
    allowSparseTrailingOrdinals: true,
  },
  {
    id: "wuse-shi-gutenberg-zh",
    pg: 29079,
    lang: "zh",
    title: "五色石",
    category: "中文 · 古典小说",
    expect: "五色石",
  },
  {
    id: "kuaishi-zhuan-gutenberg-zh",
    pg: 25237,
    lang: "zh",
    title: "快士傳",
    category: "中文 · 古典小说",
    expect: "快士傳",
  },
  {
    id: "feilong-quanzhuan-gutenberg-zh",
    pg: 25229,
    lang: "zh",
    title: "飛龍全傳",
    category: "中文 · 历史小说",
    expect: "飛龍全傳",
  },
  {
    id: "fengyue-jian-gutenberg-zh",
    pg: 25195,
    lang: "zh",
    title: "風月鑒",
    category: "中文 · 古典小说",
    expect: "風月鑒",
  },
  {
    id: "gushi-shijiushou-gutenberg-zh",
    pg: 43009,
    lang: "zh",
    title: "古詩十九首",
    category: "中文 · 诗歌",
    expect: "古詩十九首",
    minChapters: 19,
    maxChapters: 19,
    keepLeadingTitleChapter: true,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 22 },
    titleReplacements: [
      { from: "古詩十九首之十八】《客從遠方來》", to: "古詩十九首之十八《客從遠方來》" },
    ],
  },
  {
    id: "manjianghong-gutenberg-zh",
    pg: 27204,
    lang: "zh",
    title: "滿江紅",
    category: "中文 · 词",
    expect: "滿江紅",
    minChapters: 2,
    maxChapters: 2,
    textSource: {
      kind: "marked-line-sections",
      prefer: "plain",
      startPattern: "滿江紅（寫懷）",
      headingPattern: "^滿江紅",
      titlePattern: "^滿江紅（([^）]+)）",
    },
  },
  {
    id: "wanruyue-gutenberg-zh",
    pg: 27185,
    lang: "zh",
    title: "宛如約",
    category: "中文 · 古典小说",
    expect: "宛如約",
  },
  {
    id: "baduanjin-gutenberg-zh",
    pg: 25251,
    lang: "zh",
    title: "八段錦",
    category: "中文 · 养生",
    expect: "八段錦",
    minChapters: 8,
    maxChapters: 8,
    textSource: {
      kind: "paired-paragraphs",
      prefer: "plain",
      startPattern: "第一段 懲貪色",
      headingPattern: "^第[一二三四五六七八九十]+段",
    },
  },
  {
    id: "xinqiji-cixuan-gutenberg-zh",
    pg: 24733,
    lang: "zh",
    title: "辛棄疾詞選",
    category: "中文 · 词集",
    expect: "辛棄疾詞選",
    minChapters: 73,
    maxChapters: 80,
    textSource: { kind: "short-han-title", prefer: "plain", startPattern: "生查子", maxChars: 12 },
  },
  {
    id: "yeyu-qiudeng-lu-gutenberg-zh",
    pg: 25130,
    lang: "zh",
    title: "夜雨秋燈錄",
    category: "中文 · 志怪",
    expect: "夜雨秋燈錄",
    minChapters: 100,
    maxChapters: 125,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "yutai-xinyong-gutenberg-zh",
    pg: 25324,
    lang: "zh",
    title: "玉台新詠",
    category: "中文 · 诗歌",
    expect: "玉台新詠",
  },
  {
    id: "shen-jian-gutenberg-zh",
    pg: 7408,
    lang: "zh",
    title: "申鑒",
    category: "中文 · 政论",
    expect: "申鑒",
    minChapters: 5,
    maxChapters: 5,
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "guigu-siyouzhi-gutenberg-zh",
    pg: 27171,
    lang: "zh",
    title: "鬼谷四友志",
    category: "中文 · 古典小说",
    expect: "鬼谷四友志",
  },
  {
    id: "fangyan-gutenberg-zh",
    pg: 27294,
    lang: "zh",
    title: "方言",
    category: "中文 · 小学",
    expect: "方言",
    minChapters: 13,
    maxChapters: 13,
    textSource: { kind: "classic-ordinal", prefer: "plain" },
  },
  {
    id: "qiaolian-zhu-gutenberg-zh",
    pg: 25649,
    lang: "zh",
    title: "巧聯珠",
    category: "中文 · 古典小说",
    expect: "巧聯珠",
  },
  {
    id: "huanzhongyou-gutenberg-zh",
    pg: 26748,
    lang: "zh",
    title: "幻中游",
    category: "中文 · 古典小说",
    expect: "幻中游",
  },
  {
    id: "canglang-shihua-gutenberg-zh",
    pg: 25289,
    lang: "zh",
    title: "滄浪詩話",
    category: "中文 · 诗话",
    expect: "滄浪詩話",
    minChapters: 6,
    maxChapters: 6,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "fengshou-gutenberg-zh",
    pg: 25260,
    lang: "zh",
    title: "豐收",
    category: "中文 · 现代小说",
    expect: "豐收",
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      titles: ["豐收", "火", "電網外", "夜哨線", "楊七公公過年", "嚮導"],
    },
  },
  {
    id: "lanhua-meng-qizhuan-gutenberg-zh",
    pg: 25602,
    lang: "zh",
    title: "蘭花夢奇傳",
    category: "中文 · 古典小说",
    expect: "蘭花夢奇傳",
  },
  {
    id: "yinwenzi-gutenberg-zh",
    pg: 27017,
    lang: "zh",
    title: "尹文子",
    category: "中文 · 名家",
    expect: "尹文子",
    minChapters: 3,
    maxChapters: 3,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 8 },
  },
  {
    id: "guanyinzi-gutenberg-zh",
    pg: 25169,
    lang: "zh",
    title: "關尹子",
    category: "中文 · 道家",
    expect: "關尹子",
    minChapters: 9,
    maxChapters: 9,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "huangxiuqiu-gutenberg-zh",
    pg: 25147,
    lang: "zh",
    title: "黃繡球",
    category: "中文 · 近代小说",
    expect: "黃繡球",
  },
  {
    id: "linnv-yu-gutenberg-zh",
    pg: 27302,
    lang: "zh",
    title: "鄰女語",
    category: "中文 · 近代小说",
    expect: "鄰女語",
  },
  {
    id: "hepu-zhu-gutenberg-zh",
    pg: 27734,
    lang: "zh",
    title: "合浦珠",
    category: "中文 · 古典小说",
    expect: "合浦珠",
  },
  {
    id: "zhenzhu-bo-gutenberg-zh",
    pg: 26877,
    lang: "zh",
    title: "珍珠舶",
    category: "中文 · 古典小说",
    expect: "珍珠舶",
  },
  {
    id: "xu-zibuyu-gutenberg-zh",
    pg: 25315,
    lang: "zh",
    title: "續子不語",
    category: "中文 · 志怪",
    expect: "續子不語",
  },
  {
    id: "yingying-zhuan-gutenberg-zh",
    pg: 52267,
    lang: "zh",
    title: "鶯鶯傳",
    category: "中文 · 唐传奇",
    expect: "鶯鶯傳",
    minChapters: 5,
    maxChapters: 5,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "唐貞元中",
      titleSuffix: "段",
    },
  },
  {
    id: "rouputuan-gutenberg-zh",
    pg: 52205,
    lang: "zh",
    title: "肉蒲團",
    category: "中文 · 古典小说",
    expect: "肉蒲團",
  },
  {
    id: "gushi-xinduben-yi-gutenberg-zh",
    pg: 67976,
    lang: "zh",
    title: "故事新讀本 第一冊",
    category: "中文 · 读本",
    expect: "故事新讀本",
  },
  {
    id: "guose-tianxiang-gutenberg-zh",
    pg: 24156,
    lang: "zh",
    title: "國色天香",
    category: "中文 · 古典小说",
    expect: "國色天香",
  },
  {
    id: "qinglou-meng-gutenberg-zh",
    pg: 57278,
    lang: "zh",
    title: "青樓夢",
    category: "中文 · 近代小说",
    expect: "青樓夢",
    minChapters: 64,
    maxChapters: 64,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "chenlun-gutenberg-zh",
    pg: 27636,
    lang: "zh",
    title: "沉沦",
    category: "中文 · 现代小说",
    expect: "沉沦",
    textSource: {
      kind: "bare-han-section",
      prefer: "plain",
      startPattern: "他近來覺得孤冷得可憐",
      initialTitle: "一",
    },
  },
  {
    id: "ershi-lu-gutenberg-zh",
    pg: 27459,
    lang: "zh",
    title: "耳食錄",
    category: "中文 · 志怪",
    expect: "耳食錄",
  },
  {
    id: "tingshi-gutenberg-zh",
    pg: 26887,
    lang: "zh",
    title: "桯史",
    category: "中文 · 笔记",
    expect: "桯史",
    minChapters: 12,
    maxChapters: 12,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "shenlou-zhi-gutenberg-zh",
    pg: 25543,
    lang: "zh",
    title: "蜃樓志",
    category: "中文 · 古典小说",
    expect: "蜃樓志",
  },
  {
    id: "wufeng-yin-gutenberg-zh",
    pg: 25284,
    lang: "zh",
    title: "五鳳吟",
    category: "中文 · 古典小说",
    expect: "五鳳吟",
  },
  {
    id: "dangkou-zhi-gutenberg-zh",
    pg: 25350,
    lang: "zh",
    title: "蕩寇志",
    category: "中文 · 历史小说",
    expect: "蕩寇志",
  },
  {
    id: "bihai-jiyou-gutenberg-zh",
    pg: 54670,
    lang: "zh",
    title: "裨海紀遊",
    category: "中文 · 地理游记",
    expect: "裨海紀遊",
    minChapters: 3,
    maxChapters: 3,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 4 },
  },
  {
    id: "youmeng-ying-gutenberg-zh",
    pg: 25381,
    lang: "zh",
    title: "幽夢影",
    category: "中文 · 清言",
    expect: "幽夢影",
    minChapters: 200,
    maxChapters: 230,
    textSource: {
      kind: "line-sections",
      prefer: "plain",
      startPattern: "讀經宜冬",
      titleSuffix: "則",
    },
  },
  {
    id: "xihu-mengxun-gutenberg-zh",
    pg: 27165,
    lang: "zh",
    title: "西湖夢尋",
    category: "中文 · 笔记",
    expect: "西湖夢尋",
    minChapters: 80,
    maxChapters: 85,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      maxChars: 20,
      excludePattern: "^(?:今余|此予)",
    },
  },
  {
    id: "taoan-mengyi-gutenberg-zh",
    pg: 25401,
    lang: "zh",
    title: "陶庵夢憶",
    category: "中文 · 笔记",
    expect: "陶庵夢憶",
    minChapters: 100,
    maxChapters: 115,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "hedian-gutenberg-zh",
    pg: 24327,
    lang: "zh",
    title: "何典",
    category: "中文 · 讽刺小说",
    expect: "何典",
  },
  {
    id: "qijing-gutenberg-zh",
    pg: 7407,
    lang: "zh",
    title: "棋經",
    category: "中文 · 棋艺",
    expect: "棋經",
    minChapters: 15,
    maxChapters: 15,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "kuoyi-zhi-gutenberg-zh",
    pg: 27092,
    lang: "zh",
    title: "括異志",
    category: "中文 · 志怪",
    expect: "括異志",
  },
  {
    id: "dupian-xinshu-gutenberg-zh",
    pg: 24021,
    lang: "zh",
    title: "杜騙新書",
    category: "中文 · 笔记",
    expect: "杜騙新書",
    minChapters: 80,
    maxChapters: 90,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18 },
  },
  {
    id: "zhangzai-ji-gutenberg-zh",
    pg: 27263,
    lang: "zh",
    title: "張載集",
    category: "中文 · 理学",
    expect: "張載集",
    minChapters: 60,
    maxChapters: 100,
    allowSparseTrailingOrdinals: true,
    allowProseFragmentTitles: true,
    textSource: { kind: "zhangzai-headings", prefer: "plain", startPattern: "正蒙蘇昺序" },
  },
  {
    id: "shanghan-lun-gutenberg-zh",
    pg: 24272,
    lang: "zh",
    title: "傷寒論",
    category: "中文 · 医学",
    expect: "傷寒論",
  },
  {
    id: "chaoye-qianzai-gutenberg-zh",
    pg: 26997,
    lang: "zh",
    title: "朝野僉載",
    category: "中文 · 笔记",
    expect: "朝野僉載",
  },
  {
    id: "youxian-ku-gutenberg-zh",
    pg: 25231,
    lang: "zh",
    title: "遊仙窟",
    category: "中文 · 唐传奇",
    expect: "遊仙窟",
    minChapters: 3,
    maxChapters: 3,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "天授中",
      titleSuffix: "段",
    },
  },
  {
    id: "wuyue-chunqiu-gutenberg-zh",
    pg: 25131,
    lang: "zh",
    title: "吳越春秋",
    category: "中文 · 史书",
    expect: "吳越春秋",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "spaced-classic-ordinal", prefer: "plain" },
  },
  {
    id: "minghuang-zalu-gutenberg-zh",
    pg: 25125,
    lang: "zh",
    title: "明皇雜錄",
    category: "中文 · 笔记",
    expect: "明皇雜錄",
    minChapters: 3,
    maxChapters: 3,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 4 },
  },
  {
    id: "shipin-gutenberg-zh",
    pg: 25460,
    lang: "zh",
    title: "詩品",
    category: "中文 · 诗论",
    expect: "詩品",
  },
  {
    id: "zhouli-gutenberg-zh",
    pg: 25263,
    lang: "zh",
    title: "周禮",
    category: "中文 · 礼学",
    expect: "周禮",
    minChapters: 6,
    maxChapters: 6,
    textSource: { kind: "known-title-list", prefer: "plain", titles: ZHOULI_TITLES },
  },
  {
    id: "jilei-bian-gutenberg-zh",
    pg: 27398,
    lang: "zh",
    title: "雞肋編",
    category: "中文 · 笔记",
    expect: "雞肋編",
    minChapters: 3,
    maxChapters: 3,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 4 },
  },
  {
    id: "chushi-biao-gutenberg-zh",
    pg: 30460,
    lang: "zh",
    title: "出師表",
    category: "中文 · 政论",
    expect: "出師表",
    minChapters: 2,
    maxChapters: 2,
    keepLeadingTitleChapter: true,
    textSource: { kind: "known-title-list", prefer: "plain", titles: ["前出師表", "後出師表"] },
  },
  {
    id: "niulang-zhinuzhuan-gutenberg-zh",
    pg: 27217,
    lang: "zh",
    title: "牛郎織女傳",
    category: "中文 · 神话传说",
    expect: "牛郎織女",
  },
  {
    id: "zhuzi-zhijia-geyan-gutenberg-zh",
    pg: 23816,
    lang: "zh",
    title: "朱子治家格言",
    category: "中文 · 家训",
    expect: "朱子治家格言",
    minChapters: 6,
    maxChapters: 6,
    textSource: {
      kind: "paragraph-sections",
      prefer: "plain",
      startPattern: "黎明即起",
      skipParagraphPattern: "^End of Project Gutenberg",
      titleSuffix: "段",
    },
  },
  {
    id: "ouyou-zaji-gutenberg-zh",
    pg: 24110,
    lang: "zh",
    title: "歐遊雜記",
    category: "中文 · 地理游记",
    expect: "歐遊雜記",
    minChapters: 10,
    maxChapters: 10,
    textSource: { kind: "short-han-title", prefer: "plain", maxChars: 18, excludePattern: "^是我" },
  },
  {
    id: "huliyuan-quanzhuan-gutenberg-zh",
    pg: 25323,
    lang: "zh",
    title: "狐狸緣全傳",
    category: "中文 · 神魔小说",
    expect: "狐狸緣",
  },
  {
    id: "qingdai-yeji-gutenberg-zh",
    pg: 27403,
    lang: "zh",
    title: "清代野记",
    category: "中文 · 笔记",
    expect: "清代野记",
    minChapters: 9,
    maxChapters: 9,
    textSource: { kind: "numbered-volume", prefer: "plain" },
  },
  {
    id: "fengliu-wu-gutenberg-zh",
    pg: 27402,
    lang: "zh",
    title: "風流悟",
    category: "中文 · 古典小说",
    expect: "風流悟",
    minChapters: 8,
    maxChapters: 8,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "guoyu-gutenberg-zh",
    pg: 23911,
    lang: "zh",
    title: "國語",
    category: "中文 · 史书",
    expect: "國語",
  },
  {
    id: "zuozhuan-gutenberg-zh",
    pg: 24136,
    lang: "zh",
    title: "左傳",
    category: "中文 · 史书",
    expect: "左傳",
    minChapters: 254,
    maxChapters: 260,
    textSource: {
      kind: "short-han-title",
      prefer: "plain",
      startPattern: "隱公元年",
      maxChars: 12,
    },
  },
  {
    id: "doue-yuan-gutenberg-zh",
    pg: 24004,
    lang: "zh",
    title: "竇娥寃",
    category: "中文 · 杂剧",
    expect: "竇娥寃",
    minChapters: 5,
    maxChapters: 5,
    textSource: { kind: "zaju-fold", prefer: "plain" },
  },
  {
    id: "xu-xiake-youji-gutenberg-zh",
    pg: 23876,
    lang: "zh",
    title: "徐霞客遊記",
    category: "中文 · 地理游记",
    expect: "徐霞客遊記",
    minChapters: 42,
    maxChapters: 42,
    textSource: { kind: "travel-diary", prefer: "plain", startPattern: "游天台山日記" },
  },
  {
    id: "xiyouji-gutenberg-zh",
    pg: 23962,
    lang: "zh",
    title: "西遊記",
    category: "中文 · 神魔小说",
    expect: "西遊記",
  },
  {
    id: "changyan-dao-gutenberg-zh",
    pg: 24170,
    lang: "zh",
    title: "常言道",
    category: "中文 · 古典小说",
    expect: "常言道",
    minChapters: 16,
    maxChapters: 16,
    textSource: { kind: "hui-next-title-line", prefer: "plain" },
  },
  {
    id: "hanxiangzi-quanzhuan-gutenberg-zh",
    pg: 24231,
    lang: "zh",
    title: "韓湘子全傳",
    category: "中文 · 神魔小说",
    expect: "韓湘子",
  },
  {
    id: "xihu-jiahua-gutenberg-zh",
    pg: 24273,
    lang: "zh",
    title: "西湖佳話",
    category: "中文 · 话本小说",
    expect: "西湖佳話",
    minChapters: 16,
    maxChapters: 16,
    textSource: { kind: "numbered-volume", prefer: "plain" },
  },
  {
    id: "chibei-outan-gutenberg-zh",
    pg: 25162,
    lang: "zh",
    title: "池北偶談",
    category: "中文 · 笔记",
    expect: "池北偶談",
    minChapters: 26,
    maxChapters: 26,
    textSource: { kind: "numbered-volume", prefer: "plain" },
  },
  {
    id: "bu-hongloumeng-gutenberg-zh",
    pg: 25202,
    lang: "zh",
    title: "補紅樓夢",
    category: "中文 · 古典小说",
    expect: "補紅樓夢",
    minChapters: 48,
    maxChapters: 48,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "zibuyu-gutenberg-zh",
    pg: 25245,
    lang: "zh",
    title: "子不語",
    category: "中文 · 志怪",
    expect: "子不語",
  },
  {
    id: "ernv-yingxiong-zhuan-gutenberg-zh",
    pg: 25327,
    lang: "zh",
    title: "兒女英雄傳",
    category: "中文 · 侠义小说",
    expect: "兒女英雄傳",
  },
  {
    id: "shuangfeng-qiyuan-gutenberg-zh",
    pg: 25348,
    lang: "zh",
    title: "雙鳳奇緣",
    category: "中文 · 古典小说",
    expect: "雙鳳奇緣",
    minChapters: 80,
    maxChapters: 80,
    textSource: { kind: "hui", prefer: "plain" },
  },
  {
    id: "yangjiajiang-yanyi-gutenberg-zh",
    pg: 27082,
    lang: "zh",
    title: "楊家將演義",
    category: "中文 · 英雄传奇",
    expect: "楊家將",
  },
  {
    id: "guilian-meng-gutenberg-zh",
    pg: 27104,
    lang: "zh",
    title: "歸蓮夢",
    category: "中文 · 古典小说",
    expect: "歸蓮夢",
  },
  {
    id: "taiwan-waiji-gutenberg-zh",
    pg: 27218,
    lang: "zh",
    title: "臺灣外紀",
    category: "中文 · 史书",
    expect: "臺灣外紀",
  },
  {
    id: "xihai-jiyoucao-gutenberg-zh",
    pg: 54433,
    lang: "zh",
    title: "西海紀遊草",
    category: "中文 · 地理游记",
    expect: "西海紀遊草",
    minChapters: 5,
    maxChapters: 5,
    textSource: {
      kind: "known-title-list",
      prefer: "plain",
      startPattern: "西海紀遊序",
      endPattern: "藏於紐約公共圖書館的珍本照片",
      titles: [
        "西海紀遊序",
        "西海紀遊自序",
        "西海紀遊詩",
        "救回被誘潮人記",
        "〔附〕記先祖妣節孝事略",
      ],
    },
  },

  {
    id: "alice-wonderland-gutenberg-en",
    pg: 11,
    lang: "en",
    title: "Alice's Adventures in Wonderland",
    category: "English · Fiction",
    expect: "Alice",
  },
  {
    id: "pride-prejudice-gutenberg-en",
    pg: 1342,
    lang: "en",
    title: "Pride and Prejudice",
    category: "English · Fiction",
    expect: "Pride",
  },
  {
    id: "frankenstein-gutenberg-en",
    pg: 84,
    lang: "en",
    title: "Frankenstein",
    category: "English · Fiction",
    expect: "Frankenstein",
  },
  {
    id: "moby-dick-gutenberg-en",
    pg: 2701,
    lang: "en",
    title: "Moby-Dick",
    category: "English · Fiction",
    expect: "Moby",
  },
  {
    id: "dracula-gutenberg-en",
    pg: 345,
    lang: "en",
    title: "Dracula",
    category: "English · Fiction",
    expect: "Dracula",
  },
  {
    id: "sherlock-holmes-gutenberg-en",
    pg: 1661,
    lang: "en",
    title: "The Adventures of Sherlock Holmes",
    category: "English · Detective",
    expect: "Sherlock",
  },
  {
    id: "tale-two-cities-gutenberg-en",
    pg: 98,
    lang: "en",
    title: "A Tale of Two Cities",
    category: "English · Fiction",
    expect: "Cities",
  },
  {
    id: "yellow-wallpaper-gutenberg-en",
    pg: 1952,
    lang: "en",
    title: "The Yellow Wallpaper",
    category: "English · Fiction",
    expect: "Wallpaper",
  },
  {
    id: "jane-eyre-gutenberg-en",
    pg: 1260,
    lang: "en",
    title: "Jane Eyre",
    category: "English · Fiction",
    expect: "Jane",
  },
  {
    id: "huckleberry-finn-gutenberg-en",
    pg: 76,
    lang: "en",
    title: "Adventures of Huckleberry Finn",
    category: "English · Fiction",
    expect: "Huckleberry",
  },
  {
    id: "treasure-island-gutenberg-en",
    pg: 120,
    lang: "en",
    title: "Treasure Island",
    category: "English · Adventure",
    expect: "Treasure",
  },
  {
    id: "dorian-gray-gutenberg-en",
    pg: 174,
    lang: "en",
    title: "The Picture of Dorian Gray",
    category: "English · Fiction",
    expect: "Dorian",
  },
  {
    id: "time-machine-gutenberg-en",
    pg: 35,
    lang: "en",
    title: "The Time Machine",
    category: "English · Science Fiction",
    expect: "Time Machine",
  },
  {
    id: "war-worlds-gutenberg-en",
    pg: 36,
    lang: "en",
    title: "The War of the Worlds",
    category: "English · Science Fiction",
    expect: "Worlds",
  },
  {
    id: "christmas-carol-gutenberg-en",
    pg: 46,
    lang: "en",
    title: "A Christmas Carol",
    category: "English · Fiction",
    expect: "Christmas",
  },
  {
    id: "great-expectations-gutenberg-en",
    pg: 1400,
    lang: "en",
    title: "Great Expectations",
    category: "English · Fiction",
    expect: "Expectations",
  },
  {
    id: "crime-punishment-gutenberg-en",
    pg: 2554,
    lang: "en",
    title: "Crime and Punishment",
    category: "English · Fiction",
    expect: "Punishment",
  },
  {
    id: "brothers-karamazov-gutenberg-en",
    pg: 28054,
    lang: "en",
    title: "The Brothers Karamazov",
    category: "English · Fiction",
    expect: "Karamazov",
  },
  {
    id: "little-women-gutenberg-en",
    pg: 514,
    lang: "en",
    title: "Little Women",
    category: "English · Fiction",
    expect: "Little Women",
  },
  {
    id: "count-monte-cristo-gutenberg-en",
    pg: 1184,
    lang: "en",
    title: "The Count of Monte Cristo",
    category: "English · Adventure",
    expect: "Monte Cristo",
  },
  {
    id: "gulliver-travels-gutenberg-en",
    pg: 829,
    lang: "en",
    title: "Gulliver's Travels",
    category: "English · Satire",
    expect: "Gulliver",
  },
  {
    id: "tom-sawyer-gutenberg-en",
    pg: 74,
    lang: "en",
    title: "The Adventures of Tom Sawyer",
    category: "English · Fiction",
    expect: "Tom Sawyer",
  },
  {
    id: "walden-gutenberg-en",
    pg: 205,
    lang: "en",
    title: "Walden",
    category: "English · Philosophy",
    expect: "Walden",
  },
  {
    id: "prince-gutenberg-en",
    pg: 1232,
    lang: "en",
    title: "The Prince",
    category: "English · Political Philosophy",
    expect: "Prince",
  },
  {
    id: "wuthering-heights-gutenberg-en",
    pg: 768,
    lang: "en",
    title: "Wuthering Heights",
    category: "English · Fiction",
    expect: "Wuthering",
  },
  {
    id: "emma-gutenberg-en",
    pg: 158,
    lang: "en",
    title: "Emma",
    category: "English · Fiction",
    expect: "Emma",
  },
  {
    id: "sense-sensibility-gutenberg-en",
    pg: 161,
    lang: "en",
    title: "Sense and Sensibility",
    category: "English · Fiction",
    expect: "Sensibility",
  },
  {
    id: "study-scarlet-gutenberg-en",
    pg: 244,
    lang: "en",
    title: "A Study in Scarlet",
    category: "English · Detective",
    expect: "Scarlet",
  },
  {
    id: "dr-jekyll-gutenberg-en",
    pg: 43,
    lang: "en",
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    category: "English · Fiction",
    expect: "Jekyll",
  },
  {
    id: "wizard-oz-gutenberg-en",
    pg: 55,
    lang: "en",
    title: "The Wonderful Wizard of Oz",
    category: "English · Fantasy",
    expect: "Wizard",
  },
  {
    id: "dubliners-gutenberg-en",
    pg: 2814,
    lang: "en",
    title: "Dubliners",
    category: "English · Fiction",
    expect: "Dubliners",
  },
  {
    id: "leviathan-gutenberg-en",
    pg: 3207,
    lang: "en",
    title: "Leviathan",
    category: "English · Philosophy",
    expect: "Leviathan",
  },
  {
    id: "wealth-nations-gutenberg-en",
    pg: 3300,
    lang: "en",
    title: "An Inquiry into the Nature and Causes of the Wealth of Nations",
    category: "English · Economics",
    expect: "Wealth",
  },
  {
    id: "jungle-book-gutenberg-en",
    pg: 236,
    lang: "en",
    title: "The Jungle Book",
    category: "English · Fiction",
    expect: "Jungle",
  },
  {
    id: "secret-garden-gutenberg-en",
    pg: 113,
    lang: "en",
    title: "The Secret Garden",
    category: "English · Fiction",
    expect: "Secret Garden",
  },
  {
    id: "anne-green-gables-gutenberg-en",
    pg: 45,
    lang: "en",
    title: "Anne of Green Gables",
    category: "English · Fiction",
    expect: "Anne",
  },
  {
    id: "peter-pan-gutenberg-en",
    pg: 16,
    lang: "en",
    title: "Peter Pan",
    category: "English · Fiction",
    expect: "Peter Pan",
  },
  {
    id: "hamlet-gutenberg-en",
    pg: 1524,
    lang: "en",
    title: "Hamlet",
    category: "English · Drama",
    expect: "Hamlet",
  },
  {
    id: "macbeth-gutenberg-en",
    pg: 1533,
    lang: "en",
    title: "Macbeth",
    category: "English · Drama",
    expect: "Macbeth",
  },
  {
    id: "romeo-juliet-gutenberg-en",
    pg: 1513,
    lang: "en",
    title: "Romeo and Juliet",
    category: "English · Drama",
    expect: "Romeo",
  },
  {
    id: "odyssey-gutenberg-en",
    pg: 1727,
    lang: "en",
    title: "The Odyssey",
    category: "English · Epic",
    expect: "Odyssey",
  },
  {
    id: "leaves-grass-gutenberg-en",
    pg: 1322,
    lang: "en",
    title: "Leaves of Grass",
    category: "English · Poetry",
    expect: "Leaves",
  },
  {
    id: "grimms-fairy-tales-gutenberg-en",
    pg: 2591,
    lang: "en",
    title: "Grimms' Fairy Tales",
    category: "English · Folklore",
    expect: "Grimms",
  },
  {
    id: "call-wild-gutenberg-en",
    pg: 215,
    lang: "en",
    title: "The Call of the Wild",
    category: "English · Fiction",
    expect: "Call",
  },
  {
    id: "white-fang-gutenberg-en",
    pg: 910,
    lang: "en",
    title: "White Fang",
    category: "English · Fiction",
    expect: "White Fang",
  },
  {
    id: "heart-darkness-gutenberg-en",
    pg: 219,
    lang: "en",
    title: "Heart of Darkness",
    category: "English · Fiction",
    expect: "Darkness",
  },
  {
    id: "turn-screw-gutenberg-en",
    pg: 209,
    lang: "en",
    title: "The Turn of the Screw",
    category: "English · Fiction",
    expect: "Screw",
  },
  {
    id: "wind-willows-gutenberg-en",
    pg: 27805,
    lang: "en",
    title: "The Wind in the Willows",
    category: "English · Fiction",
    expect: "Willows",
  },
  {
    id: "tarzan-apes-gutenberg-en",
    pg: 78,
    lang: "en",
    title: "Tarzan of the Apes",
    category: "English · Adventure",
    expect: "Tarzan",
  },
  {
    id: "red-badge-courage-gutenberg-en",
    pg: 73,
    lang: "en",
    title: "The Red Badge of Courage",
    category: "English · Fiction",
    expect: "Courage",
  },
  {
    id: "around-world-gutenberg-en",
    pg: 103,
    lang: "en",
    title: "Around the World in Eighty Days",
    category: "English · Adventure",
    expect: "World",
  },
  {
    id: "scarlet-letter-gutenberg-en",
    pg: 33,
    lang: "en",
    title: "The Scarlet Letter",
    category: "English · Fiction",
    expect: "Scarlet Letter",
  },
  {
    id: "middlemarch-gutenberg-en",
    pg: 145,
    lang: "en",
    title: "Middlemarch",
    category: "English · Fiction",
    expect: "Middlemarch",
  },
  {
    id: "room-view-gutenberg-en",
    pg: 2641,
    lang: "en",
    title: "A Room with a View",
    category: "English · Fiction",
    expect: "Room with a View",
  },
  {
    id: "hound-baskervilles-gutenberg-en",
    pg: 2852,
    lang: "en",
    title: "The Hound of the Baskervilles",
    category: "English · Detective",
    expect: "Baskervilles",
  },
  {
    id: "sign-four-gutenberg-en",
    pg: 2097,
    lang: "en",
    title: "The Sign of the Four",
    category: "English · Detective",
    expect: "Sign of the Four",
  },
  {
    id: "souls-black-folk-gutenberg-en",
    pg: 408,
    lang: "en",
    title: "The Souls of Black Folk",
    category: "English · Essays",
    expect: "Souls",
  },
  {
    id: "narrative-douglass-gutenberg-en",
    pg: 23,
    lang: "en",
    title: "Narrative of the Life of Frederick Douglass",
    category: "English · Memoir",
    expect: "Douglass",
  },
  {
    id: "paradise-lost-gutenberg-en",
    pg: 20,
    lang: "en",
    title: "Paradise Lost",
    category: "English · Epic Poetry",
    expect: "Paradise Lost",
  },
  {
    id: "federalist-papers-gutenberg-en",
    pg: 18,
    lang: "en",
    title: "The Federalist Papers",
    category: "English · Political Essays",
    expect: "Federalist",
  },
  {
    id: "utopia-gutenberg-en",
    pg: 2130,
    lang: "en",
    title: "Utopia",
    category: "English · Political Philosophy",
    expect: "Utopia",
  },
  {
    id: "importance-earnest-gutenberg-en",
    pg: 844,
    lang: "en",
    title: "The Importance of Being Earnest",
    category: "English · Drama",
    expect: "Earnest",
  },
  {
    id: "doll-house-gutenberg-en",
    pg: 2542,
    lang: "en",
    title: "A Doll's House",
    category: "English · Drama",
    expect: "Doll",
  },
  {
    id: "pygmalion-gutenberg-en",
    pg: 3825,
    lang: "en",
    title: "Pygmalion",
    category: "English · Drama",
    expect: "Pygmalion",
  },
  {
    id: "don-quixote-en-gutenberg-en",
    pg: 996,
    lang: "en",
    title: "Don Quixote",
    category: "English · Fiction",
    expect: "Quixote",
  },
  {
    id: "siddhartha-gutenberg-en",
    pg: 2500,
    lang: "en",
    title: "Siddhartha",
    category: "English · Fiction",
    expect: "Siddhartha",
  },
  {
    id: "art-of-war-gutenberg",
    pg: 132,
    lang: "en",
    title: "The Art of War",
    category: "English · Strategy",
    expect: "Art of War",
  },
  {
    id: "blue-castle-gutenberg-en",
    pg: 67979,
    lang: "en",
    title: "The Blue Castle",
    category: "English · Fiction",
    expect: "Blue Castle",
    skipTitles: ["L. M. MONTGOMERY"],
  },
  {
    id: "king-in-yellow-gutenberg-en",
    pg: 8492,
    lang: "en",
    title: "The King in Yellow",
    category: "English · Horror",
    expect: "King in Yellow",
  },
  {
    id: "great-gatsby-gutenberg-en",
    pg: 64317,
    lang: "en",
    title: "The Great Gatsby",
    category: "English · Fiction",
    expect: "Gatsby",
  },
  {
    id: "enchanted-april-gutenberg-en",
    pg: 16389,
    lang: "en",
    title: "The Enchanted April",
    category: "English · Fiction",
    expect: "Enchanted April",
  },
  {
    id: "ferdinand-count-fathom-gutenberg-en",
    pg: 6761,
    lang: "en",
    title: "The Adventures of Ferdinand Count Fathom",
    category: "English · Fiction",
    expect: "Ferdinand Count Fathom",
  },
  // Gutenberg #1259, #1497, #1998, #2680, and #45304 have public-domain
  // metadata, but their EPUB TOCs duplicate body anchors, split notes into
  // chapters, or use prose fragments as headings. Keep them out until we import
  // cleaner sources.

  {
    id: "madame-bovary-gutenberg-fr",
    pg: 14155,
    lang: "fr",
    title: "Madame Bovary",
    category: "Français · Roman",
    expect: "Bovary",
  },
  {
    id: "candide-gutenberg-fr",
    pg: 4650,
    lang: "fr",
    title: "Candide",
    category: "Français · Conte philosophique",
    expect: "Candide",
  },
  {
    id: "rouge-et-noir-gutenberg-fr",
    pg: 798,
    lang: "fr",
    title: "Le rouge et le noir",
    category: "Français · Roman",
    expect: "rouge",
  },
  {
    id: "trois-mousquetaires-gutenberg-fr",
    pg: 13951,
    lang: "fr",
    title: "Les trois mousquetaires",
    category: "Français · Roman",
    expect: "mousquetaires",
  },
  {
    id: "fleurs-du-mal-gutenberg-fr",
    pg: 6099,
    lang: "fr",
    title: "Les Fleurs du Mal",
    category: "Français · Poésie",
    expect: "Fleurs",
    mergeAsSingleChapter: true,
  },
  {
    id: "swann-gutenberg-fr",
    pg: 2650,
    lang: "fr",
    title: "Du côté de chez Swann",
    category: "Français · Roman",
    expect: "Swann",
  },
  {
    id: "les-miserables-fantine-gutenberg-fr",
    pg: 17489,
    lang: "fr",
    title: "Les misérables Tome I: Fantine",
    category: "Français · Roman",
    expect: "Fantine",
  },
  {
    id: "notre-dame-paris-gutenberg-fr",
    pg: 70891,
    lang: "fr",
    title: "Notre-Dame de Paris - Tome 1",
    category: "Français · Roman",
    expect: "Notre-Dame",
  },
  {
    id: "journey-center-earth-gutenberg-fr",
    pg: 4791,
    lang: "fr",
    title: "Voyage au Centre de la Terre",
    category: "Français · Aventure",
    expect: "Terre",
  },
  {
    id: "monte-cristo-tome1-gutenberg-fr",
    pg: 17989,
    lang: "fr",
    title: "Le comte de Monte-Cristo, Tome I",
    category: "Français · Aventure",
    expect: "Monte-Cristo",
  },
  {
    id: "fantome-opera-gutenberg-fr",
    pg: 62215,
    lang: "fr",
    title: "Le Fantôme de l'Opéra",
    category: "Français · Roman",
    expect: "Fantôme",
  },
  {
    id: "arsene-lupin-gutenberg-fr",
    pg: 32854,
    lang: "fr",
    title: "Arsène Lupin, gentleman-cambrioleur",
    category: "Français · Policier",
    expect: "Lupin",
  },
  {
    id: "ile-mysterieuse-gutenberg-fr",
    pg: 14287,
    lang: "fr",
    title: "L'île mystérieuse",
    category: "Français · Aventure",
    expect: "mystérieuse",
  },
  {
    id: "romeo-juliette-gutenberg-fr",
    pg: 18143,
    lang: "fr",
    title: "Roméo et Juliette",
    category: "Français · Théâtre",
    expect: "Juliette",
  },
  {
    id: "memoires-outre-tombe-t4-gutenberg-fr",
    pg: 25575,
    lang: "fr",
    title: "Mémoires d'Outre-Tombe, Tome 4",
    category: "Français · Mémoires",
    expect: "Outre-Tombe",
  },

  {
    id: "faust-i-gutenberg-de",
    pg: 2229,
    lang: "de",
    title: "Faust I",
    category: "Deutsch · Drama",
    expect: "Faust",
  },
  {
    id: "faust-ii-gutenberg-de",
    pg: 2230,
    lang: "de",
    title: "Faust II",
    category: "Deutsch · Drama",
    expect: "Faust",
  },
  {
    id: "verwandlung-gutenberg-de",
    pg: 22367,
    lang: "de",
    title: "Die Verwandlung",
    category: "Deutsch · Erzählung",
    expect: "Verwandlung",
  },
  {
    id: "zarathustra-gutenberg-de",
    pg: 7205,
    lang: "de",
    title: "Also sprach Zarathustra",
    category: "Deutsch · Philosophie",
    expect: "Zarathustra",
  },
  {
    id: "immensee-gutenberg-de",
    pg: 6651,
    lang: "de",
    title: "Immensee",
    category: "Deutsch · Novelle",
    expect: "Immensee",
  },
  {
    id: "werther-1-gutenberg-de",
    pg: 2407,
    lang: "de",
    title: "Die Leiden des jungen Werther — Band 1",
    category: "Deutsch · Roman",
    expect: "Werther",
  },
  {
    id: "werther-2-gutenberg-de",
    pg: 2408,
    lang: "de",
    title: "Die Leiden des jungen Werther — Band 2",
    category: "Deutsch · Roman",
    expect: "Werther",
  },
  {
    id: "taugenichts-gutenberg-de",
    pg: 35312,
    lang: "de",
    title: "Aus dem Leben eines Taugenichts",
    category: "Deutsch · Novelle",
    expect: "Taugenichts",
    mergeAsSingleChapter: true,
  },
  {
    id: "traumdeutung-gutenberg-de",
    pg: 40739,
    lang: "de",
    title: "Die Traumdeutung",
    category: "Deutsch · Psychologie",
    expect: "Traumdeutung",
  },
  {
    id: "gogol-dramatische-werke-gutenberg-de",
    pg: 55487,
    lang: "de",
    title: "Sämmtliche Werke 5: Dramatische Werke",
    category: "Deutsch · Drama",
    expect: "Gogol",
  },
  {
    id: "mabuse-gutenberg-de",
    pg: 50285,
    lang: "de",
    title: "Dr. Mabuse, der Spieler",
    category: "Deutsch · Roman",
    expect: "Mabuse",
  },
  {
    id: "buddenbrooks-gutenberg-de",
    pg: 34811,
    lang: "de",
    title: "Buddenbrooks",
    category: "Deutsch · Roman",
    expect: "Buddenbrooks",
  },

  {
    id: "divina-commedia-gutenberg-it",
    pg: 1000,
    lang: "it",
    title: "La Divina Commedia",
    category: "Italiano · Poesia",
    expect: "Commedia",
  },
  {
    id: "pinocchio-gutenberg-it",
    pg: 52484,
    lang: "it",
    title: "Le avventure di Pinocchio",
    category: "Italiano · Narrativa",
    expect: "Pinocchio",
  },
  {
    id: "promessi-sposi-gutenberg-it",
    pg: 45334,
    lang: "it",
    title: "I promessi sposi",
    category: "Italiano · Romanzo",
    expect: "Promessi",
  },
  {
    id: "orlando-furioso-gutenberg-it",
    pg: 3747,
    lang: "it",
    title: "Orlando Furioso",
    category: "Italiano · Poema",
    expect: "Orlando",
  },
  {
    id: "divina-dottrina-gutenberg-it",
    pg: 26961,
    lang: "it",
    title: "Libro della divina dottrina",
    category: "Italiano · Mistica",
    expect: "divina dottrina",
    mergeAsSingleChapter: true,
  },
  {
    id: "demagoghi-gutenberg-it",
    pg: 22026,
    lang: "it",
    title: "I demagoghi",
    category: "Italiano · Romanzo",
    expect: "demagoghi",
    mergeAsSingleChapter: true,
  },
  {
    id: "damiano-gutenberg-it",
    pg: 25178,
    lang: "it",
    title: "Damiano",
    category: "Italiano · Romanzo",
    expect: "Damiano",
  },
  {
    id: "carita-prossimo-gutenberg-it",
    pg: 25179,
    lang: "it",
    title: "La carità del prossimo",
    category: "Italiano · Romanzo",
    expect: "prossimo",
    mergeAsSingleChapter: true,
  },
  {
    id: "favorita-mahdi-gutenberg-it",
    pg: 25180,
    lang: "it",
    title: "La favorita del Mahdi",
    category: "Italiano · Avventura",
    expect: "Mahdi",
    mergeAsSingleChapter: true,
  },

  {
    id: "don-quijote-gutenberg-es",
    pg: 2000,
    lang: "es",
    title: "Don Quijote",
    category: "Español · Novela",
    expect: "Quijote",
  },
  // Gutenberg #1619 La Celestina currently reports "Copyrighted"; keep it out
  // of publish candidates until a public-domain source is verified.
  {
    id: "lazarillo-gutenberg-es",
    pg: 320,
    lang: "es",
    title: "Lazarillo de Tormes",
    category: "Español · Novela",
    expect: "Lazarillo",
  },
  {
    id: "crimen-castigo-gutenberg-es",
    pg: 61851,
    lang: "es",
    title: "El crimen y el castigo",
    category: "Español · Novela",
    expect: "castigo",
  },
  {
    id: "argonautas-gutenberg-es",
    pg: 25640,
    lang: "es",
    title: "Los argonautas",
    category: "Español · Novela",
    expect: "argonautas",
  },
  {
    id: "odisea-gutenberg-es",
    pg: 58221,
    lang: "es",
    title: "La Odisea",
    category: "Español · Épica",
    expect: "Odisea",
  },
  {
    id: "spanish-american-reader-gutenberg-es",
    pg: 39647,
    lang: "es",
    title: "The Spanish American Reader",
    category: "Español · Lecturas",
    expect: "Spanish American",
  },
  {
    id: "historia-literatura-dramatico-gutenberg-es",
    pg: 25988,
    lang: "es",
    title: "Historia de la literatura y del arte dramático en España, tomo II",
    category: "Español · Historia literaria",
    expect: "literatura",
  },
  {
    id: "el-mar-gutenberg-es",
    pg: 26284,
    lang: "es",
    title: "El Mar",
    category: "Español · Ciencia natural",
    expect: "El Mar",
  },
  {
    id: "jose-gutenberg-es",
    pg: 27738,
    lang: "es",
    title: "José",
    category: "Español · Lecturas",
    expect: "José",
  },
  {
    id: "quilito-gutenberg-es",
    pg: 23035,
    lang: "es",
    title: "Quilito",
    category: "Español · Novela",
    expect: "Quilito",
  },

  {
    id: "dom-casmurro-gutenberg-pt",
    pg: 55752,
    lang: "pt",
    title: "Dom Casmurro",
    category: "Português · Romance",
    expect: "Casmurro",
  },
  {
    id: "bras-cubas-gutenberg-pt",
    pg: 54829,
    lang: "pt",
    title: "Memórias Póstumas de Brás Cubas",
    category: "Português · Romance",
    expect: "Braz",
  },
  {
    id: "quincas-borba-gutenberg-pt",
    pg: 55682,
    lang: "pt",
    title: "Quincas Borba",
    category: "Português · Romance",
    expect: "Quincas",
  },
  {
    id: "minas-salomao-gutenberg-pt",
    pg: 22015,
    lang: "pt",
    title: "As Minas de Salomão",
    category: "Português · Aventura",
    expect: "Salomão",
  },
  {
    id: "iracema-gutenberg-pt",
    pg: 67740,
    lang: "pt",
    title: "Iracema",
    category: "Português · Romance",
    expect: "Iracema",
  },
  {
    id: "viagens-minha-terra-gutenberg-pt",
    pg: 24401,
    lang: "pt",
    title: "Viagens na Minha Terra",
    category: "Português · Romance",
    expect: "Viagens",
    mergeAsSingleChapter: true,
  },
  {
    id: "cinco-minutos-gutenberg-pt",
    pg: 44540,
    lang: "pt",
    title: "Cinco minutos",
    category: "Português · Romance",
    expect: "Cinco minutos",
  },
  {
    id: "pata-gazella-gutenberg-pt",
    pg: 67831,
    lang: "pt",
    title: "A Pata da Gazella",
    category: "Português · Romance",
    expect: "Gazella",
  },
  {
    id: "ubirajara-gutenberg-pt",
    pg: 38496,
    lang: "pt",
    title: "Ubirajara",
    category: "Português · Lenda",
    expect: "Ubirajara",
  },
  {
    id: "frei-luiz-sousa-gutenberg-pt",
    pg: 17591,
    lang: "pt",
    title: "Frei Luiz de Sousa",
    category: "Português · Drama",
    expect: "Frei Luiz",
  },
  {
    id: "illustre-casa-ramires-gutenberg-pt",
    pg: 23145,
    lang: "pt",
    title: "A Illustre Casa de Ramires",
    category: "Português · Romance",
    expect: "Ramires",
  },
  {
    id: "viriatho-gutenberg-pt",
    pg: 26850,
    lang: "pt",
    title: "Viriatho",
    category: "Português · Romance histórico",
    expect: "Viriatho",
  },
  {
    id: "poesias-herculano-gutenberg-pt",
    pg: 25925,
    lang: "pt",
    title: "Poesias",
    category: "Português · Poesia",
    expect: "Poesias",
  },
  {
    id: "four-plays-gil-vicente-gutenberg-pt",
    pg: 28399,
    lang: "pt",
    title: "Four Plays of Gil Vicente",
    category: "Português · Teatro",
    expect: "Vicente",
  },

  {
    id: "max-havelaar-gutenberg-nl",
    pg: 11024,
    lang: "nl",
    title: "Max Havelaar",
    category: "Nederlands · Roman",
    expect: "Havelaar",
    mergeAsSingleChapter: true,
  },
  {
    id: "onder-moeders-vleugels-gutenberg-nl",
    pg: 17337,
    lang: "nl",
    title: "Onder Moeders Vleugels",
    category: "Nederlands · Roman",
    expect: "Moeders",
    mergeAsSingleChapter: true,
  },
  {
    id: "prometheus-geboeid-gutenberg-nl",
    pg: 57697,
    lang: "nl",
    title: "Prometheus Geboeid",
    category: "Nederlands · Drama",
    expect: "Prometheus",
    mergeAsSingleChapter: true,
  },
  {
    id: "nederlandsche-volkskunde-gutenberg-nl",
    pg: 22968,
    lang: "nl",
    title: "Nederlandsche Volkskunde",
    category: "Nederlands · Volkskunde",
    expect: "Volkskunde",
  },
  {
    id: "gevoel-en-verstand-gutenberg-nl",
    pg: 25946,
    lang: "nl",
    title: "Gevoel en verstand",
    category: "Nederlands · Roman",
    expect: "verstand",
  },
  {
    id: "noli-me-tangere-gutenberg-nl",
    pg: 21848,
    lang: "nl",
    title: "Noli me tangere",
    category: "Nederlands · Roman",
    expect: "Noli",
    mergeAsSingleChapter: true,
  },
  {
    id: "andersens-sproken-gutenberg-nl",
    pg: 25580,
    lang: "nl",
    title: "Andersens Sproken en vertellingen",
    category: "Nederlands · Sprookjes",
    expect: "Andersens",
  },
  {
    id: "egyptische-koningsdochter-gutenberg-nl",
    pg: 28120,
    lang: "nl",
    title: "Eene Egyptische Koningsdochter",
    category: "Nederlands · Historische roman",
    expect: "Koningsdochter",
  },
  {
    id: "dokter-helmond-gutenberg-nl",
    pg: 25138,
    lang: "nl",
    title: "Dokter Helmond en zijn vrouw",
    category: "Nederlands · Roman",
    expect: "Helmond",
  },
  {
    id: "ivanhoe-gutenberg-nl",
    pg: 26564,
    lang: "nl",
    title: "Ivanhoe",
    category: "Nederlands · Historische roman",
    expect: "Ivanhoe",
  },
  {
    id: "betuwsche-novellen-gutenberg-nl",
    pg: 26483,
    lang: "nl",
    title: "Betuwsche novellen",
    category: "Nederlands · Novellen",
    expect: "Betuwsche",
  },
  {
    id: "kalevala-gutenberg-fi",
    pg: 7000,
    lang: "fi",
    title: "Kalevala",
    category: "Suomi · Eepos",
    expect: "Kalevala",
  },
  {
    id: "agamemnon-gutenberg-fi",
    pg: 53137,
    lang: "fi",
    title: "Agamemnon",
    category: "Suomi · Draama",
    expect: "Agamemnon",
    mergeAsSingleChapter: true,
  },
  {
    id: "aisopoksen-satuja-gutenberg-fi",
    pg: 74326,
    lang: "fi",
    title: "Aisopoksen satuja",
    category: "Suomi · Sadut",
    expect: "Aisopoksen",
  },
  {
    id: "kavaluus-rakkaus-gutenberg-fi",
    pg: 49552,
    lang: "fi",
    title: "Kavaluus ja rakkaus",
    category: "Suomi · Draama",
    expect: "Kavaluus",
    mergeAsSingleChapter: true,
  },
  {
    id: "rautakorko-gutenberg-fi",
    pg: 24848,
    lang: "fi",
    title: "Rautakorko",
    category: "Suomi · Romaani",
    expect: "Rautakorko",
    mergeAsSingleChapter: true,
  },
  {
    id: "ihmisvihaaja-gutenberg-fi",
    pg: 78042,
    lang: "fi",
    title: "Ihmisvihaaja",
    category: "Suomi · Draama",
    expect: "Ihmisvihaaja",
  },
  {
    id: "huligaani-gutenberg-fi",
    pg: 78081,
    lang: "fi",
    title: "Huligaani",
    category: "Suomi · Novellit",
    expect: "Huligaani",
  },
  {
    id: "sointula-gutenberg-fi",
    pg: 78049,
    lang: "fi",
    title: "Sointula",
    category: "Suomi · Draama",
    expect: "Sointula",
    mergeAsSingleChapter: true,
  },
  {
    id: "karavaani-gutenberg-fi",
    pg: 78018,
    lang: "fi",
    title: "Karavaani ja muita juttuja",
    category: "Suomi · Novellit",
    expect: "Karavaani",
  },
  {
    id: "terveeks-buddha-gutenberg-fi",
    pg: 76730,
    lang: "fi",
    title: "Terveeks' — Buddha!",
    category: "Suomi · Matkakertomus",
    expect: "Buddha",
  },
  {
    id: "hauska-tutustua-gutenberg-fi",
    pg: 78008,
    lang: "fi",
    title: "Hauska tutustua!",
    category: "Suomi · Kertomukset",
    expect: "Hauska",
  },
  {
    id: "velisurmaaja-gutenberg-fi",
    pg: 78070,
    lang: "fi",
    title: "Velisurmaaja",
    category: "Suomi · Draama",
    expect: "Velisurmaaja",
  },
  {
    id: "lintukoto-gutenberg-fi",
    pg: 78058,
    lang: "fi",
    title: "Lintukoto",
    category: "Suomi · Kertomukset",
    expect: "Lintukoto",
  },
  {
    id: "roda-rummet-gutenberg-sv",
    pg: 57052,
    lang: "sv",
    title: "Röda rummet",
    category: "Svenska · Roman",
    expect: "Röda",
    mergeAsSingleChapter: true,
  },
  {
    id: "hemsoborna-gutenberg-sv",
    pg: 30078,
    lang: "sv",
    title: "Hemsöborna",
    category: "Svenska · Roman",
    expect: "Hemsöborna",
    mergeAsSingleChapter: true,
  },
  {
    id: "det-gar-an-gutenberg-sv",
    pg: 14670,
    lang: "sv",
    title: "Det går an",
    category: "Svenska · Roman",
    expect: "Det går an",
  },
  {
    id: "kalevala-sv-gutenberg-sv",
    pg: 56421,
    lang: "sv",
    title: "Kalevala",
    category: "Svenska · Epos",
    expect: "Kalevala",
    mergeAsSingleChapter: true,
  },
  {
    id: "teckningar-drommar-gutenberg-sv",
    pg: 27875,
    lang: "sv",
    title: "Teckningar och drömmar",
    category: "Svenska · Noveller",
    expect: "Teckningar",
    mergeAsSingleChapter: true,
  },
  {
    id: "utvecklingstid-gutenberg-sv",
    pg: 26479,
    lang: "sv",
    title: "I Utvecklingstid",
    category: "Svenska · Ungdom",
    expect: "Utvecklingstid",
  },
  {
    id: "carl-svenske-gutenberg-sv",
    pg: 65580,
    lang: "sv",
    title: "Carl Svenske",
    category: "Svenska · Historisk roman",
    expect: "Carl Svenske",
  },
  {
    id: "katornas-folk-gutenberg-sv",
    pg: 62806,
    lang: "sv",
    title: "Kåtornas folk",
    category: "Svenska · Resa",
    expect: "Kåtornas",
    mergeAsSingleChapter: true,
  },
  {
    id: "i-marginalen-gutenberg-sv",
    pg: 26347,
    lang: "sv",
    title: "I marginalen",
    category: "Svenska · Essäer",
    expect: "marginalen",
  },
  {
    id: "moloks-leende-gutenberg-sv",
    pg: 62635,
    lang: "sv",
    title: "Moloks leende",
    category: "Svenska · Roman",
    expect: "Moloks",
    mergeAsSingleChapter: true,
  },
  {
    id: "den-ljusa-skalpen-gutenberg-sv",
    pg: 63403,
    lang: "sv",
    title: "Den ljusa skalpen",
    category: "Svenska · Noveller",
    expect: "skalpen",
  },
  {
    id: "drottning-moi-meme-gutenberg-sv",
    pg: 59921,
    lang: "sv",
    title: "Drottning Moi-Même",
    category: "Svenska · Historisk roman",
    expect: "Moi",
  },
  {
    id: "adelt-vildt-gutenberg-sv",
    pg: 59341,
    lang: "sv",
    title: "Ädelt vildt",
    category: "Svenska · Roman",
    expect: "vildt",
  },
  {
    id: "en-piga-bland-pigor-gutenberg-sv",
    pg: 48961,
    lang: "sv",
    title: "En piga bland pigor",
    category: "Svenska · Reportage",
    expect: "piga",
  },
  {
    id: "vildanden-gutenberg-no",
    pg: 13041,
    lang: "no",
    title: "Vildanden",
    category: "Norsk · Drama",
    expect: "Vildanden",
    mergeAsSingleChapter: true,
  },
  {
    id: "sult-gutenberg-no",
    pg: 30027,
    lang: "no",
    title: "Sult",
    category: "Norsk · Roman",
    expect: "Sult",
    mergeAsSingleChapter: true,
  },
  {
    id: "markens-grode-1-gutenberg-no",
    pg: 43724,
    lang: "no",
    title: "Markens grøde, Første del",
    category: "Norsk · Roman",
    expect: "Markens",
    mergeAsSingleChapter: true,
  },
  {
    id: "markens-grode-2-gutenberg-no",
    pg: 43725,
    lang: "no",
    title: "Markens grøde, Anden del",
    category: "Norsk · Roman",
    expect: "Markens",
    mergeAsSingleChapter: true,
  },
  {
    id: "catilina-gutenberg-no",
    pg: 16665,
    lang: "no",
    title: "Catilina",
    category: "Norsk · Drama",
    expect: "Catilina",
  },
  {
    id: "fru-inger-gutenberg-no",
    pg: 15669,
    lang: "no",
    title: "Fru Inger til Østråt",
    category: "Norsk · Drama",
    expect: "Fru Inger",
    mergeAsSingleChapter: true,
  },
  {
    id: "haermaendene-helgeland-gutenberg-no",
    pg: 14686,
    lang: "no",
    title: "Hærmændene på Helgeland",
    category: "Norsk · Drama",
    expect: "Helgeland",
    mergeAsSingleChapter: true,
  },
  {
    id: "kaerlighedens-komedie-gutenberg-no",
    pg: 15748,
    lang: "no",
    title: "Kærlighedens Komedie",
    category: "Norsk · Drama",
    expect: "Kærlighedens",
  },
  {
    id: "gildet-solhaug-gutenberg-no",
    pg: 15291,
    lang: "no",
    title: "Gildet på Solhaug",
    category: "Norsk · Drama",
    expect: "Solhaug",
    mergeAsSingleChapter: true,
  },
  {
    id: "baron-munchhausen-gutenberg-no",
    pg: 63200,
    lang: "no",
    title: "Baron von Münchhausens merkværdige reiser og eventyr",
    category: "Norsk · Eventyr",
    expect: "Münchhausen",
    mergeAsSingleChapter: true,
  },
  {
    id: "onkel-toms-hytte-gutenberg-no",
    pg: 56863,
    lang: "no",
    title: "Onkel Toms Hytte",
    category: "Norsk · Roman",
    expect: "Toms",
    mergeAsSingleChapter: true,
  },
  {
    id: "pelle-erobreren-1-gutenberg-da",
    pg: 76563,
    lang: "da",
    title: "Pelle Erobreren 1: Barndom",
    category: "Dansk · Roman",
    expect: "Pelle",
    mergeAsSingleChapter: true,
  },
  {
    id: "pelle-erobreren-2-gutenberg-da",
    pg: 76723,
    lang: "da",
    title: "Pelle Erobreren 2: Læreaar",
    category: "Dansk · Roman",
    expect: "Pelle",
    mergeAsSingleChapter: true,
  },
  {
    id: "pelle-erobreren-3-gutenberg-da",
    pg: 76883,
    lang: "da",
    title: "Pelle Erobreren 3: Den store Kamp",
    category: "Dansk · Roman",
    expect: "Pelle",
    mergeAsSingleChapter: true,
  },
  {
    id: "pelle-erobreren-4-gutenberg-da",
    pg: 77037,
    lang: "da",
    title: "Pelle Erobreren 4: Gryet",
    category: "Dansk · Roman",
    expect: "Pelle",
    mergeAsSingleChapter: true,
  },
  {
    id: "tine-gutenberg-da",
    pg: 10686,
    lang: "da",
    title: "Tine",
    category: "Dansk · Roman",
    expect: "Tine",
    mergeAsSingleChapter: true,
  },
  {
    id: "ved-vejen-gutenberg-da",
    pg: 13175,
    lang: "da",
    title: "Ved Vejen",
    category: "Dansk · Roman",
    expect: "Ved Vejen",
    mergeAsSingleChapter: true,
  },
  {
    id: "kongens-fald-gutenberg-da",
    pg: 36942,
    lang: "da",
    title: "Kongens Fald",
    category: "Dansk · Roman",
    expect: "Kongens Fald",
    mergeAsSingleChapter: true,
  },
  {
    id: "bjorneaet-gutenberg-da",
    pg: 43781,
    lang: "da",
    title: "Bjørneæt",
    category: "Dansk · Historisk roman",
    expect: "Bjørneæt",
    mergeAsSingleChapter: true,
  },

  {
    id: "rashomon-gutenberg-ja",
    pg: 1982,
    lang: "ja",
    title: "羅生門",
    category: "日本語 · 小説",
    expect: "羅生門",
  },
  {
    id: "kesshoki-gutenberg-ja",
    pg: 34013,
    lang: "ja",
    title: "血笑記",
    category: "日本語 · 翻訳小説",
    expect: "血笑記",
    mergeAsSingleChapter: true,
  },
  {
    id: "kumogata-monsho-gutenberg-ja",
    pg: 35018,
    lang: "ja",
    title: "雲形紋章",
    category: "日本語 · 小説",
    expect: "雲形紋章",
  },
  {
    id: "irekawatta-otoko-gutenberg-ja",
    pg: 34158,
    lang: "ja",
    title: "入れかわった男",
    category: "日本語 · 小説",
    expect: "入れかわった男",
  },
  {
    id: "shisei-gutenberg-ja",
    pg: 31617,
    lang: "ja",
    title: "刺青",
    category: "日本語 · 小説",
    expect: "刺",
  },
  {
    id: "atsumono-gutenberg-ja",
    pg: 36459,
    lang: "ja",
    title: "羹",
    category: "日本語 · 小説",
    expect: "羹",
  },
  {
    id: "america-monogatari-gutenberg-ja",
    pg: 35327,
    lang: "ja",
    title: "あめりか物語",
    category: "日本語 · 小説",
    expect: "あめりか",
  },
  {
    id: "doko-e-gutenberg-ja",
    pg: 32941,
    lang: "ja",
    title: "何處へ",
    category: "日本語 · 小説",
    expect: "何處",
  },
  {
    id: "horadanshaku-tabi-gutenberg-ja",
    pg: 34084,
    lang: "ja",
    title: "法螺男爵旅土産",
    category: "日本語 · 小説",
    expect: "法螺男爵",
  },
  {
    id: "kumon-no-ran-gutenberg-ja",
    pg: 39287,
    lang: "ja",
    title: "苦悶の欄",
    category: "日本語 · 小説",
    expect: "苦悶",
  },
  {
    id: "geshukunin-gutenberg-ja",
    pg: 32978,
    lang: "ja",
    title: "下宿人",
    category: "日本語 · 小説",
    expect: "下宿人",
  },
  {
    id: "junkyo-shishu-gutenberg-ja",
    pg: 38697,
    lang: "ja",
    title: "殉情詩集",
    category: "日本語 · 詩集",
    expect: "殉情",
  },
  {
    id: "akuma-gutenberg-ja",
    pg: 37605,
    lang: "ja",
    title: "惡魔",
    category: "日本語 · 小説",
    expect: "惡魔",
  },
  {
    id: "zoku-akuma-gutenberg-ja",
    pg: 37626,
    lang: "ja",
    title: "續惡魔",
    category: "日本語 · 小説",
    expect: "續惡魔",
  },
  {
    id: "luther-catechism-gutenberg-ja",
    pg: 2592,
    lang: "ja",
    title: "マルチン・ルターの小信仰問答書",
    category: "日本語 · 宗教",
    expect: "ルター",
  },
  // Project Gutenberg's Korean catalogue currently exposes #5739, but its
  // ebook page says "Copyrighted"; keep Korean at 0 until a public-domain/CC0
  // source can be verified instead of weakening the publish policy.
  {
    id: "sri-vishnu-sahasranaamam-gutenberg-sa",
    pg: 9000,
    lang: "sa",
    title: "Sri Vishnu Sahasranaamam",
    category: "संस्कृतम् · Stotra",
    expect: "Vishnu",
  },
  {
    id: "tribute-michael-hart-gutenberg-ar",
    pg: 43007,
    lang: "ar",
    title: "Tribute to Michael Hart",
    category: "العربية · سيرة",
    expect: "Hart",
  },
  {
    id: "five-selected-short-stories-gutenberg-fa",
    pg: 46740,
    lang: "fa",
    title: "Five Selected Short Stories",
    category: "فارسی · داستان",
    expect: "Lawrence",
  },

  {
    id: "duhovnye-ody-gutenberg-ru",
    pg: 14741,
    lang: "ru",
    title: "Духовные оды",
    category: "Русский · Поэзия",
    expect: "Духовные",
    mergeAsSingleChapter: true,
  },
  {
    id: "krasavitse-tabak-gutenberg-ru",
    pg: 5316,
    lang: "ru",
    title: "Красавице, которая нюхала табак",
    category: "Русский · Поэзия",
    expect: "Красавице",
  },
  {
    id: "zadachi-ustnogo-scheta-gutenberg-ru",
    pg: 16527,
    lang: "ru",
    title: "1001 задача для умственного счета",
    category: "Русский · Математика",
    expect: "1001",
  },
  {
    id: "moskovia-inostrantsev-gutenberg-ru",
    pg: 30774,
    lang: "ru",
    title: "Московия в представлении иностранцев XVI-XVII в.",
    category: "Русский · История",
    expect: "Московия",
    mergeAsSingleChapter: true,
  },
  {
    id: "pan-tadeusz-gutenberg-pl",
    pg: 31536,
    lang: "pl",
    title: "Pan Tadeusz",
    category: "Polski · Poezja",
    expect: "Tadeusz",
    mergeAsSingleChapter: true,
  },
  {
    id: "tajemnica-baskerville-gutenberg-pl",
    pg: 34079,
    lang: "pl",
    title: "Tajemnica Baskerville'ów",
    category: "Polski · Detektywistyczna",
    expect: "Baskerville",
    mergeAsSingleChapter: true,
  },
  {
    id: "romeo-julia-gutenberg-pl",
    pg: 27062,
    lang: "pl",
    title: "Romeo i Julia",
    category: "Polski · Dramat",
    expect: "Romeo",
    mergeAsSingleChapter: true,
  },
  {
    id: "grazyna-gutenberg-pl",
    pg: 28153,
    lang: "pl",
    title: "Grażyna",
    category: "Polski · Poezja",
    expect: "Grażyna",
    mergeAsSingleChapter: true,
  },
  {
    id: "bajki-mickiewicz-gutenberg-pl",
    pg: 27729,
    lang: "pl",
    title: "Bajki",
    category: "Polski · Bajki",
    expect: "Bajki",
  },
  {
    id: "balady-romanse-gutenberg-pl",
    pg: 28049,
    lang: "pl",
    title: "Balady i romanse",
    category: "Polski · Poezja",
    expect: "Balady",
    mergeAsSingleChapter: true,
  },
  {
    id: "sonety-mickiewicza-gutenberg-pl",
    pg: 27081,
    lang: "pl",
    title: "Sonety Adama Mickiewicza",
    category: "Polski · Poezja",
    expect: "Sonety",
    mergeAsSingleChapter: true,
  },
  {
    id: "kopciuszek-gutenberg-pl",
    pg: 28044,
    lang: "pl",
    title: "Kopciuszek",
    category: "Polski · Baśnie",
    expect: "Kopciuszek",
  },
  {
    id: "odkrycia-wynalazki-gutenberg-pl",
    pg: 30407,
    lang: "pl",
    title: "O odkryciach i wynalazkach",
    category: "Polski · Nauka",
    expect: "odkrycia",
    mergeAsSingleChapter: true,
  },
  {
    id: "sklepy-cynamonowe-gutenberg-pl",
    pg: 8119,
    lang: "pl",
    title: "Sklepy cynamonowe",
    category: "Polski · Proza",
    expect: "Sklepy",
    mergeAsSingleChapter: true,
  },
  {
    id: "laka-lesmian-gutenberg-pl",
    pg: 35301,
    lang: "pl",
    title: "Łąka",
    category: "Polski · Poezja",
    expect: "Łąka",
    mergeAsSingleChapter: true,
  },
  {
    id: "menazerya-ludzka-gutenberg-pl",
    pg: 34635,
    lang: "pl",
    title: "Menazerya ludzka",
    category: "Polski · Proza",
    expect: "Menazerya",
  },
  {
    id: "jeden-miesiac-zycia-gutenberg-pl",
    pg: 28014,
    lang: "pl",
    title: "Jeden miesiąc życia",
    category: "Polski · Proza",
    expect: "miesiąc",
  },
  {
    id: "zywila-gutenberg-pl",
    pg: 28168,
    lang: "pl",
    title: "Żywila",
    category: "Polski · Proza historyczna",
    expect: "Żywila",
  },
  {
    id: "rur-gutenberg-cs",
    pg: 13083,
    lang: "cs",
    title: "R.U.R.",
    category: "Čeština · Drama",
    expect: "R.U.R.",
  },
  {
    id: "zapisky-mrtveho-domu-gutenberg-cs",
    pg: 34225,
    lang: "cs",
    title: "Zápisky z mrtvého domu",
    category: "Čeština · Román",
    expect: "Zápisky",
  },
  {
    id: "dvojnik-gutenberg-cs",
    pg: 37525,
    lang: "cs",
    title: "Dvojník",
    category: "Čeština · Novela",
    expect: "Dvojník",
  },
  {
    id: "sto-jisker-ethickych-gutenberg-cs",
    pg: 68828,
    lang: "cs",
    title: "Sto jisker ethických",
    category: "Čeština · Etika",
    expect: "jisker",
  },
  {
    id: "esperanto-ucebnice-gutenberg-cs",
    pg: 24575,
    lang: "cs",
    title: "Úplná učebnice mezinárodní řeči dra. Esperanta",
    category: "Čeština · Učebnice",
    expect: "Esperanta",
  },
  {
    id: "katolicky-katechismus-gutenberg-cs",
    pg: 16843,
    lang: "cs",
    title: "Cvičení maličkých ve svatém náboženství křesťansko-katolickém",
    category: "Čeština · Náboženství",
    expect: "náboženství",
  },
  {
    id: "citanka-pro-skoly-gutenberg-cs",
    pg: 59765,
    lang: "cs",
    title: "Cítanka pro skoly obecné. Díl I",
    category: "Čeština · Čítanka",
    expect: "Cítanka",
  },
  {
    id: "petofi-poems-gutenberg-hu",
    pg: 41504,
    lang: "hu",
    title: "Petőfi Sándor összes költeményei",
    category: "Magyar · Költészet",
    expect: "Petőfi",
  },
  {
    id: "magyar-nepdalok-gutenberg-hu",
    pg: 39737,
    lang: "hu",
    title: "Magyar népdalok",
    category: "Magyar · Népdalok",
    expect: "népdalok",
  },
  {
    id: "don-quijote-gutenberg-hu",
    pg: 66263,
    lang: "hu",
    title: "Don Quijote de la Mancha",
    category: "Magyar · Regény",
    expect: "Quijote",
  },
  {
    id: "magyar-nepkoltesi-gyujtemeny-1-gutenberg-hu",
    pg: 47073,
    lang: "hu",
    title: "Magyar népköltési gyüjtemény 1. kötet",
    category: "Magyar · Folklór",
    expect: "népköltési",
  },
  {
    id: "ipolyi-nepmesegyujtemenye-gutenberg-hu",
    pg: 56996,
    lang: "hu",
    title: "Ipolyi Arnold népmesegyüjteménye",
    category: "Magyar · Népmesék",
    expect: "Ipolyi",
  },
  {
    id: "karolyi-gabor-feljegyzesek-1-gutenberg-hu",
    pg: 63002,
    lang: "hu",
    title: "Gróf Károlyi Gábor följegyzései (1. kötet)",
    category: "Magyar · Emlékirat",
    expect: "Károlyi",
    skipTitles: ["VII"],
  },
  {
    id: "mimozak-krizantemok-gutenberg-hu",
    pg: 78387,
    lang: "hu",
    title: "Mimózák és krizántémok",
    category: "Magyar · Mesék",
    expect: "Mimózák",
  },
  {
    id: "legy-jo-mindhalalig-gutenberg-hu",
    pg: 67140,
    lang: "hu",
    title: "Légy jó mindhalálig",
    category: "Magyar · Regény",
    expect: "mindhalálig",
  },
  {
    id: "szent-peter-esernyoje-gutenberg-hu",
    pg: 68911,
    lang: "hu",
    title: "Szent Péter esernyője",
    category: "Magyar · Regény",
    expect: "esernyője",
  },
  {
    id: "complete-grammar-esperanto-gutenberg-eo",
    pg: 7787,
    lang: "eo",
    title: "A Complete Grammar of Esperanto",
    category: "Esperanto · Gramatiko",
    expect: "Esperanto",
  },
  {
    id: "fundamenta-krestomatio-gutenberg-eo",
    pg: 8224,
    lang: "eo",
    title: "Fundamenta Krestomatio",
    category: "Esperanto · Legolibro",
    expect: "Krestomatio",
  },
  {
    id: "doktoro-jekyll-gutenberg-eo",
    pg: 24145,
    lang: "eo",
    title: "Doktoro Jekyll kaj Sinjoro Hyde",
    category: "Esperanto · Fikcio",
    expect: "Jekyll",
  },
  {
    id: "vivo-zamenhof-gutenberg-eo",
    pg: 26359,
    lang: "eo",
    title: "Vivo de Zamenhof",
    category: "Esperanto · Biografio",
    expect: "Zamenhof",
  },
  {
    id: "hamleto-gutenberg-eo",
    pg: 37279,
    lang: "eo",
    title: "Hamleto, Reĝido de Danujo",
    category: "Esperanto · Dramo",
    expect: "Hamleto",
  },
  {
    id: "nuntempaj-rakontoj-gutenberg-eo",
    pg: 23670,
    lang: "eo",
    title: "Nuntempaj Rakontoj",
    category: "Esperanto · Rakontoj",
    expect: "Rakontoj",
  },
  {
    id: "alicio-mirlando-gutenberg-eo",
    pg: 17482,
    lang: "eo",
    title: "La Aventuroj de Alicio en Mirlando",
    category: "Esperanto · Fantazio",
    expect: "Alicio",
  },
  {
    id: "mirinda-sorcisto-oz-gutenberg-eo",
    pg: 31348,
    lang: "eo",
    title: "La Mirinda Sorĉisto de Oz",
    category: "Esperanto · Fantazio",
    expect: "Oz",
  },
  {
    id: "un-pis-ensanche-gutenberg-ca",
    pg: 78123,
    lang: "ca",
    title: "Un pis al ensanche",
    category: "Català · Teatre",
    expect: "ensanche",
    mergeAsSingleChapter: true,
  },
  {
    id: "auca-senyor-esteve-gutenberg-ca",
    pg: 56856,
    lang: "ca",
    title: "L'auca del senyor Esteve",
    category: "Català · Novel·la",
    expect: "Esteve",
    mergeAsSingleChapter: true,
  },
  {
    id: "estudiant-garrotxa-gutenberg-ca",
    pg: 78392,
    lang: "ca",
    title: "L'estudiant de la Garrotxa",
    category: "Català · Novel·la",
    expect: "Garrotxa",
    mergeAsSingleChapter: true,
  },
  {
    id: "alegres-comares-windsor-gutenberg-ca",
    pg: 17046,
    lang: "ca",
    title: "Les alegres comares de Windsor",
    category: "Català · Teatre",
    expect: "Windsor",
    mergeAsSingleChapter: true,
  },
  {
    id: "tres-homes-barca-gutenberg-ca",
    pg: 29944,
    lang: "ca",
    title: "Tres Homes Dins D'una Barca",
    category: "Català · Humor",
    expect: "Barca",
    mergeAsSingleChapter: true,
  },
  {
    id: "aventures-tom-sawyer-gutenberg-ca",
    pg: 30890,
    lang: "ca",
    title: "Les Aventures De Tom Sawyer",
    category: "Català · Aventura",
    expect: "Sawyer",
    mergeAsSingleChapter: true,
  },
  {
    id: "contes-andersen-gutenberg-ca",
    pg: 27142,
    lang: "ca",
    title: "Contes D'Andersen",
    category: "Català · Contes",
    expect: "Andersen",
    mergeAsSingleChapter: true,
  },
  {
    id: "pinya-rosa-vol1-gutenberg-ca",
    pg: 15346,
    lang: "ca",
    title: "Pinya de Rosa. Volume 1, Books 1-3",
    category: "Català · Narrativa",
    expect: "Pinya",
    mergeAsSingleChapter: true,
  },
  {
    id: "orfaneta-menargues-gutenberg-ca",
    pg: 75136,
    lang: "ca",
    title: "La orfaneta de Menargues",
    category: "Català · Novel·la històrica",
    expect: "Menargues",
    mergeAsSingleChapter: true,
  },
  {
    id: "reina-del-cor-gutenberg-ca",
    pg: 76248,
    lang: "ca",
    title: "La reina del cor",
    category: "Català · Teatre",
    expect: "reina",
    mergeAsSingleChapter: true,
  },
  {
    id: "marxant-venecia-gutenberg-ca",
    pg: 27536,
    lang: "ca",
    title: "El Marxant de Venecia",
    category: "Català · Teatre",
    expect: "Venecia",
    mergeAsSingleChapter: true,
  },
  {
    id: "els-idols-gutenberg-ca",
    pg: 78453,
    lang: "ca",
    title: "Els idols",
    category: "Català · Teatre",
    expect: "idols",
    mergeAsSingleChapter: true,
  },
  {
    id: "tres-anglesos-gutenberg-ca",
    pg: 26502,
    lang: "ca",
    title: "Tres Anglesos S'esbargeixen",
    category: "Català · Humor",
    expect: "Anglesos",
    mergeAsSingleChapter: true,
  },
  {
    id: "pinya-rosa-vol2-gutenberg-ca",
    pg: 15347,
    lang: "ca",
    title: "Pinya de Rosa. Volume 2, Book 4",
    category: "Català · Narrativa",
    expect: "Pinya",
    mergeAsSingleChapter: true,
  },
  {
    id: "poezii-eminescu-gutenberg-ro",
    pg: 35323,
    lang: "ro",
    title: "Poezii",
    category: "Română · Poezie",
    expect: "Poezii",
    mergeAsSingleChapter: true,
  },
  {
    id: "nuvele-caragiale-gutenberg-ro",
    pg: 64597,
    lang: "ro",
    title: "Nuvele",
    category: "Română · Proză",
    expect: "Nuvele",
    mergeAsSingleChapter: true,
  },
  // Gutenberg #62916 Povești is public-domain metadata, but the generated EPUB
  // extraction currently trips the mojibake detector. Keep it out until a
  // clean UTF-8 source is available.
  {
    id: "noli-me-tangere-gutenberg-tl",
    pg: 20228,
    lang: "tl",
    title: "Noli Me Tangere",
    category: "Tagalog · Nobela",
    expect: "Noli",
    mergeAsSingleChapter: true,
  },
  {
    id: "bagong-robinson-tomo1-gutenberg-tl",
    pg: 20858,
    lang: "tl",
    title: "Ang Bagong Robinson (Tomo 1)",
    category: "Tagalog · Nobela",
    expect: "Robinson",
    mergeAsSingleChapter: true,
  },
  // Gutenberg #47629 Ang Filibusterismo is public-domain metadata, but the
  // generated EPUB extraction jumps from chapter VII to IX. Keep it out until
  // we can use a source that preserves chapter VIII.
  {
    id: "doctrina-christiana-gutenberg-tl",
    pg: 16119,
    lang: "tl",
    title: "Doctrina Christiana",
    category: "Tagalog · Relihiyon",
    expect: "Doctrina",
    mergeAsSingleChapter: true,
  },
  {
    id: "ibong-adarna-gutenberg-tl",
    pg: 16157,
    lang: "tl",
    title: "Ibong Adarna",
    category: "Tagalog · Korido",
    expect: "Adarna",
    mergeAsSingleChapter: true,
  },
  {
    id: "florante-laura-gutenberg-tl",
    pg: 15845,
    lang: "tl",
    title: "Florante at Laura",
    category: "Tagalog · Tula",
    expect: "Florante",
    mergeAsSingleChapter: true,
  },
  {
    id: "liham-rizal-malolos-gutenberg-tl",
    pg: 17116,
    lang: "tl",
    title: "Ang Liham ni Dr. Jose Rizal sa mga Kadalagahan sa Malolos, Bulakan",
    category: "Tagalog · Sanaysay",
    expect: "Malolos",
  },
  {
    id: "urbana-feliza-gutenberg-tl",
    pg: 15980,
    lang: "tl",
    title: "Pag Susulatan nang Dalauang Binibini na si Urbana at ni Feliza",
    category: "Tagalog · Liham",
    expect: "Urbana",
    mergeAsSingleChapter: true,
  },
  {
    id: "buhay-rizal-gutenberg-tl",
    pg: 18282,
    lang: "tl",
    title: "Buhay at Mga Ginawâ ni Dr. José Rizal",
    category: "Tagalog · Talambuhay",
    expect: "Rizal",
    mergeAsSingleChapter: true,
  },
  {
    id: "pagibig-layas-gutenberg-tl",
    pg: 46639,
    lang: "tl",
    title: "Ang Pag-ibig ng Layas",
    category: "Tagalog · Nobela",
    expect: "Pag-ibig",
  },
  {
    id: "dating-pilipinas-gutenberg-tl",
    pg: 17787,
    lang: "tl",
    title: "Dating Pilipinas",
    category: "Tagalog · Kasaysayan",
    expect: "Pilipinas",
    mergeAsSingleChapter: true,
  },
  {
    id: "panukala-republika-gutenberg-tl",
    pg: 14982,
    lang: "tl",
    title: "Panukala sa Pagkakana nang República nang Pilipinas",
    category: "Tagalog · Pulitika",
    expect: "Panukala",
  },
  {
    id: "dakilang-pilipino-gutenberg-tl",
    pg: 17786,
    lang: "tl",
    title: "Mga Dakilang Pilipino",
    category: "Tagalog · Talambuhay",
    expect: "Pilipino",
  },
  {
    id: "dakilang-asal-gutenberg-tl",
    pg: 13687,
    lang: "tl",
    title: "Dakilang Asal",
    category: "Tagalog · Tula",
    expect: "Dakilang",
  },
  {
    id: "hunger-book-one-gutenberg-he",
    pg: 18291,
    lang: "he",
    title: "Hunger: Book One",
    category: "עברית · רומן",
    expect: "Hunger",
    mergeAsSingleChapter: true,
  },
  {
    id: "hatzofe-beit-yisrael-gutenberg-he",
    pg: 45252,
    lang: "he",
    title: "הצופה לבית ישראל: תשליך",
    category: "עברית · סאטירה",
    expect: "הצופה",
  },
  {
    id: "beit-nekhot-halakhot-gutenberg-he",
    pg: 43740,
    lang: "he",
    title: "בית נכות ההלכות",
    category: "עברית · הלכה",
    expect: "בית נכות",
  },
  {
    id: "iliad-gutenberg-el",
    pg: 36248,
    lang: "el",
    title: "Ιλιάδα",
    category: "Ελληνικά · Έπος",
    expect: "Ιλιάδα",
  },
  {
    id: "peri-psyches-gutenberg-el",
    pg: 27816,
    lang: "el",
    title: "Περί Ψυχής",
    category: "Ελληνικά · Φιλοσοφία",
    expect: "Ψυχής",
  },
  {
    id: "odysseia-tomos-g-gutenberg-el",
    pg: 30615,
    lang: "el",
    title: "Ομήρου Οδύσσεια Τόμος Γ",
    category: "Ελληνικά · Έπος",
    expect: "Οδύσσεια",
  },
  {
    id: "fonissa-gutenberg-el",
    pg: 36205,
    lang: "el",
    title: "Η Φόνισσα",
    category: "Ελληνικά · Μυθιστόρημα",
    expect: "Φόνισσα",
  },
  {
    id: "ethika-nikomacheia-gutenberg-el",
    pg: 28626,
    lang: "el",
    title: "Ηθικά Νικομάχεια",
    category: "Ελληνικά · Φιλοσοφία",
    expect: "Ηθικά",
  },
  {
    id: "istoriai-herodotou-gutenberg-el",
    pg: 38055,
    lang: "el",
    title: "Ιστορίαι Ηροδότου, Τόμος 1",
    category: "Ελληνικά · Ιστορία",
    expect: "Ηροδότου",
  },
  {
    id: "oidipous-tyrannos-gutenberg-el",
    pg: 17839,
    lang: "el",
    title: "Οιδίπους Τύραννος",
    category: "Ελληνικά · Θέατρο",
    expect: "Οιδίπους",
  },
  {
    id: "timaios-a-gutenberg-el",
    pg: 35453,
    lang: "el",
    title: "Τίμαιος, Τόμος Α",
    category: "Ελληνικά · Φιλοσοφία",
    expect: "Τίμαιος",
  },
  {
    id: "solomos-apanta-gutenberg-el",
    pg: 42031,
    lang: "el",
    title: "Διονυσίου Σολωμού - Άπαντα τα Ευρισκόμενα",
    category: "Ελληνικά · Ποίηση",
    expect: "Σολωμού",
  },
  {
    id: "athinaion-politeia-gutenberg-el",
    pg: 39963,
    lang: "el",
    title: "Αθηναίων Πολιτεία",
    category: "Ελληνικά · Πολιτική",
    expect: "Αθηναίων",
  },
  {
    id: "kyrou-anabasis-tomos1-gutenberg-el",
    pg: 39764,
    lang: "el",
    title: "Κύρου Ανάβασις Τόμος 1",
    category: "Ελληνικά · Ιστορία",
    expect: "Ανάβασις",
  },
  {
    id: "aeneidos-gutenberg-la",
    pg: 227,
    lang: "la",
    title: "Aeneidos",
    category: "Latina · Epic",
    expect: "Aeneidos",
  },
  {
    id: "de-officiis-gutenberg-la",
    pg: 47001,
    lang: "la",
    title: "De Officiis",
    category: "Latina · Philosophy",
    expect: "Officiis",
    mergeAsSingleChapter: true,
  },
  {
    id: "confessiones-gutenberg-la",
    pg: 33849,
    lang: "la",
    title: "Confessiones",
    category: "Latina · Theology",
    expect: "Confessiones",
    mergeAsSingleChapter: true,
  },
  {
    id: "principia-mathematica-gutenberg-la",
    pg: 28233,
    lang: "la",
    title: "Philosophiae Naturalis Principia Mathematica",
    category: "Latina · Science",
    expect: "Principia",
  },
  {
    id: "catulli-carmina-gutenberg-la",
    pg: 23294,
    lang: "la",
    title: "Catulli Carmina",
    category: "Latina · Poetry",
    expect: "Catulli",
    mergeAsSingleChapter: true,
  },
  {
    id: "de-bello-catilinario-gutenberg-la",
    pg: 7402,
    lang: "la",
    title: "De Bello Catilinario Et Jugurthino",
    category: "Latina · History",
    expect: "Catilinario",
    mergeAsSingleChapter: true,
  },
  {
    id: "plautus-comedies-gutenberg-la",
    pg: 16564,
    lang: "la",
    title: "Amphitryo, Asinaria, Aulularia, Bacchides, Captivi",
    category: "Latina · Drama",
    expect: "Amphitryo",
    mergeAsSingleChapter: true,
  },
  {
    id: "horace-works-gutenberg-la",
    pg: 46938,
    lang: "la",
    title: "The Works of Horace",
    category: "Latina · Poetry",
    expect: "Horace",
    mergeAsSingleChapter: true,
  },
  {
    id: "cato-maior-senectute-gutenberg-la",
    pg: 14945,
    lang: "la",
    title: "Cato Maior de Senectute",
    category: "Latina · Philosophy",
    expect: "Senectute",
    mergeAsSingleChapter: true,
  },
  {
    id: "de-bello-gallico-gutenberg-la",
    pg: 218,
    lang: "la",
    title: "C. Iuli Caesaris De Bello Gallico, I-IV",
    category: "Latina · History",
    expect: "Gallico",
    mergeAsSingleChapter: true,
  },
  {
    id: "fasti-gutenberg-la",
    pg: 8738,
    lang: "la",
    title: "Fasti",
    category: "Latina · Poetry",
    expect: "Fasti",
    mergeAsSingleChapter: true,
  },
  {
    id: "robinson-crusoe-latin-gutenberg-la",
    pg: 74851,
    lang: "la",
    title: "Robinson Crusoe in Latin",
    category: "Latina · Fiction",
    expect: "Robinson",
    mergeAsSingleChapter: true,
  },
  {
    id: "georgicon-gutenberg-la",
    pg: 231,
    lang: "la",
    title: "Georgicon",
    category: "Latina · Poetry",
    expect: "Georgicon",
  },
  {
    id: "cicero-orations-gutenberg-la",
    pg: 226,
    lang: "la",
    title: "Cicero's Orations",
    category: "Latina · Oratory",
    expect: "Cicero",
    mergeAsSingleChapter: true,
  },
];

function auditBookCatalog(books = BOOKS) {
  const errors = [];
  const seenIds = new Map();
  const seenPg = new Map();
  const byLang = {};
  if (!Array.isArray(books) || !books.length) {
    errors.push("Gutenberg catalog is empty");
    return { ok: false, total: Array.isArray(books) ? books.length : 0, byLang, errors };
  }
  for (const [index, book] of books.entries()) {
    const label = book?.id || `book[${index}]`;
    if (!book || typeof book !== "object") {
      errors.push(`book[${index}] is not an object`);
      continue;
    }
    const id = String(book.id || "").trim();
    const lang = String(book.lang || "").trim();
    const category = String(book.category || "").trim();
    const title = String(book.title || "").trim();
    const expect = String(book.expect || "").trim();
    const pg = Number(book.pg);

    if (!id) errors.push(`book[${index}] is missing id`);
    else if (!/^[a-z0-9-]+$/u.test(id))
      errors.push(`${label}: id must use lowercase letters, digits, and hyphens`);
    else if (seenIds.has(id))
      errors.push(`${id}: duplicate id, first seen at index ${seenIds.get(id)}`);
    else seenIds.set(id, index);

    if (!Number.isInteger(pg) || pg <= 0) {
      errors.push(`${label}: pg must be a positive Project Gutenberg ebook number`);
    } else if (seenPg.has(pg)) {
      errors.push(
        `${label}: duplicate Project Gutenberg ebook #${pg}, first used by ${seenPg.get(pg)}`,
      );
    } else {
      seenPg.set(pg, id || label);
    }

    if (!/^[a-z]{2,3}$/u.test(lang)) {
      errors.push(`${label}: lang must be a lowercase ISO-like code`);
    } else {
      byLang[lang] = (byLang[lang] || 0) + 1;
      if (!LANGUAGE_CATEGORY_PREFIX[lang]) {
        errors.push(`${label}: unsupported language code "${lang}"`);
      }
    }

    const expectedPrefix = LANGUAGE_CATEGORY_PREFIX[lang];
    if (!category) {
      errors.push(`${label}: category is required`);
    } else if (expectedPrefix && !category.startsWith(`${expectedPrefix} · `)) {
      errors.push(
        `${label}: category "${category}" must start with "${expectedPrefix} · " for lang ${lang}`,
      );
    }

    if (!title) errors.push(`${label}: title is required`);
    if (!expect) errors.push(`${label}: expect search probe text is required`);

    if (
      book.minChapters != null &&
      (!Number.isInteger(book.minChapters) || book.minChapters <= 0)
    ) {
      errors.push(`${label}: minChapters must be a positive integer`);
    }
    if (
      book.maxChapters != null &&
      (!Number.isInteger(book.maxChapters) || book.maxChapters <= 0)
    ) {
      errors.push(`${label}: maxChapters must be a positive integer`);
    }
    if (
      book.minChapters != null &&
      book.maxChapters != null &&
      book.maxChapters < book.minChapters
    ) {
      errors.push(`${label}: maxChapters must be greater than or equal to minChapters`);
    }
    if (book.skipTitles != null && !Array.isArray(book.skipTitles)) {
      errors.push(`${label}: skipTitles must be an array when present`);
    }
  }
  return {
    ok: errors.length === 0,
    total: books.length,
    byLang,
    errors,
  };
}

function assertBookCatalog(books = BOOKS) {
  const audit = auditBookCatalog(books);
  if (!audit.ok) {
    throw new Error(
      `Invalid Gutenberg catalog:\n${audit.errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return audit;
}

function splitList(value, label) {
  const items = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) throw new Error(`Missing value for ${label}`);
  return items;
}

function parseIntegerOption(value, label, { min = 0 } = {}) {
  if (!/^\d+$/u.test(String(value || ""))) throw new Error(`${label} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min)
    throw new Error(`${label} must be ${min > 0 ? "positive" : "non-negative"}`);
  return number;
}

function parseArgs(argv) {
  const out = {
    publish: false,
    json: false,
    audit: false,
    allLangs: false,
    apiUrl: API_URL,
    ids: [],
    langs: [],
    limit: null,
    offset: 0,
    concurrency: null,
    chapterConcurrency: DEFAULT_CHAPTER_PUBLISH_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish" || arg === "--json" || arg === "--summary" || arg === "--audit") {
      out[arg.slice(2)] = true;
      continue;
    }
    if (arg === "--skip-existing") {
      out.skipExisting = true;
      continue;
    }
    if (arg === "--all-langs") {
      out.allLangs = true;
      continue;
    }
    if (arg === "--continue-on-error") {
      out.continueOnError = true;
      continue;
    }
    if (
      arg === "--limit" ||
      arg === "--offset" ||
      arg === "--concurrency" ||
      arg === "--chapter-concurrency"
    ) {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      const key = arg === "--chapter-concurrency" ? "chapterConcurrency" : arg.slice(2);
      const min = arg === "--offset" ? 0 : 1;
      out[key] = parseIntegerOption(value, arg, { min });
      continue;
    }
    if (arg === "--api-url" || arg === "--ids" || arg === "--lang" || arg === "--langs") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--api-url") out.apiUrl = value.replace(/\/+$/, "");
      else if (arg === "--ids") out.ids = splitList(value, arg);
      else out.langs = splitList(value, arg).map(languageCodeFor);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function importBookConcurrency(options) {
  if (options.concurrency != null) return Number(options.concurrency);
  return options.publish ? DEFAULT_PUBLISH_CONCURRENCY : DEFAULT_DRY_RUN_CONCURRENCY;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function selectBooks(options = {}, books = BOOKS) {
  const ids = options.ids || [];
  const defaultLangs =
    !ids.length && !options.allLangs && !(options.langs || []).length
      ? options.defaultLangs || []
      : [];
  const langs = [...(options.langs || []), ...defaultLangs].map(languageCodeFor);
  const knownIds = new Set(books.map((book) => book.id));
  const missingIds = ids.filter((id) => !knownIds.has(id));
  if (missingIds.length) throw new Error(`Unknown book ids: ${missingIds.join(",")}`);

  const knownLangs = new Set(books.map((book) => book.lang));
  const unknownLangs = langs.filter(
    (lang) => !LANGUAGE_CATEGORY_PREFIX[lang] && !knownLangs.has(lang),
  );
  if (unknownLangs.length) throw new Error(`Unknown language codes: ${unknownLangs.join(",")}`);

  const idSet = ids.length ? new Set(ids) : null;
  const langSet = langs.length ? new Set(langs) : null;
  const filtered = books.filter(
    (book) => (!idSet || idSet.has(book.id)) && (!langSet || langSet.has(book.lang)),
  );
  const offset = Number(options.offset || 0);
  const limit = options.limit == null ? null : Number(options.limit);
  const selected = filtered.slice(offset, limit == null ? undefined : offset + limit);
  if (!selected.length) {
    const scopes = [
      ids.length ? `ids=${ids.join(",")}` : null,
      langs.length ? `langs=${langs.join(",")}` : null,
      offset ? `offset=${offset}` : null,
      limit != null ? `limit=${limit}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(`No matching books${scopes ? ` for ${scopes}` : ""}`);
  }
  return selected;
}

function epubUrls(book) {
  return [
    `https://www.gutenberg.org/ebooks/${book.pg}.epub.images`,
    `https://www.gutenberg.org/ebooks/${book.pg}.epub.noimages`,
    `https://www.gutenberg.org/ebooks/${book.pg}.epub`,
  ];
}

function plainTextUrls(book) {
  return [
    `https://www.gutenberg.org/cache/epub/${book.pg}/pg${book.pg}.txt`,
    `https://www.gutenberg.org/files/${book.pg}/${book.pg}-0.txt`,
    `https://www.gutenberg.org/files/${book.pg}/${book.pg}.txt`,
  ];
}

function sourceUrl(book) {
  return `https://www.gutenberg.org/ebooks/${book.pg}`;
}

function rdfUrl(book) {
  return `https://www.gutenberg.org/cache/epub/${book.pg}/pg${book.pg}.rdf`;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function rdfValues(xml, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "g");
  return [...String(xml || "").matchAll(re)]
    .map((m) =>
      decodeXmlEntities(
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    )
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transientFetchFailure(error) {
  const text = String(error?.message || error || "");
  const code = error?.cause?.code || error?.code || "";
  return (
    /fetch failed|socket|timeout|terminated|network/i.test(text) ||
    ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code)
  );
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status >= 500) && attempt < FETCH_RETRIES) {
        await res.arrayBuffer().catch(() => {});
        process.stderr.write(
          `[gutenberg] retry ${attempt + 1}/${FETCH_RETRIES} ${url}: HTTP ${res.status}\n`,
        );
        await sleep(FETCH_RETRY_BASE_MS * attempt);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES || !transientFetchFailure(error)) throw error;
      process.stderr.write(
        `[gutenberg] retry ${attempt + 1}/${FETCH_RETRIES} ${url}: ${error.message}\n`,
      );
      await sleep(FETCH_RETRY_BASE_MS * attempt);
    }
  }
  throw lastError;
}

async function fetchGutenbergMetadata(book) {
  const res = await fetchWithRetry(rdfUrl(book), {
    headers: { "user-agent": "liber-gutenberg-import/0.1" },
  });
  if (!res.ok)
    throw new Error(
      `Failed to verify Project Gutenberg metadata for ${book.id}: HTTP ${res.status}`,
    );
  const rdf = await res.text();
  return {
    rights: rdfValues(rdf, "dcterms:rights"),
    title: rdfValues(rdf, "dcterms:title")[0] || "",
    issued: rdfValues(rdf, "dcterms:issued")[0] || "",
  };
}

function verifyGutenbergPublicDomain(book, metadata) {
  const license = verifyPublishLicense(
    { metadata: { rights: metadata.rights } },
    {
      evidence: `Project Gutenberg RDF rights for ebook ${book.pg}: ${metadata.rights.join("; ")}`,
    },
  );
  if (!license.accepted) {
    throw new Error(
      `Rejected ${book.id} #${book.pg}: ${license.reason} Rights: ${metadata.rights.join("; ") || "none"}`,
    );
  }
  return license;
}

function isLikelyValidOrdinalHeading(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:[IVXLCDM]+\.?|第[一二三四五六七八九十百千〇○零0-9]+[章幕場节節]|[一二三四五六七八九十百千]+|(?:CAPITOLO|HOOFDSTUK|KAPITEL|KAPITLET|CHAPITRE|ROZDZIAŁ)\b)/iu.test(
    value,
  );
}

function normalizedChapterHeading(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bchapter\s+/gi, "")
    .replace(/\bpar(?:agraph)?\.?\s+\d+\b/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function chapterHeadingWords(title) {
  return String(title || "").match(/[\p{L}\p{N}]+/gu) || [];
}

function isPureRomanHeading(title) {
  return /^[IVXLCDM]+\s*\.?$/iu.test(String(title || "").trim());
}

function isBodyFragmentHeading(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const headingText = value
    .replace(/^chapter\s+(?:[IVXLCDM]+|\d+)\.?\s+/iu, "")
    .replace(/^(?:book\s+)?[IVXLCDM]+\.?\s+/iu, "")
    .trim();
  const words = chapterHeadingWords(headingText);
  if (words.length < 8) return false;

  const alphaWords = words.filter((word) => /\p{L}/u.test(word) && word.length >= 4);
  const titleCaseWords = alphaWords.filter((word) => /^\p{Lu}/u.test(word));
  const titleCaseRatio = alphaWords.length ? titleCaseWords.length / alphaWords.length : 0;
  const hasOrdinalPrefix =
    /^(?:chapter\s+)?(?:[IVXLCDM]+|\d+)\.?\s+/iu.test(value) ||
    /^book\s+[IVXLCDM]+\s+[IVXLCDM]+\.?\s+/iu.test(value);
  const danglingEnd =
    /\b(?:a|an|and|as|at|be|been|by|can|for|from|in|into|is|may|of|or|that|the|to|upon|what|when|where|which|will|with)\.?$/iu.test(
      value,
    );
  return (
    hasOrdinalPrefix &&
    titleCaseRatio < 0.45 &&
    (danglingEnd || value.length > 96 || /["()]/u.test(value))
  );
}

function isProseFragmentHeading(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return false;
  if (/^\[\d+\]/.test(value)) return true;
  if (/^(?:book m|list of works)$/iu.test(value)) return true;
  if (
    new RegExp(
      `^第\\s*${HAN_ORDINAL_RE}\\s*(?:回|章|節|节|篇|卦|卷|出)[\\p{Script=Han}]`,
      "u",
    ).test(value) &&
    value.length > 28 &&
    /[，。！？；﹐﹗﹖﹔、]/u.test(value)
  )
    return true;
  if (/^(?:第\s*)?[一二两三四五六七八九十百千〇○零\d]+\s*(?:章|回|節|节|篇|卦|卷)/u.test(value))
    return false;
  if (/^\d{1,3}[.、]\s+[\p{Script=Han}]{1,12}$/u.test(value)) return false;

  const words = chapterHeadingWords(value);
  if (/\p{Script=Han}/u.test(value)) {
    if (isShortChineseProseHeading(value)) return true;
    if (
      /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) &&
      value.length > 18 &&
      /[。？！]/u.test(value)
    )
      return true;
    return value.length > 36 && /[，。、；：？！“”"《》]/u.test(value);
  }
  if (words.length >= 14 && /[.!?;]/u.test(value)) return true;
  if (value.length > 120 && /[.!?;]/u.test(value)) return true;
  return false;
}

function isShortChineseProseHeading(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || !/\p{Script=Han}/u.test(value)) return false;
  if (new RegExp(`^(?:第\\s*)?${HAN_ORDINAL_RE}\\s*(?:章|回|節|节|篇|卦|卷|出)`, "u").test(value))
    return false;
  if (
    new RegExp(
      `^(?:卷第?${HAN_ORDINAL_RE}|卷之${HAN_ORDINAL_RE}(?:上|中|下)?|第${HAN_ORDINAL_RE}卷)$`,
      "u",
    ).test(value)
  )
    return false;
  if (/^\d{1,3}[.、]\s+[\p{Script=Han}]{1,16}$/u.test(value)) return false;
  return [...value].length <= 48 && /(?:[。！？!?；;﹗﹖﹔]|……|…+)$/u.test(value);
}

function isStructuredJapaneseHeading(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return false;
  return (
    /^第[一二三四五六七八九十百千〇○零\d]+章/u.test(value) ||
    /^[（(]?[一二三四五六七八九十百千〇○零\d]+[）)]$/u.test(value) ||
    /(?:話|章|篇|編|節|集|問答書|物語|紋章|土産)$/u.test(value)
  );
}

function isJapaneseDialogueOrProseHeading(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return false;
  if (isStructuredJapaneseHeading(value)) return false;
  if (/[。？！…]/u.test(value) && value.length >= 3) return true;
  return (
    value.length > 5 &&
    /(?:です|ます|でした|ました|ません|だ|だわ|だね|だらう|でせう|せう|かい|か|ねえ|ないわ|るんです|なんです)$/u.test(
      value,
    )
  );
}

function japaneseProseHeadingWarnings(titles) {
  const japaneseTitles = titles.filter((title) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title),
  );
  if (!japaneseTitles.length) return [];
  const prose = japaneseTitles.filter(isJapaneseDialogueOrProseHeading);
  if (!prose.length) return [];
  if (
    (titles.length < 8 && prose.length >= 2) ||
    (titles.length >= 8 && prose.length / titles.length > 0.22)
  ) {
    return [`TOC has ${prose.length} Japanese prose-fragment-looking headings`];
  }
  return [];
}

const HAN_NUMBER_DIGITS = new Map([
  ["〇", 0],
  ["○", 0],
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["兩", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);
const HAN_NUMBER_UNITS = new Map([
  ["十", 10],
  ["百", 100],
  ["千", 1000],
]);
const HAN_ORDINAL_CHARS = "一二两兩三四五六七八九十百千〇○零廿卄卅卌OoＯ\\d０-９";
const HAN_ORDINAL_RE = `[${HAN_ORDINAL_CHARS}]+`;
const CHINESE_CHAPTER_PREFIX_RE = new RegExp(
  `^(?:第\\s*)?${HAN_ORDINAL_RE}\\s*(?:章|回|節|节|篇|卦|卷|出)`,
  "u",
);

function trimChineseChapterTitleProseTail(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const recitationStart = value.search(/\s+(?:詩曰|诗曰|詞曰|词曰)[:：]/u);
  if (recitationStart > 0 && CHINESE_CHAPTER_PREFIX_RE.test(value)) {
    return value.slice(0, recitationStart).trim();
  }
  const withoutRecitationMarker = value.replace(/\s+(?:詩曰|诗曰|詞曰|词曰)[:：]?$/u, "").trim();
  if (withoutRecitationMarker !== value) return withoutRecitationMarker;
  if (!CHINESE_CHAPTER_PREFIX_RE.test(value) || !/[。！？；;]/u.test(value)) return value;
  const chunks = value.split(/\s+/).filter(Boolean);
  if (chunks.length < 4) return value;
  const last = chunks[chunks.length - 1] || "";
  const bodyChunks = chunks.slice(1, -1);
  if (bodyChunks.length < 2) return value;
  if (bodyChunks.some((chunk) => /[，。！？；;:：]/u.test(chunk))) return value;
  if (!/[，。！？；;]/u.test(last) || !/[。！？；;]$/u.test(last)) return value;
  if ([...last].length > 28) return value;
  return chunks.slice(0, -1).join(" ");
}

function parseHanOrdinalNumber(value) {
  const text = String(value || "")
    .replace(/[０-９]/gu, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/[OoＯ]/gu, "零")
    .replace(/[廿卄]/gu, "二十")
    .replace(/卅/gu, "三十")
    .replace(/卌/gu, "四十")
    .replace(/\s+/g, "")
    .trim();
  if (!text) return null;
  if (/^\d+$/u.test(text)) return Number(text);
  if (![...text].every((ch) => HAN_NUMBER_DIGITS.has(ch) || HAN_NUMBER_UNITS.has(ch))) return null;
  if (![...text].some((ch) => HAN_NUMBER_UNITS.has(ch))) {
    const digits = [...text].map((ch) => HAN_NUMBER_DIGITS.get(ch));
    const number = Number(digits.join(""));
    return Number.isFinite(number) ? number : null;
  }

  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (HAN_NUMBER_DIGITS.has(ch)) {
      current = HAN_NUMBER_DIGITS.get(ch);
      continue;
    }
    const unit = HAN_NUMBER_UNITS.get(ch);
    if (!unit) return null;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function formatHanOrdinalText(value) {
  const text = String(value || "")
    .replace(/[OoＯ]/gu, "零")
    .replace(/\s+/g, "")
    .trim();
  const n = parseHanOrdinalNumber(text);
  return n ? formatHanNumber(n) : text;
}

function formatHanNumber(value) {
  const number = Number(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (!Number.isInteger(number) || number <= 0 || number >= 100) return String(value || "").trim();
  if (number < 10) return digits[number];
  if (number === 10) return "十";
  if (number < 20) return `十${digits[number % 10]}`;
  const tens = Math.floor(number / 10);
  const ones = number % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

function chineseOrdinalFromTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const chapter = value.match(
    new RegExp(`^第\\s*(${HAN_ORDINAL_RE})\\s*(回|章|節|节|篇|卦|卷|出)`, "u"),
  );
  if (chapter) {
    const n = parseHanOrdinalNumber(chapter[1]);
    return n ? { kind: chapter[2], n } : null;
  }
  const volume =
    value.match(new RegExp(`^卷第?\\s*(${HAN_ORDINAL_RE})`, "u")) ||
    value.match(new RegExp(`^卷之\\s*(${HAN_ORDINAL_RE})`, "u"));
  if (volume) {
    const n = parseHanOrdinalNumber(volume[1]);
    return n ? { kind: "卷", n } : null;
  }
  return null;
}

function trailingChineseOrdinalFromTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .replace(/（缺）$/u, "")
    .trim();
  if (!value || value.length > 48) return null;
  const match =
    value.match(new RegExp(`\\S第\\s*(${HAN_ORDINAL_RE})$`, "u")) ||
    value.match(new RegExp(`\\S篇\\s*(${HAN_ORDINAL_RE})$`, "u"));
  if (!match) return null;
  const n = parseHanOrdinalNumber(match[1]);
  return n ? { kind: "篇尾第", n } : null;
}

function chineseTocFragmentWarnings(titles) {
  const ordinalRe = new RegExp(`第\\s*${HAN_ORDINAL_RE}\\s*(?:回|章|節|节|篇|卦|卷|出)`, "gu");
  const fragments = titles.filter(
    (title) => [...String(title || "").matchAll(ordinalRe)].length >= 2,
  );
  return fragments.length ? [`TOC has ${fragments.length} Chinese TOC-fragment headings`] : [];
}

function chinesePlaceholderTitleWarnings(titles) {
  const placeholders = titles.filter((title) => /口{3,}/u.test(String(title || "")));
  return placeholders.length ? [`TOC has ${placeholders.length} Chinese placeholder headings`] : [];
}

function chineseGarbledTitleWarnings(titles) {
  const garbled = titles.filter(
    (title) =>
      /\p{Script=Han}/u.test(String(title || "")) && /[~{}\\@]|\?{3,}/u.test(String(title || "")),
  );
  return garbled.length ? [`TOC has ${garbled.length} Chinese garbled-symbol headings`] : [];
}

function compactNumberRanges(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i];
    let end = start;
    while (sorted[i + 1] === end + 1) {
      i += 1;
      end = sorted[i];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges;
}

const ROMAN_DIGITS = new Map([
  ["I", 1],
  ["V", 5],
  ["X", 10],
  ["L", 50],
  ["C", 100],
  ["D", 500],
  ["M", 1000],
]);

function parseRomanOrdinalNumber(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[IVXLCDM]+$/u.test(text)) return null;
  let total = 0;
  let previous = 0;
  for (const ch of [...text].reverse()) {
    const current = ROMAN_DIGITS.get(ch);
    if (!current) return null;
    if (current < previous) total -= current;
    else {
      total += current;
      previous = current;
    }
  }
  return total > 0 ? total : null;
}

function latinChapterOrdinalFromTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const match = value.match(
    /^(CHAPTER|CHAPITRE|CAP[ÍI]TULO|CAPITULO|CAP[ÍI]TOL|CAPITOL|CAPITOLO|CANTO)\s+(PREMIER|PRIMEIRO|PRIMERO|PRIMO|[IVXLCDM]+|\d+)\b/iu,
  );
  if (!match) return null;
  const raw = match[2].toUpperCase();
  const n =
    raw === "PREMIER" || raw === "PRIMEIRO" || raw === "PRIMERO" || raw === "PRIMO"
      ? 1
      : /^\d+$/u.test(raw)
        ? Number(raw)
        : parseRomanOrdinalNumber(raw);
  return n ? { kind: match[1].toUpperCase(), n } : null;
}

function sequenceGapWarnings(kind, numbers) {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  const max = unique[unique.length - 1];
  const expected = max - min + 1;
  if (min > 2 || expected < 8) return [];
  const missing = [];
  const seen = new Set(unique);
  for (let n = min; n <= max; n += 1) {
    if (!seen.has(n)) missing.push(n);
  }
  if (!missing.length) return [];
  const shown = compactNumberRanges(missing).slice(0, 8).join(", ");
  const suffix = missing.length > 8 ? ", ..." : "";
  return [`${kind} headings have numbering gaps: missing ${shown}${suffix}`];
}

function chineseOrdinalSequenceWarnings(titles) {
  const byKind = new Map();
  for (const title of titles) {
    const ordinal = chineseOrdinalFromTitle(title);
    if (!ordinal) continue;
    const rows = byKind.get(ordinal.kind) || [];
    rows.push(ordinal.n);
    byKind.set(ordinal.kind, rows);
  }

  const warnings = [];
  for (const [kind, numbers] of byKind.entries()) {
    if (numbers.length >= 8) {
      const inversions = numbers
        .slice(1)
        .filter((n, index) => n < numbers[index] && n !== 1).length;
      if (inversions) {
        warnings.push(`Chinese ${kind} headings are out of order`);
      }
      const duplicateCount = numbers.length - new Set(numbers).size;
      if (duplicateCount >= 2) {
        warnings.push(`Chinese ${kind} headings repeat ${duplicateCount} times`);
      }
    }
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    const min = unique[0];
    const max = unique[unique.length - 1];
    const expected = max - min + 1;
    const isChapterLike = kind === "回" || kind === "章";
    if (isChapterLike && min === 2 && unique.length >= 5) {
      warnings.push(`Chinese ${kind} headings have numbering gaps: missing 1`);
    }
    if (min > 2 || expected < (isChapterLike ? 5 : 8)) continue;
    const missing = [];
    const seen = new Set(unique);
    for (let n = min; n <= max; n += 1) {
      if (!seen.has(n)) missing.push(n);
    }
    if (!missing.length) continue;
    const missingRatio = missing.length / expected;
    const isLongVolumeRun = kind === "卷" && expected >= 20 && numbers.length >= 20;
    const isTightVolumeRun = kind === "卷" && expected >= 8 && missing.length >= 1;
    if (
      !isChapterLike &&
      !isLongVolumeRun &&
      !isTightVolumeRun &&
      (missing.length < 2 || missingRatio < 0.2)
    )
      continue;
    const shown = compactNumberRanges(missing).slice(0, 8).join(", ");
    const suffix = missing.length > 8 ? ", ..." : "";
    warnings.push(`Chinese ${kind} headings have numbering gaps: missing ${shown}${suffix}`);
  }
  return warnings;
}

function trailingChineseOrdinalSequenceWarnings(titles) {
  const numbers = titles
    .map(trailingChineseOrdinalFromTitle)
    .filter(Boolean)
    .map((ordinal) => ordinal.n);
  if (numbers.length < 8) return [];
  const runs = [];
  let current = [];
  for (const n of numbers) {
    if (current.length && n === 1 && current[current.length - 1] > 1) {
      runs.push(current);
      current = [n];
    } else {
      current.push(n);
    }
  }
  if (current.length) runs.push(current);
  const warnings = [];
  for (const run of runs) {
    if (run.length < 8) continue;
    const inversions = run.slice(1).filter((n, index) => n < run[index] && n !== 1).length;
    if (inversions) warnings.push("Chinese 篇尾第 headings are out of order");
    const unique = [...new Set(run)].sort((a, b) => a - b);
    const min = unique[0];
    const max = unique[unique.length - 1];
    const expected = max - min + 1;
    if (min > 2 || expected < 8) continue;
    const missing = [];
    const seen = new Set(unique);
    for (let n = min; n <= max; n += 1) {
      if (!seen.has(n)) missing.push(n);
    }
    if (!missing.length) continue;
    const shown = compactNumberRanges(missing).slice(0, 8).join(", ");
    const suffix = missing.length > 8 ? ", ..." : "";
    warnings.push(`Chinese 篇尾第 headings have numbering gaps: missing ${shown}${suffix}`);
  }
  return warnings;
}

function latinOrdinalSequenceWarnings(titles) {
  const warnings = [];
  const byKind = new Map();
  for (const title of titles) {
    const ordinal = latinChapterOrdinalFromTitle(title);
    if (!ordinal) continue;
    const segments = byKind.get(ordinal.kind) || [[]];
    const current = segments[segments.length - 1];
    const previous = current[current.length - 1];
    if (previous != null && ordinal.n <= previous) segments.push([ordinal.n]);
    else current.push(ordinal.n);
    byKind.set(ordinal.kind, segments);
  }
  for (const [kind, segments] of byKind.entries()) {
    for (const segment of segments) {
      if (segment.length >= 4 && Math.min(...segment) > 2) {
        warnings.push(`${kind} headings have numbering gaps: start at ${Math.min(...segment)}`);
      } else {
        warnings.push(...sequenceGapWarnings(kind, segment));
      }
    }
  }
  return warnings;
}

function pureRomanSequenceWarnings(titles) {
  const pureRomanTitles = titles.filter(isPureRomanHeading);
  if (pureRomanTitles.length < 8 || pureRomanTitles.length / Math.max(1, titles.length) <= 0.65)
    return [];
  const hasPartMarkers = titles.some((title) =>
    /\b(?:part|book|livre|partie|tome)\b/iu.test(title),
  );
  if (hasPartMarkers) return [];
  const numbers = pureRomanTitles
    .map((title) => parseRomanOrdinalNumber(String(title).replace(/[.\s]+$/u, "")))
    .filter(Boolean);
  if (numbers.length < 8) return [];
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  if (min > 2) {
    return [`Pure roman-numeral headings start at ${min}, likely incomplete TOC`];
  }
  return sequenceGapWarnings("Pure roman-numeral", unique);
}

function leadingRomanOrdinalFromTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const match = value.match(/^([IVXLCDM]+)[.)]?\s+\S/iu);
  if (!match) return null;
  return parseRomanOrdinalNumber(match[1]);
}

function leadingRomanSequenceWarnings(titles) {
  const numbers = titles.map(leadingRomanOrdinalFromTitle).filter(Boolean);
  if (numbers.length < 8) return [];
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  if (min > 2) {
    return [`Leading roman-numeral headings start at ${min}, likely incomplete TOC`];
  }
  return sequenceGapWarnings("Leading roman-numeral", unique);
}

function generatedChapterTitleWarnings(titles) {
  const generated = titles.filter((title) => /^chapter\s+\d+$/iu.test(String(title || "").trim()));
  if (generated.length >= 2 && generated.length < titles.length) {
    return [`TOC has ${generated.length} generated-looking Chapter N headings`];
  }
  return [];
}

function malformedRomanFragmentWarnings(titles) {
  const fragments = titles.filter((title) =>
    /^[IVXLCDM]+\s*["“”]/iu.test(String(title || "").trim()),
  );
  if (fragments.length) {
    return [`TOC has ${fragments.length} malformed roman-fragment headings`];
  }
  return [];
}

function abbreviatedKapOrdinalFromTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const match = value.match(/^KAP\.?\s+([IVXLCDM]+|\d+)\b/iu);
  if (!match) return null;
  return /^\d+$/u.test(match[1]) ? Number(match[1]) : parseRomanOrdinalNumber(match[1]);
}

function abbreviatedKapSequenceWarnings(titles) {
  const numbers = titles.map(abbreviatedKapOrdinalFromTitle).filter(Boolean);
  if (numbers.length < 4) return [];
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  if (min > 2) {
    return [`KAP. headings have numbering gaps: start at ${min}`];
  }
  return sequenceGapWarnings("KAP.", unique);
}

const DUTCH_ORDINALS = new Map([
  ["eerste", 1],
  ["tweede", 2],
  ["derde", 3],
  ["vierde", 4],
  ["vyfde", 5],
  ["vijfde", 5],
  ["zesde", 6],
  ["zevende", 7],
  ["achtste", 8],
  ["negende", 9],
  ["tiende", 10],
  ["elfde", 11],
  ["twaalfde", 12],
  ["dertiende", 13],
  ["veertiende", 14],
  ["vyftiende", 15],
  ["vijftiende", 15],
  ["zestiende", 16],
  ["zeventiende", 17],
  ["achttiende", 18],
  ["negentiende", 19],
  ["twintigste", 20],
  ["eenentwintigste", 21],
  ["tweeentwintigste", 22],
  ["drieentwintigste", 23],
  ["vierentwintigste", 24],
]);

function parseDutchOrdinalToken(token) {
  const value = String(token || "").toLowerCase();
  if (/^\d+$/u.test(value)) return Number(value);
  if (/^[ivxlcdm]+$/iu.test(value)) return parseRomanOrdinalNumber(value);
  return DUTCH_ORDINALS.get(value) || null;
}

function dutchOrdinalFromTitle(title) {
  const value = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const prefix = value.match(/^hoofdstuk\s+([a-z0-9ivxlcdm]+)\b/u);
  if (prefix) return parseDutchOrdinalToken(prefix[1]);
  const suffix = value.match(/^([a-z0-9ivxlcdm]+)\s+hoofdstuk\b/u);
  if (suffix) return parseDutchOrdinalToken(suffix[1]);
  return null;
}

function dutchOrdinalSequenceWarnings(titles) {
  const numbers = titles.map(dutchOrdinalFromTitle).filter(Boolean);
  if (numbers.length < 4) return [];
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  if (min > 2) {
    return [`Dutch Hoofdstuk headings have numbering gaps: start at ${min}`];
  }
  return sequenceGapWarnings("Dutch Hoofdstuk", unique);
}

const SWEDISH_ORDINALS = new Map([
  ["forsta", 1],
  ["andra", 2],
  ["tredje", 3],
  ["fjarde", 4],
  ["femte", 5],
  ["sjatte", 6],
  ["sjunde", 7],
  ["attonde", 8],
  ["nionde", 9],
  ["tionde", 10],
  ["elfte", 11],
  ["tolfte", 12],
  ["trettonde", 13],
  ["fjortonde", 14],
  ["femtonde", 15],
  ["sextonde", 16],
  ["sjuttonde", 17],
  ["artonde", 18],
  ["nittonde", 19],
  ["tjugonde", 20],
  ["tjuguforsta", 21],
  ["tjuguandra", 22],
  ["tjugutredje", 23],
  ["tjugufjarde", 24],
  ["tjugufemte", 25],
]);

function swedishOrdinalFromTitle(title) {
  const value = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const match = value.match(/^([a-z]+)\s+kapitl?et\b/u);
  if (!match) return null;
  return SWEDISH_ORDINALS.get(match[1]) || null;
}

function swedishOrdinalSequenceWarnings(titles) {
  const numbers = titles.map(swedishOrdinalFromTitle).filter(Boolean);
  if (numbers.length < 4) return [];
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  if (min > 2) {
    return [`Swedish Kapitlet headings have numbering gaps: start at ${min}`];
  }
  return sequenceGapWarnings("Swedish Kapitlet", unique);
}

const FINNISH_ORDINALS = new Map([
  ["ensimmainen", 1],
  ["toinen", 2],
  ["kolmas", 3],
  ["neljas", 4],
  ["viides", 5],
  ["kuudes", 6],
  ["seitsemas", 7],
  ["kahdeksas", 8],
  ["yhdeksas", 9],
  ["kymmenes", 10],
  ["yhdestoista", 11],
  ["kahdestoista", 12],
  ["kolmastoista", 13],
  ["neljastoista", 14],
  ["viidestoista", 15],
  ["kuudestoista", 16],
  ["seitsemastoista", 17],
  ["kahdeksastoista", 18],
  ["yhdeksastoista", 19],
  ["kahdeskymmenes", 20],
  ["yhdeskolmatta", 21],
  ["kahdeskolmatta", 22],
  ["kolmaskolmatta", 23],
]);

function finnishOrdinalFromTitle(title) {
  const value = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const match = value.match(/^([a-z]+)\s+(luku|naytos)\b/u);
  if (!match) return null;
  const n = FINNISH_ORDINALS.get(match[1]);
  return n ? { kind: match[2] === "naytos" ? "NÄYTÖS" : "LUKU", n } : null;
}

function finnishOrdinalSequenceWarnings(titles) {
  const byKind = new Map();
  for (const title of titles) {
    const ordinal = finnishOrdinalFromTitle(title);
    if (!ordinal) continue;
    const rows = byKind.get(ordinal.kind) || [];
    rows.push(ordinal.n);
    byKind.set(ordinal.kind, rows);
  }
  const warnings = [];
  for (const [kind, numbers] of byKind.entries()) {
    if (numbers.length < 2) continue;
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    const min = unique[0];
    if (min > 2) {
      warnings.push(`Finnish ${kind} headings have numbering gaps: start at ${min}`);
    } else {
      warnings.push(...sequenceGapWarnings(`Finnish ${kind}`, unique));
    }
  }
  return warnings;
}

const NORDIC_ORDINALS = new Map([
  ["forste", 1],
  ["første", 1],
  ["anden", 2],
  ["andre", 2],
  ["tredje", 3],
  ["fjerde", 4],
  ["femte", 5],
  ["sjette", 6],
  ["syvende", 7],
  ["sjuende", 7],
  ["ottende", 8],
  ["åttende", 8],
  ["niende", 9],
  ["tiende", 10],
  ["ellevte", 11],
  ["tolvte", 12],
  ["trettende", 13],
  ["fjortende", 14],
  ["femtende", 15],
  ["sekstende", 16],
  ["syttende", 17],
  ["attende", 18],
  ["nittende", 19],
  ["tyvende", 20],
  ["enogtyvende", 21],
  ["toogtyvende", 22],
  ["treogtyvende", 23],
  ["fireogtyvende", 24],
  ["femogtyvende", 25],
  ["seksogtyvende", 26],
  ["syvogtyvende", 27],
  ["otteogtyvende", 28],
  ["åtteogtyvende", 28],
  ["niogtyvende", 29],
  ["trettiende", 30],
  ["tredivte", 30],
  ["trettiforste", 31],
  ["trettiførste", 31],
  ["trettienede", 31],
]);

function nordicOrdinalFromTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const match = value.match(/^([a-zæøå]+)\s+(akt|handling|stykke)\b/u);
  if (!match) return null;
  const n = NORDIC_ORDINALS.get(match[1]);
  return n ? { kind: match[2].toUpperCase(), n } : null;
}

function nordicOrdinalSequenceWarnings(titles) {
  const byKind = new Map();
  for (const title of titles) {
    const ordinal = nordicOrdinalFromTitle(title);
    if (!ordinal) continue;
    const rows = byKind.get(ordinal.kind) || [];
    rows.push(ordinal.n);
    byKind.set(ordinal.kind, rows);
  }
  const warnings = [];
  for (const [kind, numbers] of byKind.entries()) {
    if (numbers.length < 2) continue;
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    const min = unique[0];
    if (min > 2) {
      warnings.push(`Nordic ${kind} headings have numbering gaps: start at ${min}`);
    } else {
      const max = unique[unique.length - 1];
      const seen = new Set(unique);
      const missing = [];
      for (let n = min; n <= max; n += 1) {
        if (!seen.has(n)) missing.push(n);
      }
      if (missing.length) {
        warnings.push(
          `Nordic ${kind} headings have numbering gaps: missing ${compactNumberRanges(missing).join(", ")}`,
        );
      }
    }
  }
  return warnings;
}

const GERMAN_ORDINALS = new Map([
  ["erstes", 1],
  ["zweites", 2],
  ["drittes", 3],
  ["viertes", 4],
  ["fünftes", 5],
  ["funftes", 5],
  ["sechstes", 6],
  ["siebentes", 7],
  ["siebtes", 7],
  ["achtes", 8],
  ["neuntes", 9],
  ["zehntes", 10],
]);

function germanOrdinalFromTitle(title) {
  const value = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const match = value.match(/^([a-z]+)\s+kapitel\b/u);
  if (!match) return null;
  return GERMAN_ORDINALS.get(match[1]) || null;
}

function germanOrdinalSequenceWarnings(titles) {
  const numbers = titles.map(germanOrdinalFromTitle).filter(Boolean);
  if (numbers.length < 3) return [];
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const min = unique[0];
  const max = unique[unique.length - 1];
  const expected = max - min + 1;
  if (expected < 5) return [];
  const seen = new Set(unique);
  const missing = [];
  for (let n = min; n <= max; n += 1) {
    if (!seen.has(n)) missing.push(n);
  }
  if (!missing.length) return [];
  const missingRatio = missing.length / expected;
  if (missingRatio < 0.25) return [];
  const shown = compactNumberRanges(missing).slice(0, 8).join(", ");
  const suffix = missing.length > 8 ? ", ..." : "";
  return [`German Kapitel headings have numbering gaps: missing ${shown}${suffix}`];
}

function chineseLatinNoiseTitleWarnings(titles, options = {}) {
  if (options.lang !== "zh") return [];
  const noisy = titles.filter((title) => {
    const value = String(title || "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^[A-Z]{1,4}$/u.test(value) && !/^[IVXLCDM]+$/u.test(value)) return true;
    if (!/\p{Script=Han}/u.test(value) || !/[A-Za-z]/u.test(value)) return false;
    if (/^附錄[A-Z]\b/u.test(value)) return false;
    return /[a-z]/u.test(value) || /[A-Z]/u.test(value);
  });
  return noisy.length ? [`Chinese TOC has ${noisy.length} Latin-noise headings`] : [];
}

function chineseRecitationTitleWarnings(titles, options = {}) {
  if (options.lang !== "zh") return [];
  const bad = titles.filter((title) => {
    const value = String(title || "")
      .replace(/\s+/g, " ")
      .trim();
    return CHINESE_CHAPTER_PREFIX_RE.test(value) && /\s+(?:詩曰|诗曰|詞曰|词曰)[:：]/u.test(value);
  });
  return bad.length ? [`Chinese TOC has ${bad.length} recitation-marker headings`] : [];
}

function chineseOrdinalRunInterruptionWarnings(titles, options = {}) {
  if (options.lang !== "zh" || titles.length < 6) return [];
  const ordinalCount = titles.filter((title) => chineseOrdinalFromTitle(title)).length;
  if (ordinalCount < 5 || ordinalCount / titles.length < 0.45) return [];
  const interrupted = [];
  for (let index = 1; index < titles.length - 1; index += 1) {
    const title = String(titles[index] || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !/\p{Script=Han}/u.test(title)) continue;
    if (chineseOrdinalFromTitle(title)) continue;
    if (/^(?:評|评|序|跋|自序|序言|例言|目錄|目录|附錄|附录|附記|附记|後記|后记)$/u.test(title))
      continue;
    if ([...title].length > 24) continue;
    const previous = chineseOrdinalFromTitle(titles[index - 1]);
    const next = chineseOrdinalFromTitle(titles[index + 1]);
    if (!previous || !next || previous.kind !== next.kind) continue;
    if (next.n !== previous.n + 1) continue;
    interrupted.push(title);
  }
  return interrupted.length
    ? [`Chinese ordinal chapter run has ${interrupted.length} non-ordinal interruption headings`]
    : [];
}

function chapterQualityWarnings(chapters, options = {}) {
  const maxChapters = options.maxChapters || MAX_CHAPTERS_FOR_AUTO_PUBLISH;
  const titles = chapters.map((chapter) => String(chapter.title || "").trim()).filter(Boolean);
  const text = chapters.map((chapter) => chapter.text || "").join("\n\n");
  const warnings = [];
  warnings.push(...garbledTextWarnings(text));
  warnings.push(...chinesePlaceholderTitleWarnings(titles));
  warnings.push(...chineseGarbledTitleWarnings(titles));
  warnings.push(...chineseTocFragmentWarnings(titles));
  warnings.push(...chineseOrdinalSequenceWarnings(titles));
  warnings.push(...trailingChineseOrdinalSequenceWarnings(titles));
  warnings.push(...latinOrdinalSequenceWarnings(titles));
  warnings.push(...pureRomanSequenceWarnings(titles));
  warnings.push(...leadingRomanSequenceWarnings(titles));
  warnings.push(...generatedChapterTitleWarnings(titles));
  warnings.push(...malformedRomanFragmentWarnings(titles));
  warnings.push(...abbreviatedKapSequenceWarnings(titles));
  warnings.push(...dutchOrdinalSequenceWarnings(titles));
  warnings.push(...swedishOrdinalSequenceWarnings(titles));
  warnings.push(...finnishOrdinalSequenceWarnings(titles));
  warnings.push(...nordicOrdinalSequenceWarnings(titles));
  warnings.push(...germanOrdinalSequenceWarnings(titles));
  warnings.push(...japaneseProseHeadingWarnings(titles));
  warnings.push(...chineseLatinNoiseTitleWarnings(titles, options));
  warnings.push(...chineseRecitationTitleWarnings(titles, options));
  warnings.push(...chineseOrdinalRunInterruptionWarnings(titles, options));
  if (chapters.length > maxChapters) {
    warnings.push(`EPUB produced ${chapters.length} chapters, likely an index/dictionary split`);
  }
  if (titles.length >= 12) {
    const terse = titles.filter(
      (title) =>
        (!/^[\p{Script=Han}]{2,12}$/u.test(title) &&
          !isLikelyValidOrdinalHeading(title) &&
          (title.length <= 4 || /^(?:\d+|[A-Z])\.?$/i.test(title))) ||
        /^(?:V|M|F)\.\s*(?:i|p|t|pl|ant|gram|fig|fam)\.?/i.test(title),
    );
    if (terse.length / titles.length > 0.65) {
      warnings.push(
        `TOC has ${((terse.length / titles.length) * 100).toFixed(0)}% terse/generated-looking headings`,
      );
    }
  }
  if (titles.length >= 12) {
    const pureRoman = titles.filter(isPureRomanHeading);
    const hasPartMarkers = titles.some((title) =>
      /\b(?:part|book|livre|partie|tome)\b/iu.test(title),
    );
    if (!hasPartMarkers && pureRoman.length / titles.length > 0.65) {
      warnings.push(
        `TOC has ${((pureRoman.length / titles.length) * 100).toFixed(0)}% pure roman-numeral headings`,
      );
    }
  }
  if (titles.length >= 5) {
    const duplicateCount = [
      ...titles
        .map(normalizedChapterHeading)
        .filter((title) => title.length >= 4)
        .reduce((counts, title) => counts.set(title, (counts.get(title) || 0) + 1), new Map())
        .values(),
    ].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    if (duplicateCount >= 3 && duplicateCount / titles.length > 0.4) {
      warnings.push(`TOC has ${duplicateCount} duplicate-looking chapter headings`);
    }
  }
  if (titles.length >= 12) {
    const bodyFragments = titles.filter(isBodyFragmentHeading);
    if (bodyFragments.length >= 3 && bodyFragments.length / titles.length > 0.08) {
      warnings.push(
        `TOC has ${bodyFragments.length} body-fragment-looking headings, likely body text or footnotes`,
      );
    }
  }
  const proseFragments = titles.filter(isProseFragmentHeading);
  if (proseFragments.length) {
    warnings.push(`TOC has ${proseFragments.length} prose-fragment-looking headings`);
  }
  return warnings;
}

function assertImportQuality(book, chapters) {
  let warnings = chapterQualityWarnings(chapters, {
    maxChapters: book.maxChapters,
    lang: book.lang,
  });
  if (book.allowSparseTrailingOrdinals) {
    warnings = warnings.filter(
      (warning) => !/^Chinese 篇尾第 headings have numbering gaps/.test(warning),
    );
  }
  if (book.allowSparseVolumeOrdinals) {
    warnings = warnings.filter(
      (warning) => !/^Chinese 卷 headings have numbering gaps/.test(warning),
    );
  }
  if (book.allowProseFragmentTitles) {
    warnings = warnings.filter(
      (warning) => !/^TOC has \d+ prose-fragment-looking headings/.test(warning),
    );
  }
  if (book.minChapters && chapters.length < book.minChapters) {
    warnings.unshift(
      `EPUB produced ${chapters.length} chapters, expected at least ${book.minChapters}`,
    );
  }
  const maxChapters = book.maxChapters || MAX_CHAPTERS_FOR_AUTO_PUBLISH;
  if (
    chapters.length > maxChapters ||
    warnings.some((warning) =>
      /garbled|mojibake|replacement|duplicate-looking|body-fragment|prose-fragment|generated-looking|toc-fragment|roman-numeral|expected at least|numbering gaps|placeholder|latin-noise|garbled-symbol|recitation-marker|non-ordinal interruption/i.test(
        warning,
      ),
    )
  ) {
    throw new Error(`Rejected ${book.id} #${book.pg}: ${warnings[0]}`);
  }
  return warnings;
}

function normalizedTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSameNormalizedTitle(a, b) {
  const left = normalizedTitle(a);
  const right = normalizedTitle(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function isGutenbergMatterTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const folded = normalizedTitle(value);
  const matterTitles = new Set([
    "register",
    "notoj",
    "notatki",
    "nota",
    "noter",
    "le fonti",
    "viiteselitykset",
    "labjegyzetek",
    "innehallsforteckning",
    "verkaro de d ro l l zamenhof",
  ]);
  return (
    /^(?:contents?|table of contents|inhoudsopgave|inhoud\.?|tartalom\.?|inneh[åa]ll(?:sförteckning)?\.?:?|index\b.*|notes?:|noten\b.*|footnotes?|fodnoter|colophon|colofon|transcriber(?:'|’)?s notes?|javit[aá]sok\.?|afskriverens rettelser|corrigenda|errata|fi)$/iu.test(
      value,
    ) ||
    /^I N D E X$/iu.test(value) ||
    /^T A R T A L O M$/iu.test(value) ||
    /^[*＊\s]+$/u.test(value) ||
    /^הערת עורך/u.test(value) ||
    /^(?:後記|あとがき)$/u.test(value) ||
    folded === "javitasok" ||
    matterTitles.has(folded)
  );
}

function isShortTitlePage(book, chapter, index, total) {
  if (book.keepLeadingTitleChapter) return false;
  if (total <= 1 || index !== 0) return false;
  const text = String(chapter.text || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 2200 && isSameNormalizedTitle(chapter.title, book.title);
}

function isShortGeneratedCredit(chapter) {
  const title = String(chapter.title || "")
    .replace(/\s+/g, " ")
    .trim();
  return title.length < 120 && /,\s+by\s+/i.test(title);
}

function isShortLeadingRomanPage(chapter, index, total) {
  if (total <= 1 || index !== 0) return false;
  const title = String(chapter.title || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = String(chapter.text || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 1200 && /^(?:[IVXLCDM]+\.?)$/i.test(title);
}

function isShortPartMarkerChapter(chapter) {
  const title = String(chapter.title || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = String(chapter.text || "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    text.length < 400 &&
    /^(?:livre|book|part|partie|tome|premi[eè]re partie|deuxi[eè]me partie|troisi[eè]me partie)\b/iu.test(
      title,
    )
  );
}

function splitTextMarkerChapters(book, chapters) {
  const markers = Array.isArray(book.splitTextMarkers) ? book.splitTextMarkers : [];
  if (!markers.length) return chapters;
  const out = [];
  for (const chapter of chapters) {
    const marker = markers.find(
      (row) => normalizedTitle(row.title) === normalizedTitle(chapter.title),
    );
    if (!marker) {
      out.push({ ...chapter });
      continue;
    }
    const text = String(chapter.text || "");
    const re = new RegExp(
      `(^|\\n{2,})${escapeRegExp(marker.marker)}(?=\\s|　|[，。！？；;:：,.!?]|$)`,
      "u",
    );
    const match = text.match(re);
    if (!match || match.index == null || match.index <= 0) {
      out.push({ ...chapter });
      continue;
    }
    const prefixEnd = match.index + (match[1] || "").length;
    const suffixStart = marker.keepMarkerInNewChapter ? prefixEnd : match.index + match[0].length;
    const before = text.slice(0, prefixEnd).trim();
    const after = text.slice(suffixStart).trim();
    if (!before || !after) {
      out.push({ ...chapter });
      continue;
    }
    out.push({ ...chapter, title: marker.beforeTitle || chapter.title, text: before });
    out.push({
      ...chapter,
      title: marker.newTitle || marker.marker,
      text: after,
    });
  }
  return out;
}

function replaceConfiguredChineseTitle(book, title) {
  const replacements = Array.isArray(book.titleReplacements) ? book.titleReplacements : [];
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const replacement = replacements.find(
    (row) =>
      String(row.from || "")
        .replace(/\s+/g, " ")
        .trim() === value,
  );
  return replacement?.to || title;
}

const CHINESE_APPENDIX_LETTERS = new Map([
  ["A", "甲"],
  ["B", "乙"],
  ["C", "丙"],
  ["D", "丁"],
]);

function normalizeChineseDisplayTitle(title) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*(?:回|章|卷|節|节|篇|出))\\s*\\?{3,}\\s*`, "u"),
      "$1 ",
    )
    .replace(/^[《〈〔【]([^《》〈〉〔〕【】]{1,40})[》〉〕】]$/u, "$1")
    .replace(
      /^附錄([A-D])([‧·・．.])/u,
      (_, letter, sep) => `附錄${CHINESE_APPENDIX_LETTERS.get(letter) || letter}${sep}`,
    );
}

function mergeShortChineseReviewChapters(chapters) {
  const out = [];
  for (const chapter of chapters) {
    const title = String(chapter.title || "")
      .replace(/\s+/g, " ")
      .trim();
    const text = String(chapter.text || "").trim();
    if (/^(?:評|评)$/u.test(title) && out.length && text.length <= 600) {
      const previous = out[out.length - 1];
      previous.text = [previous.text, title, text].filter(Boolean).join("\n\n");
      continue;
    }
    out.push({ ...chapter });
  }
  return out;
}

function isShortChineseInterludeTitle(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /^[\p{Script=Han}]{2,6}$/u.test(value) &&
    !chineseOrdinalFromTitle(value) &&
    !trailingChineseOrdinalFromTitle(value) &&
    !new RegExp(`^(?:補遺)?卷${HAN_ORDINAL_RE}$`, "u").test(value) &&
    !/^(?:評|评|序|跋|自序|序言|例言|目錄|目录|附錄|附录|附記|附记|後記|后记)$/u.test(value)
  );
}

function shouldMergeShortChineseInterludes(chapters) {
  const ordinalCount = chapters.filter((chapter) => chineseOrdinalFromTitle(chapter.title)).length;
  const interludeCount = chapters.filter((chapter) =>
    isShortChineseInterludeTitle(chapter.title),
  ).length;
  return (
    ordinalCount >= 5 && interludeCount >= 1 && ordinalCount / Math.max(1, chapters.length) >= 0.45
  );
}

function mergeShortChineseInterludeChapters(chapters) {
  if (!shouldMergeShortChineseInterludes(chapters)) return chapters;
  const out = [];
  for (const chapter of chapters) {
    const title = String(chapter.title || "")
      .replace(/\s+/g, " ")
      .trim();
    const previous = out[out.length - 1];
    if (
      previous &&
      chineseOrdinalFromTitle(previous.title) &&
      isShortChineseInterludeTitle(title)
    ) {
      previous.text = [previous.text, title, chapter.text].filter(Boolean).join("\n\n");
      continue;
    }
    out.push({ ...chapter });
  }
  return out;
}

const CHINESE_RECITATION_MARKER_RE =
  /(?:詩曰|诗曰|詞曰|词曰|詩云|诗云|詞云|词云|贊曰|赞曰|贊云|赞云)/u;

function splitChineseTitleRecitationTail(title) {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const marker = value.match(
    /\s+(?=(?:詩曰|诗曰|詞曰|词曰|詩云|诗云|詞云|词云|贊曰|赞曰|贊云|赞云)[:：])/u,
  );
  if (!marker || marker.index == null) return { title: value, tail: "" };
  return {
    title: value.slice(0, marker.index).trim(),
    tail: value.slice(marker.index + marker[0].length).trim(),
  };
}

function leadingChineseTitleContinuation(text) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  const marker = value.match(
    /^([\p{Script=Han}]{4,24})\s+(?=(?:詩曰|诗曰|詞曰|词曰|詩云|诗云|詞云|词云|贊曰|赞曰|贊云|赞云)[:：])/u,
  );
  if (marker) return { title: marker[1].trim(), rest: value.slice(marker[1].length).trimStart() };
  const prose = value.match(/^([\p{Script=Han}]{4,18})\s+(?=[\p{Script=Han}]{2,14}[，。！？；;])/u);
  if (prose && !CHINESE_RECITATION_MARKER_RE.test(prose[1])) {
    return { title: prose[1].trim(), rest: value.slice(prose[1].length).trimStart() };
  }
  return null;
}

function repairChukePaianJingqiChapters(book, chapters) {
  if (book.id !== "chuke-paian-jingqi-gutenberg-zh") return chapters;
  return chapters.map((chapter) => {
    const split = splitChineseTitleRecitationTail(chapter.title);
    let title = split.title;
    let text = [split.tail, chapter.text].filter(Boolean).join("\n\n").trim();
    const titleBody =
      title.match(new RegExp(`^第\\s*${HAN_ORDINAL_RE}\\s*卷\\s*(.+)$`, "u"))?.[1]?.trim() || "";
    if (titleBody && !/\s/u.test(titleBody)) {
      const continuation = leadingChineseTitleContinuation(text);
      if (continuation) {
        title = `${title} ${continuation.title}`.trim();
        text = continuation.rest;
      }
    }
    return { ...chapter, title, text };
  });
}

function repairShenlouZhiChapters(book, chapters) {
  if (book.id !== "shenlou-zhi-gutenberg-zh") return chapters;
  return chapters.filter((chapter, index) => {
    const ordinal = chineseOrdinalFromTitle(chapter.title);
    const nextOrdinal = chineseOrdinalFromTitle(chapters[index + 1]?.title);
    if (!ordinal || !nextOrdinal || ordinal.kind !== "卷" || nextOrdinal.kind !== "卷") return true;
    if (ordinal.n <= nextOrdinal.n) return true;
    return !chapters
      .slice(index + 1)
      .some((later) => normalizedTitle(later.title) === normalizedTitle(chapter.title));
  });
}

function repairKuoyiZhiChapters(book, chapters) {
  if (book.id !== "kuoyi-zhi-gutenberg-zh") return chapters;
  if (chapters.length % 2 !== 0) return chapters;
  const half = chapters.length / 2;
  if (half < 6) return chapters;
  const first = chapters.slice(0, half);
  const second = chapters.slice(half);
  const sameVolumeRun = first.every(
    (chapter, index) =>
      normalizedTitle(chapter.title) === normalizedTitle(second[index]?.title) &&
      chineseOrdinalFromTitle(chapter.title)?.kind === "卷",
  );
  if (!sameVolumeRun) return chapters;
  const firstText = first.reduce((sum, chapter) => sum + String(chapter.text || "").length, 0);
  const secondText = second.reduce((sum, chapter) => sum + String(chapter.text || "").length, 0);
  return firstText < secondText ? second : chapters;
}

function repairShanghanLunChapters(book, chapters) {
  if (book.id !== "shanghan-lun-gutenberg-zh") return chapters;
  const out = [];
  for (const chapter of chapters) {
    const title = String(chapter.title || "")
      .replace(/\s+/g, " ")
      .trim();
    const previous = out[out.length - 1];
    if (previous && /^辨少陽病脈證並治第九$/u.test(title)) {
      previous.text = [previous.text, title, chapter.text].filter(Boolean).join("\n\n");
      continue;
    }
    out.push({ ...chapter });
  }
  return out;
}

function repairKongcongziChapters(book, chapters) {
  if (book.id !== "kongcongzi-gutenberg-zh") return chapters;
  const out = [];
  const xiaoeerya = [];
  for (const chapter of chapters) {
    const title = String(chapter.title || "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^〈廣(?:詁|言|訓|義|名|服|噐（器）|物|鳥|獸)〉第/u.test(title)) {
      xiaoeerya.push(chapter);
      continue;
    }
    if (/^〈公孫龍〉第十二$/u.test(title) && xiaoeerya.length) {
      out.push({
        n: 0,
        title: "〈小爾雅〉第十一",
        text: xiaoeerya
          .map((item) => [item.title, item.text].filter(Boolean).join("\n\n"))
          .join("\n\n")
          .trim(),
      });
      xiaoeerya.length = 0;
    }
    out.push(chapter);
  }
  if (xiaoeerya.length) {
    out.push({
      n: 0,
      title: "〈小爾雅〉第十一",
      text: xiaoeerya
        .map((item) => [item.title, item.text].filter(Boolean).join("\n\n"))
        .join("\n\n")
        .trim(),
    });
  }
  return out;
}

function removeExactDuplicateChapters(chapters) {
  const seen = new Set();
  const out = [];
  for (const chapter of chapters) {
    const key = `${normalizedTitle(chapter.title)}\u0000${String(chapter.text || "")
      .replace(/\s+/g, " ")
      .trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...chapter });
  }
  return out;
}

function repairMudantingChapters(book, chapters) {
  if (book.id !== "mudanting-gutenberg-zh") return chapters;
  const rows = chapters.map((chapter, index) => ({
    chapter,
    index,
    ordinal: chineseOrdinalFromTitle(chapter.title),
  }));
  if (!rows.every((row) => row.ordinal?.kind === "出")) return chapters;
  const numbers = rows.map((row) => row.ordinal.n);
  const unique = new Set(numbers);
  if (unique.size !== rows.length) return chapters;
  const max = Math.max(...numbers);
  if (
    max !== rows.length ||
    !Array.from({ length: max }, (_, index) => unique.has(index + 1)).every(Boolean)
  )
    return chapters;
  return rows
    .sort((a, b) => a.ordinal.n - b.ordinal.n || a.index - b.index)
    .map((row) => row.chapter);
}

function insertConfiguredOrdinalPlaceholders(book, chapters) {
  const placeholders = Array.isArray(book.ordinalPlaceholders) ? book.ordinalPlaceholders : [];
  if (!placeholders.length || !chapters.length) return chapters;

  const out = chapters.map((chapter) => ({ ...chapter }));
  for (const placeholder of placeholders) {
    const kind = String(placeholder.kind || "").trim();
    const n = Number(placeholder.n);
    if (!kind || !Number.isFinite(n) || n <= 0) continue;
    const existing = out.some((chapter) => {
      const ordinal = chineseOrdinalFromTitle(chapter.title);
      return ordinal?.kind === kind && ordinal.n === n;
    });
    if (existing) continue;

    const insertAt = out.findIndex((chapter) => {
      const ordinal = chineseOrdinalFromTitle(chapter.title);
      return ordinal?.kind === kind && ordinal.n > n;
    });
    out.splice(insertAt < 0 ? out.length : insertAt, 0, {
      n: 0,
      title: String(placeholder.title || `第${n}${kind}（缺）`).trim(),
      text: String(
        placeholder.text ||
          "本章在 Project Gutenberg 原文中标为缺失；此处保留目录占位，避免章节编号错位。",
      ).trim(),
    });
  }
  return out;
}

function replaceChineseActOrdinal(title, n) {
  return String(title || "").replace(
    new RegExp(`^第\\s*${HAN_ORDINAL_RE}\\s*出`, "u"),
    `第${formatHanNumber(n)}出`,
  );
}

function repairDuplicateActNumbers(book, chapters) {
  if (!book.repairDuplicateActNumbers || chapters.length < 3) return chapters;
  const out = chapters.map((chapter) => ({ ...chapter }));
  for (let index = 1; index < out.length; index += 1) {
    const previous = chineseOrdinalFromTitle(out[index - 1].title);
    const current = chineseOrdinalFromTitle(out[index].title);
    const next = index + 1 < out.length ? chineseOrdinalFromTitle(out[index + 1].title) : null;
    if (previous?.kind !== "出" || current?.kind !== "出") continue;
    const expected = previous.n + 1;
    if (current.n === expected) continue;
    if (next?.kind === "出" && next.n === expected + 1) {
      out[index] = {
        ...out[index],
        title: replaceChineseActOrdinal(out[index].title, expected),
      };
    }
  }
  return out;
}

function cleanGutenbergPayload(book, payload) {
  const chapters = payload.chapters || [];
  if (book.lang === "zh" && book.title) {
    payload.title = book.title;
  }
  if (book.mergeAsSingleChapter && chapters.length) {
    payload.chapters = [
      {
        ...chapters[0],
        n: 1,
        title: book.title,
        text: chapters
          .map((chapter) => [chapter.title, chapter.text].filter(Boolean).join("\n\n"))
          .join("\n\n")
          .trim(),
      },
    ];
    payload.blurb = payload.chapters[0]?.text?.slice(0, 120) || payload.blurb || "";
    return payload;
  }
  const skipTitles = new Set((book.skipTitles || []).map(normalizedTitle));
  const filtered = chapters.filter((chapter, index) => {
    if (skipTitles.has(normalizedTitle(chapter.title))) return false;
    if (isShortTitlePage(book, chapter, index, chapters.length)) return false;
    if (isGutenbergMatterTitle(chapter.title)) return false;
    if (isShortGeneratedCredit(chapter)) return false;
    if (isShortLeadingRomanPage(chapter, index, chapters.length)) return false;
    if (isShortPartMarkerChapter(chapter)) return false;
    return true;
  });
  const split = splitTextMarkerChapters(book, filtered);
  const withOrdinalPlaceholders = insertConfiguredOrdinalPlaceholders(book, split);
  const withActRepairs = repairDuplicateActNumbers(book, withOrdinalPlaceholders);
  const cleaned =
    book.lang === "zh"
      ? repairShanghanLunChapters(
          book,
          repairKongcongziChapters(
            book,
            repairMudantingChapters(
              book,
              repairKuoyiZhiChapters(
                book,
                repairShenlouZhiChapters(
                  book,
                  repairChukePaianJingqiChapters(
                    book,
                    removeExactDuplicateChapters(
                      mergeShortChineseInterludeChapters(
                        mergeShortChineseReviewChapters(withActRepairs),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : withActRepairs;
  if (!cleaned.length) return payload;
  payload.chapters = cleaned.map((chapter, index) => ({
    ...chapter,
    n: index + 1,
    title:
      book.lang === "zh"
        ? normalizeChineseDisplayTitle(
            trimChineseChapterTitleProseTail(replaceConfiguredChineseTitle(book, chapter.title)),
          )
        : chapter.title,
  }));
  if (book.lang === "zh" && payload.chapters.length === 1) {
    payload.chapters[0] = { ...payload.chapters[0], title: book.title };
  }
  payload.blurb = payload.chapters[0]?.text?.slice(0, 120) || payload.blurb || "";
  return payload;
}

async function download(url, filePath) {
  const res = await fetchWithRetry(url, {
    headers: { "user-agent": "liber-gutenberg-import/0.1" },
  });
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await writeFile(filePath, new Uint8Array(await res.arrayBuffer()));
}

async function downloadEpub(book, filePath) {
  const errors = [];
  for (const url of epubUrls(book)) {
    try {
      await download(url, filePath);
      return url;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join("; "));
}

async function downloadPlainText(book) {
  const errors = [];
  for (const url of plainTextUrls(book)) {
    try {
      const res = await fetchWithRetry(url, {
        headers: { "user-agent": "liber-gutenberg-import/0.1" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { url, text: await res.text() };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(errors.join("; "));
}

function cleanGutenbergPlainText(raw, textSource = {}) {
  let text = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  const start = text.match(/\*\*\*\s*START OF (?:THE )?PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  if (start?.index != null) text = text.slice(start.index + start[0].length);
  const end = text.search(/\*\*\*\s*END OF (?:THE )?PROJECT GUTENBERG EBOOK/i);
  if (end >= 0) text = text.slice(0, end);
  if (textSource.startPattern) {
    const marker = new RegExp(textSource.startPattern, "u").exec(text);
    if (marker?.index != null) text = text.slice(marker.index);
  }
  if (textSource.endPattern) {
    const marker = new RegExp(textSource.endPattern, "u").exec(text);
    if (marker?.index != null) text = text.slice(0, marker.index + marker[0].length);
  }
  return text
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanPlainTextLine(line) {
  return String(line || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/^[　\s]+|[　\s]+$/g, "")
    .trim();
}

function nextLineHuiSubtitle(line) {
  const value = cleanPlainTextLine(line);
  if (!value) return "";
  if ([...value.replace(/\s+/g, "")].length > 80) return "";
  if (!/\p{Script=Han}/u.test(value)) return "";
  if (/[，。！？；;:：、,.!?]/u.test(value)) return "";
  if (/^(?:話說|话说|卻說|却说|且說|且说|看官|詩曰|诗曰)/u.test(value)) return "";
  return value.replace(/\s+/g, " ").trim();
}

function parseSishierZhangjingParagraphs(text) {
  const paragraphs = String(text || "")
    .split(/\n\s*\n/u)
    .map((paragraph) =>
      paragraph.split("\n").map(cleanPlainTextLine).filter(Boolean).join("").trim(),
    )
    .filter(Boolean);
  const titleIndex = paragraphs.findIndex((paragraph) => /佛[說说]四十二章[經经]/u.test(paragraph));
  const firstTeachingIndex = paragraphs.findIndex(
    (paragraph, index) =>
      index > titleIndex &&
      /^(?:佛言|沙門問佛|沙门问佛|沙門夜誦|沙门夜诵|天神獻|天神献|佛問沙門|佛问沙门)/u.test(
        paragraph,
      ),
  );
  if (firstTeachingIndex < 0) return [];

  const introStart = titleIndex >= 0 ? titleIndex + 1 : 0;
  const intro = paragraphs
    .slice(introStart, firstTeachingIndex)
    .filter((paragraph) => !/^Produced\s*by/i.test(paragraph))
    .join("\n\n")
    .trim();

  const teachings = [];
  const seen = new Set();
  for (const paragraph of paragraphs.slice(firstTeachingIndex)) {
    if (
      !/^(?:佛言|沙門問佛|沙门问佛|沙門夜誦|沙门夜诵|天神獻|天神献|佛問沙門|佛问沙门)/u.test(
        paragraph,
      )
    )
      continue;
    const key = paragraph.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    teachings.push(paragraph);
    if (teachings.length === 42) break;
  }
  if (teachings.length !== 42) return [];

  return [
    {
      n: 1,
      title: "緣起",
      text: intro || "本篇为原文經名與譯者題記。",
    },
    ...teachings.map((paragraph, index) => ({
      n: index + 2,
      title: `第${formatHanNumber(index + 1)}章`,
      text: paragraph,
    })),
  ];
}

function paragraphBlocks(text) {
  return String(text || "")
    .split(/\n\s*\n/u)
    .map((paragraph) =>
      paragraph.split("\n").map(cleanPlainTextLine).filter(Boolean).join("").trim(),
    )
    .filter(Boolean);
}

function parseLineSectionChapters(text, textSource = {}) {
  const minChars = Number(textSource.minLineChars || 4);
  const titleSuffix = String(textSource.titleSuffix || "則").trim();
  const titleFromLineChars = Number(textSource.titleFromLineChars || 0);
  const skipPattern = textSource.skipLinePattern
    ? new RegExp(textSource.skipLinePattern, "u")
    : null;
  const lines = String(text || "")
    .split("\n")
    .map(cleanPlainTextLine)
    .filter(Boolean)
    .filter((line) => !/^Produced\s*by/i.test(line))
    .filter((line) => !skipPattern || !skipPattern.test(line))
    .filter((line) => [...line].length >= minChars);
  return lines.map((line, index) => ({
    n: index + 1,
    title:
      titleFromLineChars > 0
        ? [...line.replace(/\s+/g, "")]
            .slice(0, titleFromLineChars)
            .join("")
            .replace(/[，。、；：？！「」『』《》（）]+$/u, "")
        : `第${index + 1}${titleSuffix}`,
    text: line,
  }));
}

function markedLineSectionTitle(line, textSource = {}) {
  const value = cleanPlainTextLine(line);
  if (textSource.titlePattern) {
    const match = value.match(new RegExp(textSource.titlePattern, "u"));
    if (match?.[1]) return cleanPlainTextLine(match[1]);
  }
  return value
    .replace(/^[○●▲]\s*/u, "")
    .split(/[。；;，,]/u)[0]
    .trim();
}

function parseMarkedLineSectionChapters(text, textSource = {}) {
  const headingPattern = new RegExp(textSource.headingPattern || "^▲", "u");
  const skipBodyPattern = textSource.skipBodyLinePattern
    ? new RegExp(textSource.skipBodyLinePattern, "u")
    : null;
  const titleFromBodyChars = Number(textSource.titleFromBodyChars || 0);
  const chapters = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const bodyLines = current.lines
      .map(cleanPlainTextLine)
      .filter(Boolean)
      .filter((line) => !skipBodyPattern || !skipBodyPattern.test(line));
    const body = bodyLines.join("\n").trim();
    if (!body) return;
    const bodyTitle =
      titleFromBodyChars > 0 && bodyLines[0]
        ? [...bodyLines[0].replace(/\s+/g, "")]
            .slice(0, titleFromBodyChars)
            .join("")
            .replace(/[，。、；：？！「」『』《》（）]+$/u, "")
        : "";
    chapters.push({
      n: chapters.length + 1,
      title: bodyTitle || current.title,
      text: body,
    });
  };

  for (const line of String(text || "").split("\n")) {
    const value = cleanPlainTextLine(line);
    if (!value || /^Produced\s*by/i.test(value)) continue;
    if (headingPattern.test(value)) {
      push();
      current = { title: markedLineSectionTitle(value, textSource), lines: [value] };
      continue;
    }
    if (current) current.lines.push(value);
  }
  push();
  return chapters;
}

function parseParagraphSectionChapters(text, textSource = {}) {
  const minChars = Number(textSource.minParagraphChars || 6);
  const skipPattern = textSource.skipParagraphPattern
    ? new RegExp(textSource.skipParagraphPattern, "u")
    : null;
  const titleSuffix = String(textSource.titleSuffix || "則").trim();
  const paragraphs = paragraphBlocks(text)
    .filter((paragraph) => !/^Produced\s*by/i.test(paragraph))
    .filter((paragraph) => !skipPattern || !skipPattern.test(paragraph))
    .filter((paragraph) => [...paragraph].length >= minChars);
  return paragraphs.map((paragraph, index) => ({
    n: index + 1,
    title: `第${index + 1}${titleSuffix}`,
    text: paragraph,
  }));
}

function cleanParagraphHeading(value) {
  return String(value || "")
    .replace(/[　\s]+/gu, " ")
    .trim();
}

function biographyParagraphTitle(paragraph, textSource = {}) {
  const titlePattern = textSource.titlePattern
    ? new RegExp(textSource.titlePattern, "u")
    : /^([\p{Script=Han}]{1,12})[　\s]{2,}/u;
  const match = String(paragraph || "").match(titlePattern);
  const title = cleanParagraphHeading(match?.[1] || "");
  if (!title || /[，。！？；;:：、,.!?]/u.test(title)) return "";
  return title;
}

function parseBiographyParagraphChapters(text, textSource = {}) {
  const minChars = Number(textSource.minParagraphChars || 8);
  const paragraphs = paragraphBlocks(text)
    .filter((paragraph) => !/^Produced\s*by/i.test(paragraph))
    .filter((paragraph) => [...paragraph].length >= minChars);
  const chapters = [];
  for (const paragraph of paragraphs) {
    const title = biographyParagraphTitle(paragraph, textSource);
    if (!title) continue;
    chapters.push({
      n: chapters.length + 1,
      title,
      text: paragraph,
    });
  }
  return chapters;
}

function pairedParagraphTitle(value) {
  const clean = cleanParagraphHeading(value);
  const compact = compactSpacedHanTitle(clean);
  return cleanParagraphHeading(compact);
}

function parsePairedParagraphChapters(text, textSource = {}) {
  const headingPattern = textSource.headingPattern
    ? new RegExp(textSource.headingPattern, "u")
    : null;
  if (!headingPattern) return [];
  const minBodyChars = Number(textSource.minBodyChars || 6);
  const paragraphs = paragraphBlocks(text).filter(
    (paragraph) => !/^Produced\s*by/i.test(paragraph),
  );
  const chapters = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const title = pairedParagraphTitle(paragraphs[index]);
    if (!title || !headingPattern.test(title)) continue;
    const body = paragraphs[index + 1] || "";
    if ([...body].length < minBodyChars) continue;
    chapters.push({
      n: chapters.length + 1,
      title,
      text: body,
    });
    index += 1;
  }
  return chapters;
}

function inlinePlayActTitle(value) {
  const line = cleanParagraphHeading(value);
  const match = line.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*出)\\s*(.{0,40})$`, "u"));
  if (!match) return "";
  const prefix = match[1].replace(/\s+/g, "");
  const rest = cleanParagraphHeading(match[2] || "");
  return `${prefix}${rest ? ` ${rest}` : ""}`.trim();
}

function parseInlinePlayActChapters(text, textSource = {}) {
  const source = String(text || "");
  const headingPattern = new RegExp(`(^|\\n)\\s*(第\\s*${HAN_ORDINAL_RE}\\s*出[^\\n]{0,40})`, "gu");
  const headings = [];
  for (const match of source.matchAll(headingPattern)) {
    const title = inlinePlayActTitle(match[2]);
    if (!title) continue;
    headings.push({
      title,
      start: match.index + match[1].length,
      end: match.index + match[0].length,
    });
  }
  const chapters = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1];
    const body = source
      .slice(heading.end, next ? next.start : source.length)
      .split("\n")
      .map(cleanPlainTextLine)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!body && !textSource.includeEmptyActs) continue;
    chapters.push({
      n: chapters.length + 1,
      title: heading.title,
      text: body || "本出在 Project Gutenberg 原文中只列标题；此处保留目录占位，避免出目编号错位。",
    });
  }
  return chapters;
}

function cleanQuestionAnswerBody(value) {
  return String(value || "")
    .split("\n")
    .map(cleanPlainTextLine)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function questionAnswerTitle(value, textSource = {}) {
  const maxChars = Number(textSource.questionTitleChars || 22);
  const compact = cleanQuestionAnswerBody(value).replace(/\s+/g, "");
  const question = compact.match(/^問[:：](.+?)(?:師云|[？?。]|$)/u)?.[1] || "";
  if (!question) return "";
  const chars = [...question];
  return `問：${chars.slice(0, maxChars).join("")}${chars.length > maxChars ? "..." : ""}`;
}

function parseQuestionAnswerChapters(text, textSource = {}) {
  const source = String(text || "");
  const questionIndexes = [...source.matchAll(/問[:：]/gu)].map((match) => match.index);
  if (!questionIndexes.length) return [];
  const chapters = [];
  const initialTitle = String(textSource.initialTitle || "").trim();
  const intro = cleanQuestionAnswerBody(source.slice(0, questionIndexes[0]));
  if (initialTitle && intro) {
    chapters.push({
      n: chapters.length + 1,
      title: initialTitle,
      text: intro,
    });
  }
  for (let index = 0; index < questionIndexes.length; index += 1) {
    const start = questionIndexes[index];
    const next = questionIndexes[index + 1] ?? source.length;
    const text = cleanQuestionAnswerBody(source.slice(start, next));
    const title = questionAnswerTitle(text, textSource);
    if (!text || !title) continue;
    chapters.push({
      n: chapters.length + 1,
      title,
      text,
    });
  }
  return chapters;
}

function compactRightMarkerTitle(value) {
  return String(value || "")
    .replace(/^右/u, "")
    .replace(/\s+/g, "")
    .trim();
}

function parseRightMarkerChapters(text, textSource = {}) {
  const markerPattern = textSource.markerPattern
    ? new RegExp(textSource.markerPattern, "gu")
    : null;
  const mainPattern = textSource.mainPattern ? new RegExp(textSource.mainPattern, "u") : null;
  if (!markerPattern || !mainPattern) return [];

  const source = String(text || "").trim();
  const main = mainPattern.exec(source);
  if (!main?.index && main?.index !== 0) return [];

  const chapters = [];
  const introTitle = String(textSource.introTitle || "").trim();
  if (introTitle) {
    const introIndex = source.indexOf(introTitle);
    if (introIndex >= 0 && introIndex < main.index) {
      const introText = source.slice(introIndex + introTitle.length, main.index).trim();
      if (introText) chapters.push({ n: chapters.length + 1, title: introTitle, text: introText });
    }
  }

  const bodyStart = main.index + (textSource.includeMainPattern === false ? main[0].length : 0);
  const body = source.slice(bodyStart).trim();
  let previousIndex = 0;
  let lastChapter = null;
  for (const match of body.matchAll(markerPattern)) {
    const title = compactRightMarkerTitle(match[0]);
    const textBeforeMarker = body.slice(previousIndex, match.index).trim();
    if (title && textBeforeMarker) {
      lastChapter = {
        n: chapters.length + 1,
        title,
        text: textBeforeMarker,
      };
      chapters.push(lastChapter);
    }
    previousIndex = match.index + match[0].length;
  }
  const tail = body.slice(previousIndex).trim();
  if (tail && lastChapter && [...tail].length <= 1200) {
    lastChapter.text = [lastChapter.text, tail].filter(Boolean).join("\n\n");
  }
  return chapters.map((chapter, index) => ({ ...chapter, n: index + 1 }));
}

function buildLineHeadingChapters(text, titleForLine) {
  const chapters = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const body = current.lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body) {
      chapters.push({
        n: chapters.length + 1,
        title: current.title,
        text: body,
      });
    }
    current = null;
  };

  for (const rawLine of String(text || "").split("\n")) {
    const line = cleanPlainTextLine(rawLine);
    const heading = titleForLine(line);
    if (heading?.title) {
      push();
      current = { title: heading.title, lines: [] };
      if (heading.rest) current.lines.push(heading.rest);
      continue;
    }
    if (!current) continue;
    if (!line) {
      if (current.lines.length) current.lines.push("");
      continue;
    }
    current.lines.push(line);
  }
  push();
  return chapters.map((chapter, index) => ({ ...chapter, n: index + 1 }));
}

function parseNumberedQuotedPoemChapters(text) {
  return buildLineHeadingChapters(text, (line) => {
    const match = String(line || "").match(/^(\d{1,4})「([^」]{1,120})」$/u);
    if (!match) return null;
    return { title: match[2].trim() };
  });
}

function parsePianOrdinalChapters(text) {
  return buildLineHeadingChapters(text, (line) => {
    const compact = String(line || "").replace(/\s+/g, "");
    const match = compact.match(
      new RegExp(`^([\\p{Script=Han}]{1,16}篇第${HAN_ORDINAL_RE})$`, "u"),
    );
    return match ? { title: match[1] } : null;
  });
}

function parseThreeKingdomsHistoryChapters(text) {
  return buildLineHeadingChapters(text, (line) => {
    const value = String(line || "")
      .replace(/\s+/g, " ")
      .trim();
    const match = value.match(
      new RegExp(`^((?:魏書|蜀書|吳書)\\s*${HAN_ORDINAL_RE}\\s+.{1,48}第${HAN_ORDINAL_RE})$`, "u"),
    );
    return match ? { title: match[1].replace(/\s+/g, " ").trim() } : null;
  });
}

function parseDynastyChronicleChapters(text) {
  return buildLineHeadingChapters(text, (line) => {
    const compact = String(line || "").replace(/\s+/g, "");
    const match = compact.match(/^([夏商殷周晉晋魏秦漢汉唐宋元明清]{1,4})紀$/u);
    return match ? { title: `${match[1].replace(/晋/u, "晉")}紀` } : null;
  });
}

function zhangzaiPlainHeadingTitle(line) {
  const compact = String(line || "")
    .replace(/\s+/g, "")
    .trim();
  if (!compact || [...compact].length > 28) return "";
  if (!/^\p{Script=Han}+$/u.test(compact)) return "";
  if (/^(?:橫渠易說|經學理窟|橫渠經學理窟|張子語錄|文集佚存|拾遺|附錄)$/u.test(compact))
    return compact;
  if (new RegExp(`^[\\p{Script=Han}]{1,12}篇第${HAN_ORDINAL_RE}$`, "u").test(compact))
    return compact;
  if (/^[\p{Script=Han}]{2,24}(?:序|跋|提要|題辭|書)$/u.test(compact)) return compact;
  if (
    /^(?:上經|下經|系辭上|系辭下|說卦|序卦|雜卦|佚文|周禮|詩書|宗法|禮樂|氣質|義理|自道|祭祀|月令統|喪紀|語錄上|語錄中|語錄下|後錄上|後錄下|性理拾遺|近思錄拾遺|雜詩)$/u.test(
      compact,
    )
  )
    return compact;
  if (/^學大原[上下]$/u.test(compact)) return compact;
  return "";
}

function parseZhangzaiHeadingChapters(text) {
  return buildLineHeadingChapters(text, (line) => {
    const title = zhangzaiPlainHeadingTitle(line);
    return title ? { title } : null;
  });
}

function inlineStageSceneHeading(line, sceneNumber) {
  const value = String(line || "").trim();
  const match = value.match(
    /^(\[[^\]\n]{1,80}(?:上開|上開雲|上白|上雲|上云|上)[^\]\n]{0,20}\])(.*)$/u,
  );
  if (!match) return null;
  const marker = match[1];
  const content = marker.slice(1, -1);
  const role =
    content.match(
      /老夫人|夫人|張生|张生|鶯鶯|莺莺|紅娘|红娘|法聰|法聪|長老|长老|鄭琚|郑琚/u,
    )?.[0] ||
    content.match(/正末|末|正旦|旦|紅|红|外|淨|净|潔|洁/u)?.[0] ||
    content.match(/^([\p{Script=Han}]{2,8}?)(?=引|上|扮)/u)?.[1] ||
    "場面";
  const roleMap = {
    夫人: "老夫人",
    张生: "張生",
    莺莺: "鶯鶯",
    红娘: "紅娘",
    法聪: "法聰",
    长老: "長老",
    郑琚: "鄭琚",
    正末: "張生",
    末: "張生",
    正旦: "鶯鶯",
    旦: "鶯鶯",
    紅: "紅娘",
    红: "紅娘",
    外: "老夫人",
    淨: "鄭琚",
    净: "鄭琚",
    潔: "長老",
    洁: "長老",
  };
  const titleRole = roleMap[role] || role;
  const rest = [marker, cleanPlainTextLine(match[2])].filter(Boolean).join("");
  return {
    title: `第${sceneNumber}段 ${titleRole}`,
    rest,
  };
}

function parseInlineStageSceneChapters(text) {
  let sceneNumber = 0;
  return buildLineHeadingChapters(text, (line) => {
    const heading = inlineStageSceneHeading(line, sceneNumber + 1);
    if (!heading) return null;
    sceneNumber += 1;
    return heading;
  });
}

function knownPlainTextTitle(value, textSource = {}) {
  const titles = new Set(
    (textSource.titles || []).map((title) => String(title || "").trim()).filter(Boolean),
  );
  const titleMap = textSource.titleMap || {};
  if (titles.has(value)) return String(titleMap[value] || value).trim();
  return "";
}

function compactSpacedHanTitle(value) {
  const title = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title.includes(" ")) return title;
  const chunks = title.split(" ").filter(Boolean);
  if (
    chunks.length >= 2 &&
    chunks.every((chunk) => [...chunk].length <= 2 && !/[A-Za-z，。！？；;:：、,.!?]/u.test(chunk))
  ) {
    return chunks.join("");
  }
  return title;
}

function shortHanPlainTextTitle(value, textSource = {}) {
  const raw = String(value || "")
    .replace(/^[○●]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  const normalized = compactSpacedHanTitle(raw);
  const compact = normalized.replace(/\s+/g, "");
  const minChars = textSource.minChars || 2;
  const maxChars = textSource.maxChars || 18;
  const charLength = [...compact].length;
  if (charLength < minChars || charLength > maxChars) return "";
  if (!/\p{Script=Han}/u.test(normalized)) return "";
  if (/[A-Za-z]/u.test(normalized)) return "";
  if (/[，。！？；;:：、,.!?]/u.test(normalized)) return "";
  if (/^(?:[一二三四五六七八九十百千万億0-9]+日|\d+)$/u.test(compact)) return "";
  if (/(?:著|撰|輯|辑|校|序曰)$/u.test(compact)) return "";
  if (textSource.requirePattern && !new RegExp(textSource.requirePattern, "u").test(normalized))
    return "";
  if (textSource.excludePattern && new RegExp(textSource.excludePattern, "u").test(normalized))
    return "";
  return normalized;
}

function travelDiaryPlainTextTitle(value) {
  const compact = String(value || "")
    .replace(/\s+/g, "")
    .trim();
  if (/^(?:盤江考|近騰諸彝說略)$/u.test(compact)) return compact;
  if (
    /^(?:(?:後?游[\p{Script=Han}]{1,12}|後?閩游|閩游|浙游|江右游|楚游|粵西遊|粤西游|黔游|滇游)日(?:記|记)(?:[一二三四五六七八九十]+)?)$/u.test(
      compact,
    )
  ) {
    return compact.replace(/记/gu, "記").replace(/粤西游/u, "粵西遊");
  }
  return "";
}

function plainTextHeadingTitle(line, textSource = {}) {
  const value = cleanPlainTextLine(line).replace(/^●\s*/u, "").trim();
  if (!value) return "";
  if (textSource.kind === "known-title-list") {
    return knownPlainTextTitle(value, textSource);
  }
  if (textSource.kind === "short-han-title") {
    return shortHanPlainTextTitle(value, textSource);
  }
  if (textSource.kind === "travel-diary") {
    return travelDiaryPlainTextTitle(value);
  }
  if (textSource.kind === "single-heading" && value === textSource.title) {
    return value;
  }
  if (textSource.kind === "zh-chapter") {
    const match = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*章)\\s*(.{0,40})$`, "u"));
    if (match) {
      const prefix = match[1].replace(/\s+/g, "");
      const rest = (match[2] || "").replace(/\s+/g, "").trim();
      return `${prefix}${rest ? ` ${rest}` : ""}`.trim();
    }
  }
  if (textSource.kind === "zh-piece") {
    if (/^(?:題記|题记|序|自序)$/u.test(value)) return value;
    const match = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*篇)\\s*(.{0,80})$`, "u"));
    if (match)
      return `${match[1].replace(/\s+/g, "")}${match[2] ? ` ${match[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "huyu-exercise") {
    const match = value.match(/^Exercise\s+(\d+)\.$/iu);
    if (match) return `练习${formatHanNumber(match[1])}`;
  }
  if (textSource.kind === "hui-clean") {
    const bare = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*回)$`, "u"));
    if (bare) return bare[1].replace(/\s+/g, "");
    const match = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*回)\\s+(.{1,100})$`, "u"));
    if (match) {
      const rest = match[2].trim();
      const chunks = rest.split(/[\s　]+/u).filter(Boolean);
      const titleChunks = chunks.length >= 2 ? chunks.slice(0, 2) : chunks;
      if (
        titleChunks.length &&
        titleChunks.every((chunk) => !/[，。！？；;:：、．.]/u.test(chunk))
      ) {
        return `${match[1].replace(/\s+/g, "")} ${titleChunks.join(" ")}`.trim();
      }
    }
  }
  if (textSource.kind === "hui" || textSource.kind === "hui-next-title-line") {
    const huiValue = value.replace(/^[^/]{1,40}\//u, "");
    const match = huiValue.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*回)\\s*(.{0,80})$`, "u"));
    if (match)
      return `${match[1].replace(/\s+/g, "")}${match[2] ? ` ${match[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "play-act") {
    const match = value.match(
      new RegExp(`^《\\s*(第\\s*${HAN_ORDINAL_RE}\\s*出\\s*[^》]{0,40})\\s*》$`, "u"),
    );
    if (match) return match[1].replace(/\s+/g, " ").trim();
    const numeric = value.match(/^第\s*0?(\d{1,2})\s*齣\s*(.{0,40})$/u);
    if (numeric)
      return `第${formatHanNumber(numeric[1])}出${numeric[2] ? ` ${numeric[2].trim()}` : ""}`.trim();
    const bare = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*出)\\s*(.{0,40})$`, "u"));
    if (bare) return `${bare[1].replace(/\s+/g, "")}${bare[2] ? ` ${bare[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "zaju-fold") {
    const zajuLine = value.replace(/^●\s*/u, "");
    if (zajuLine === "楔子") return zajuLine;
    const match = zajuLine.match(
      new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*折)(?:\\s+(.{1,40}))?$`, "u"),
    );
    if (match)
      return `${match[1].replace(/\s+/g, "")}${match[2] ? ` ${match[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "bracket-volume") {
    const match = value.match(
      new RegExp(`^【\\s*(卷\\s*${HAN_ORDINAL_RE})\\s*】\\s*(.{0,40})$`, "u"),
    );
    const titleRest = match?.[2]
      ?.replace(/[（(]?\s*頁.+$/u, "")
      .replace(/[（(]\s*$/u, "")
      .trim();
    if (match) return `${match[1].replace(/\s+/g, "")}${titleRest ? ` ${titleRest}` : ""}`.trim();
  }
  if (textSource.kind === "quoted-volume") {
    const match = value.match(new RegExp(`^《\\s*((補遺)?卷\\s*(${HAN_ORDINAL_RE}))\\s*》$`, "u"));
    if (match) {
      const prefix = match[2] || "";
      return `${prefix}卷${formatHanOrdinalText(match[3])}`;
    }
  }
  if (textSource.kind === "bare-volume") {
    const match = value.match(new RegExp(`^(卷\\s*${HAN_ORDINAL_RE})(?:\\s+(.{1,40}))?$`, "u"));
    if (match)
      return `${match[1].replace(/\s+/g, "")}${match[2] ? ` ${match[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "numbered-volume") {
    const match = value.match(
      new RegExp(`^第\\s*(${HAN_ORDINAL_RE})\\s*卷[?？\\s]*(.{0,40})$`, "u"),
    );
    if (match)
      return `第${formatHanOrdinalText(match[1])}卷${match[2] ? ` ${match[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "book-prefixed-volume") {
    const match = value.match(
      new RegExp(
        `^(?:《?[^《》]{1,24}》?\\s*)?(卷\\s*${HAN_ORDINAL_RE})\\s*[·．.、-]?\\s*(.{0,40})$`,
        "u",
      ),
    );
    if (match)
      return `${match[1].replace(/\s+/g, "")}${match[2] ? ` ${match[2].trim()}` : ""}`.trim();
  }
  if (textSource.kind === "numbered-zhi") {
    const match = value.match(
      new RegExp(`^(${HAN_ORDINAL_RE})\\s*之\\s*([\\p{Script=Han}]{1,12})$`, "u"),
    );
    if (match) return `${match[1].replace(/\s+/g, "")}之${match[2].trim()}`;
  }
  if (textSource.kind === "bare-han-section") {
    const match = value.match(new RegExp(`^(${HAN_ORDINAL_RE})$`, "u"));
    if (match) return match[1].replace(/\s+/g, "");
  }
  if (textSource.kind === "short-place") {
    if (/^(?:馬敬序|马敬序|馬歡序|马欢序|後序|后序)$/u.test(value)) return value;
    if (/^[\p{Script=Han}]{2,12}(?:國|国)$/u.test(value)) return value;
  }
  if (textSource.kind === "taiwan-history") {
    if (value === "序") return value;
    if (/^(?:卷|捲)一$/u.test(value)) return "捲一 開闢紀";
  }
  if (textSource.kind === "xianqing-ouji") {
    if (/^(?:词曲|演习|声容|居室|器玩|饮馔|种植|颐养)部$/u.test(value)) return value;
    const match = value.match(
      new RegExp(`^◎?\\s*([\\p{Script=Han}]{2,12}第\\s*${HAN_ORDINAL_RE})$`, "u"),
    );
    if (match) return match[1].replace(/\s+/g, "");
  }
  if (textSource.kind === "sanzang-shihua") {
    if (value === "口口口口口口第一") return "闕文第一（缺）";
    const untitled = value.match(new RegExp(`^（題原缺）第\\s*(${HAN_ORDINAL_RE})$`, "u"));
    if (untitled) return `題原缺第${untitled[1].replace(/\s+/g, "")}`;
    const match = value.match(
      new RegExp(`^([\\p{Script=Han}]{2,30}第\\s*${HAN_ORDINAL_RE})$`, "u"),
    );
    if (match) return match[1].replace(/\s+/g, "");
  }
  if (textSource.kind === "lingli-jiguang") {
    const compact = value.replace(/\s+/g, "");
    if (/^(?:滕序|前言|致谢|致謝)$/u.test(compact)) return compact === "致謝" ? "致谢" : compact;
    const match = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*章)\\s*(.{1,60})$`, "u"));
    if (match) {
      const prefix = match[1].replace(/\s+/g, "");
      const rest = (match[2] || "").replace(/\s+/g, " ").trim();
      return `${prefix} ${rest}`.trim();
    }
  }
  if (textSource.kind === "classic-ordinal") {
    const bareLacuna = value.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE})\\[(?:闕|缺)\\]$`, "u"));
    if (bareLacuna) return `闕文${bareLacuna[1].replace(/\s+/g, "")}`;
    const match = value.match(
      new RegExp(`^([\\p{Script=Han}]{2,28}第\\s*${HAN_ORDINAL_RE})(?:\\[(?:闕|缺)\\])?$`, "u"),
    );
    if (match) {
      const title = match[1].replace(/\s+/g, "");
      return value.includes("[闕]") || value.includes("[缺]") ? `${title}（缺）` : title;
    }
  }
  if (textSource.kind === "spaced-classic-ordinal") {
    const compact = value.replace(/\s+/g, "");
    const match = compact.match(new RegExp(`^([\\p{Script=Han}]{2,40}第${HAN_ORDINAL_RE})$`, "u"));
    if (match) return match[1];
  }
  return "";
}

function preparePlainTextForChapterScan(text, textSource = {}) {
  if (textSource.kind === "play-act") {
    return text.replace(
      new RegExp(`(《\\s*第\\s*${HAN_ORDINAL_RE}\\s*出\\s*[^》]{0,40}\\s*》)`, "gu"),
      "\n$1\n",
    );
  }
  if (textSource.kind === "bracket-volume") {
    return text.replace(
      new RegExp(`(【\\s*卷\\s*${HAN_ORDINAL_RE}\\s*】[^\\n]{0,50})`, "gu"),
      "\n$1\n",
    );
  }
  if (textSource.kind === "bare-volume") {
    return text.replace(
      new RegExp(`(^|\\n)(卷\\s*${HAN_ORDINAL_RE}(?:\\s+[^\\n]{1,40})?)(?=\\n)`, "gu"),
      "$1$2",
    );
  }
  return text;
}

function parseGutenbergPlainTextChapters(book, raw) {
  const text = cleanGutenbergPlainText(raw, book.textSource || {});
  const warnings = garbledTextWarnings(text);
  if (warnings.length) throw new Error(`Plain-text source looks garbled: ${warnings.join("; ")}`);
  if (book.textSource?.kind === "sishier-zhangjing") {
    const chapters = parseSishierZhangjingParagraphs(text);
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "line-sections") {
    const chapters = parseLineSectionChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "marked-line-sections") {
    const chapters = parseMarkedLineSectionChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "paragraph-sections") {
    const chapters = parseParagraphSectionChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "biography-paragraphs") {
    const chapters = parseBiographyParagraphChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "paired-paragraphs") {
    const chapters = parsePairedParagraphChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "inline-play-act") {
    const chapters = parseInlinePlayActChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "question-answer") {
    const chapters = parseQuestionAnswerChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "right-marker") {
    const chapters = parseRightMarkerChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "numbered-quoted-poems") {
    const chapters = parseNumberedQuotedPoemChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "pian-ordinal") {
    const chapters = parsePianOrdinalChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "three-kingdoms-history") {
    const chapters = parseThreeKingdomsHistoryChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "dynasty-chronicle") {
    const chapters = parseDynastyChronicleChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "zhangzai-headings") {
    const chapters = parseZhangzaiHeadingChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  if (book.textSource?.kind === "inline-stage-scene") {
    const chapters = parseInlineStageSceneChapters(text, book.textSource || {});
    if (chapters.length) return chapters;
  }
  const chapters = [];
  let current = book.textSource?.initialTitle
    ? {
        title: String(book.textSource.initialTitle).trim(),
        lacuna: false,
        structural: false,
        lines: [],
      }
    : null;
  const push = () => {
    if (!current) return;
    const lines = [...current.lines];
    let title = current.title;
    if (
      book.textSource?.kind === "hui-next-title-line" &&
      new RegExp(`^第${HAN_ORDINAL_RE}回$`, "u").test(title)
    ) {
      const subtitleIndex = lines.findIndex((line) => line.trim());
      const subtitles = [];
      const subtitle = subtitleIndex >= 0 ? nextLineHuiSubtitle(lines[subtitleIndex]) : "";
      if (subtitle && subtitleIndex >= 0) {
        subtitles.push(subtitle);
        lines.splice(subtitleIndex, 1);
        const continuation = nextLineHuiSubtitle(lines[subtitleIndex]);
        if (
          continuation &&
          lines[subtitleIndex + 1] != null &&
          !String(lines[subtitleIndex + 1]).trim()
        ) {
          subtitles.push(continuation);
          lines.splice(subtitleIndex, 1);
        }
      }
      if (subtitles.length) {
        title = `${title} ${subtitles.join(" ")}`;
      }
    }
    const body = lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body || current.lacuna || current.structural) {
      chapters.push({
        n: chapters.length + 1,
        title,
        text:
          body ||
          (current.structural ? "本篇为原文分部标题；正文见后续篇目。" : "本篇原文标为「闕」。"),
      });
    }
    current = null;
  };
  const scanText = preparePlainTextForChapterScan(text, book.textSource || {});
  for (const rawLine of scanText.split("\n")) {
    let line = cleanPlainTextLine(rawLine);
    if (book.textSource?.trimLineSuffixPattern) {
      line = line.replace(new RegExp(book.textSource.trimLineSuffixPattern, "u"), "").trim();
    }
    if (!line) {
      if (current?.lines.length) current.lines.push("");
      continue;
    }
    if (/^-{3,}$/u.test(line)) {
      continue;
    }
    if (
      book.textSource?.skipLinePattern &&
      new RegExp(book.textSource.skipLinePattern, "u").test(line)
    ) {
      if (current?.lines.length) current.lines.push("");
      continue;
    }
    const title = plainTextHeadingTitle(line, book.textSource || {});
    if (title) {
      if (book.textSource?.kind === "xianqing-ouji" && current?.title === title) {
        current = {
          title,
          lacuna: false,
          structural: /部$/u.test(title),
          lines: [],
        };
        continue;
      }
      if (
        book.textSource?.kind === "known-title-list" &&
        current?.title === title &&
        !current.lines.some((item) => item.trim())
      ) {
        continue;
      }
      if (
        book.textSource?.kind === "hui-clean" &&
        current?.title === title &&
        !current.lines.some((item) => item.trim())
      ) {
        continue;
      }
      if (book.textSource?.kind === "lingli-jiguang" && current?.title === title) {
        continue;
      }
      if (book.textSource?.kind === "huyu-exercise" && current?.title === title) {
        continue;
      }
      if (book.textSource?.ignoreRepeatedTitle && current?.title === title) {
        continue;
      }
      push();
      current = {
        title,
        lacuna: title.startsWith("闕文第") || /（缺）$/u.test(title),
        structural: book.textSource?.kind === "xianqing-ouji" && /部$/u.test(title),
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  push();
  if (!chapters.length) {
    const body = text.split("\n").map(cleanPlainTextLine).filter(Boolean).join("\n").trim();
    if (body) chapters.push({ n: 1, title: book.title, text: body });
  }
  return chapters.map((chapter, index) => ({ ...chapter, n: index + 1 }));
}

function createPlainTextIngestPayload(book, raw, sourceTextUrl, license) {
  const chapters = parseGutenbergPlainTextChapters(book, raw);
  return cleanGutenbergPayload(book, {
    id: book.id,
    title: book.title,
    subtitle: "",
    author: "",
    category: book.category,
    lang: book.lang,
    year: "",
    blurb: chapters[0]?.text?.slice(0, 120) || "",
    description: `Imported from Project Gutenberg plain text ${book.pg}.`,
    sourceUrl: sourceUrl(book),
    license,
    featured: Boolean(book.featured),
    sourceTextUrl,
    chapters,
  });
}

async function probe(apiUrl, book) {
  const [bookRes, contentRes, searchRes] = await Promise.all([
    fetchWithRetry(`${apiUrl}/api/books/${encodeURIComponent(book.id)}`),
    fetchWithRetry(`${apiUrl}/api/books/${encodeURIComponent(book.id)}/content/1`),
    fetchWithRetry(`${apiUrl}/api/search?q=${encodeURIComponent(book.expect)}`),
  ]);
  return {
    bookFound: bookRes.ok && Boolean((await bookRes.json()).book),
    contentFound: contentRes.ok && Boolean((await contentRes.json()).text),
    searchReturned: searchRes.ok && Array.isArray((await searchRes.json()).books),
  };
}

async function liveBookExists(apiUrl, book) {
  const res = await fetchWithRetry(`${apiUrl}/api/books/${encodeURIComponent(book.id)}`);
  if (!res.ok) return false;
  const body = await res.json().catch(() => null);
  return Boolean(body?.book);
}

async function importOne(book, options) {
  process.stderr.write(`[gutenberg] ${book.id} #${book.pg} verify rights...\n`);
  const metadata = await fetchGutenbergMetadata(book);
  const metadataLicense = verifyGutenbergPublicDomain(book, metadata);
  process.stderr.write(`[gutenberg] ${book.id} rights: ${metadata.rights.join("; ")}\n`);

  process.stderr.write(`[gutenberg] ${book.id} #${book.pg} download...\n`);
  const dir = await mkdtemp(path.join(tmpdir(), "liber-gutenberg-"));
  const filePath = path.join(dir, `${book.id}.epub`);
  let downloadedFrom = null;
  let info = null;
  let license = null;
  let manifest = null;
  let payload = null;
  try {
    if (book.textSource?.prefer === "plain") {
      throw new Error("book is configured to prefer Project Gutenberg plain text");
    }
    downloadedFrom = await downloadEpub(book, filePath);
    info = await inspectEpub(filePath);
    license = await verifyPublishLicense(info, {
      source: sourceUrl(book),
      license: metadataLicense.license,
      evidence: metadata.rights.join("; "),
    });
    manifest = await createBookManifest(filePath, {
      source: sourceUrl(book),
      license: metadataLicense.license,
      evidence: metadata.rights.join("; "),
    });
    payload = cleanGutenbergPayload(
      book,
      await createIngestPayload(manifest, {
        id: book.id,
        category: book.category,
        lang: book.lang,
        includeSource: false,
      }),
    );
  } catch (error) {
    if (!book.textSource) throw error;
    process.stderr.write(`[gutenberg] ${book.id} EPUB fallback to plain text: ${error.message}\n`);
    const textSource = await downloadPlainText(book);
    downloadedFrom = textSource.url;
    info = { metadata: { title: book.title, creator: null, language: book.lang }, sha256: null };
    license = { accepted: true, license: metadataLicense.license };
    payload = createPlainTextIngestPayload(
      book,
      textSource.text,
      textSource.url,
      metadataLicense.license,
    );
  }
  const qualityWarnings = assertImportQuality(book, payload.chapters);
  for (const warning of qualityWarnings) {
    process.stderr.write(`[gutenberg] ${book.id} quality warning: ${warning}\n`);
  }

  let publish = null;
  let live = null;
  if (options.publish) {
    process.stderr.write(`[gutenberg] ${book.id} publish ${payload.chapters.length} chapters...\n`);
    publish = await publishBookManifestChunked(manifest, {
      apiUrl: options.apiUrl,
      id: book.id,
      category: book.category,
      lang: book.lang,
      ingestPayload: payload,
      concurrency: options.chapterConcurrency,
      onProgress: (event) => {
        if (event.stage === "chapter") {
          process.stderr.write(
            `[gutenberg] ${book.id} chapter ${event.current}/${event.total}: ${event.chapter.title}\n`,
          );
        } else {
          process.stderr.write(`[gutenberg] ${book.id} ${event.stage}...\n`);
        }
      },
    });
    live = await probe(options.apiUrl, book);
  }

  return {
    id: book.id,
    pg: book.pg,
    title: info.metadata.title || book.title,
    creator: info.metadata.creator || null,
    lang: book.lang || info.metadata.language || null,
    category: book.category,
    source: sourceUrl(book),
    epubUrl: downloadedFrom,
    rights: metadata.rights,
    sha256: info.sha256,
    license: license.license,
    accepted: license.accepted,
    chapters: payload.chapters.length,
    qualityWarnings,
    sampleTitles: payload.chapters.slice(0, 12).map((chapter) => chapter.title),
    tailSampleTitles: payload.chapters.slice(-12).map((chapter) => chapter.title),
    published: Boolean(publish),
    live,
  };
}

function summarizeOutput(output) {
  const byLang = {};
  const failures = [];
  const warnings = [];
  const results = output.results.map((result) => {
    byLang[result.lang || "unknown"] = (byLang[result.lang || "unknown"] || 0) + 1;
    if (result.error || !result.accepted) {
      failures.push({
        id: result.id,
        pg: result.pg,
        lang: result.lang,
        error: result.error || "not accepted",
      });
    }
    if (result.qualityWarnings?.length) {
      warnings.push({
        id: result.id,
        pg: result.pg,
        lang: result.lang,
        warnings: result.qualityWarnings,
      });
    }
    return {
      id: result.id,
      pg: result.pg,
      title: result.title,
      lang: result.lang,
      category: result.category,
      accepted: Boolean(result.accepted),
      license: result.license || null,
      chapters: result.chapters || 0,
      published: Boolean(result.published),
      skipped: Boolean(result.skipped),
      live: result.live || null,
      error: result.error || null,
    };
  });
  return {
    mode: output.mode,
    apiUrl: output.apiUrl,
    total: output.results.length,
    accepted: output.results.filter((result) => result.accepted).length,
    failed: failures.length,
    published: output.results.filter((result) => result.published).length,
    skipped: output.results.filter((result) => result.skipped).length,
    byLang,
    failures,
    warnings,
    results,
  };
}

function summarizeCatalogAudit(audit, books = BOOKS) {
  const languages = Object.entries(audit.byLang || {})
    .map(([lang, count]) => ({
      lang,
      label: LANGUAGE_CATEGORY_PREFIX[lang] || lang,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.lang.localeCompare(b.lang));
  return {
    mode: "catalog-audit",
    ok: Boolean(audit.ok),
    total: audit.total,
    languages: languages.length,
    byLang: Object.fromEntries(languages.map((row) => [row.lang, row.count])),
    languageRows: languages,
    firstCandidates: books.slice(0, 12).map((book) => ({
      id: book.id,
      pg: book.pg,
      lang: book.lang,
      category: book.category,
      title: book.title,
    })),
    errors: audit.errors || [],
  };
}

function formatCatalogAudit(audit, books = BOOKS) {
  const summary = summarizeCatalogAudit(audit, books);
  const rows = summary.languageRows
    .map((row) => `${row.lang.padEnd(3)} ${String(row.count).padStart(3)} ${row.label}`)
    .join("\n");
  const status = summary.ok ? "ok" : "failed";
  const errors = summary.errors.length
    ? `\n\nErrors:\n${summary.errors.map((error) => `- ${error}`).join("\n")}`
    : "";
  return `Gutenberg catalog audit: ${status}\nTotal candidates: ${summary.total}\nLanguages: ${summary.languages}\n\n${rows}${errors}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertBookCatalog(BOOKS);
  const selected = selectBooks(
    options.audit ? options : { ...options, defaultLangs: DEFAULT_IMPORT_LANGS },
    BOOKS,
  );
  const catalogAudit = auditBookCatalog(selected);
  if (options.audit) {
    const body = options.summary ? summarizeCatalogAudit(catalogAudit, selected) : catalogAudit;
    process.stdout.write(
      options.json
        ? `${JSON.stringify(body, null, 2)}\n`
        : `${formatCatalogAudit(catalogAudit, selected)}\n`,
    );
    return;
  }
  const bookConcurrency = importBookConcurrency(options);
  process.stderr.write(
    `[gutenberg] selected ${selected.length} books; book concurrency ${bookConcurrency}${options.publish ? `; chapter concurrency ${options.chapterConcurrency}` : ""}\n`,
  );
  const results = await mapWithConcurrency(selected, bookConcurrency, async (book) => {
    try {
      if (options.publish && options.skipExisting && (await liveBookExists(options.apiUrl, book))) {
        process.stderr.write(`[gutenberg] ${book.id} exists; skip\n`);
        return {
          id: book.id,
          pg: book.pg,
          title: book.title,
          lang: book.lang,
          category: book.category,
          source: sourceUrl(book),
          accepted: true,
          skipped: true,
        };
      }
      return await importOne(book, options);
    } catch (error) {
      if (!options.continueOnError) throw error;
      process.stderr.write(`[gutenberg] ${book.id} failed: ${error.message}\n`);
      return {
        id: book.id,
        pg: book.pg,
        title: book.title,
        lang: book.lang,
        category: book.category,
        source: sourceUrl(book),
        accepted: false,
        error: error.message,
      };
    }
  });
  const output = { mode: options.publish ? "publish" : "dry-run", apiUrl: options.apiUrl, results };
  const body = options.summary ? summarizeOutput(output) : output;
  process.stdout.write(
    options.json
      ? `${JSON.stringify(body, null, 2)}\n`
      : `${results.map((r) => `${r.id}: ${r.title}`).join("\n")}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  BOOKS,
  DEFAULT_IMPORT_LANGS,
  auditBookCatalog,
  assertBookCatalog,
  assertImportQuality,
  chapterQualityWarnings,
  cleanGutenbergPayload,
  main,
  parseArgs,
  parseGutenbergPlainTextChapters,
  selectBooks,
  summarizeCatalogAudit,
  summarizeOutput,
};
