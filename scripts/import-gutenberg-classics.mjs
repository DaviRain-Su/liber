#!/usr/bin/env node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBookManifest,
  createIngestPayload,
  garbledTextWarnings,
  inspectEpub,
  publishBookManifestChunked,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";

const API_URL = "https://liber.davirain.xyz";
const MAX_CHAPTERS_FOR_AUTO_PUBLISH = 300;
const FETCH_RETRIES = 3;
const FETCH_RETRY_BASE_MS = 750;

const BOOKS = [
  { id: "daodejing-gutenberg-zh", pg: 7337, lang: "zh", title: "道德經", category: "中文 · 道家", expect: "道德經" },
  { id: "laozi-gutenberg-zh", pg: 24039, lang: "zh", title: "老子", category: "中文 · 道家", expect: "老子" },
  { id: "liezi-gutenberg-zh", pg: 7341, lang: "zh", title: "列子", category: "中文 · 道家", expect: "列子" },
  { id: "lunyu-gutenberg-zh", pg: 23839, lang: "zh", title: "論語", category: "中文 · 儒家", expect: "論語" },
  { id: "mengzi-gutenberg-zh", pg: 24178, lang: "zh", title: "孟子", category: "中文 · 儒家", expect: "孟子" },
  { id: "yijing-gutenberg-zh", pg: 25501, lang: "zh", title: "易經", category: "中文 · 易学", expect: "易經" },
  { id: "shijing-gutenberg-zh", pg: 23873, lang: "zh", title: "詩經", category: "中文 · 诗经", expect: "詩經" },
  { id: "liji-gutenberg-zh", pg: 24048, lang: "zh", title: "禮記", category: "中文 · 礼学", expect: "禮記" },
  { id: "sunzi-bingfa-gutenberg-zh", pg: 23864, lang: "zh", title: "孫子兵法", category: "中文 · 兵法", expect: "孫子" },
  { id: "mozi-gutenberg-zh", pg: 24240, lang: "zh", title: "墨子", category: "中文 · 先秦", expect: "墨子" },
  { id: "hanfeizi-gutenberg-zh", pg: 24049, lang: "zh", title: "韩非子", category: "中文 · 法家", expect: "韩非子" },
  { id: "tangshi300-gutenberg-zh", pg: 52323, lang: "zh", title: "唐诗三百首", category: "中文 · 诗歌", expect: "唐诗" },
  { id: "suitang-yanyi-gutenberg-zh", pg: 23835, lang: "zh", title: "隋唐演義", category: "中文 · 古典小说", expect: "隋唐演義" },
  { id: "niehaihua-gutenberg-zh", pg: 25128, lang: "zh", title: "孽海花", category: "中文 · 古典小说", expect: "孽海花" },
  { id: "sanzijing-gutenberg-zh", pg: 12479, lang: "zh", title: "三字經", category: "中文 · 蒙学", expect: "三字經" },
  { id: "baijiaxing-gutenberg-zh", pg: 25196, lang: "zh", title: "百家姓", category: "中文 · 蒙学", expect: "百家姓" },
  { id: "qianziwen-gutenberg-zh", pg: 24075, lang: "zh", title: "千字文", category: "中文 · 蒙学", expect: "千字文" },
  { id: "daxue-zhangju-gutenberg-zh", pg: 7375, lang: "zh", title: "大學 章句", category: "中文 · 儒家", expect: "大學" },
  { id: "zhongyong-zhangju-gutenberg-zh", pg: 7376, lang: "zh", title: "中庸 章句", category: "中文 · 儒家", expect: "中庸" },
  { id: "shuihu-zhuan-gutenberg-zh", pg: 23863, lang: "zh", title: "水滸傳", category: "中文 · 古典小说", expect: "水滸傳" },
  { id: "ernv-yingxiong-gutenberg-zh", pg: 25327, lang: "zh", title: "兒女英雄傳", category: "中文 · 古典小说", expect: "兒女英雄傳" },
  { id: "xingshi-yinyuan-gutenberg-zh", pg: 26161, lang: "zh", title: "醒世姻緣", category: "中文 · 古典小说", expect: "醒世姻緣" },
  { id: "laocan-youji-gutenberg-zh", pg: 25124, lang: "zh", title: "老殘遊記", category: "中文 · 近代小说", expect: "老殘遊記" },
  { id: "huayuehen-gutenberg-zh", pg: 25219, lang: "zh", title: "花月痕", category: "中文 · 古典小说", expect: "花月痕" },
  { id: "liuzu-tanjing-gutenberg-zh", pg: 23844, lang: "zh", title: "六祖壇經", category: "中文 · 佛典", expect: "六祖壇經" },
  { id: "jingangjing-gutenberg-zh", pg: 24098, lang: "zh", title: "金剛般若波羅蜜經", category: "中文 · 佛典", expect: "金剛般若" },
  { id: "mengxi-bitan-gutenberg-zh", pg: 27292, lang: "zh", title: "夢溪筆談", category: "中文 · 笔记", expect: "夢溪筆談" },
  { id: "yanshi-jiaxun-gutenberg-zh", pg: 25365, lang: "zh", title: "顔氏家訓", category: "中文 · 家训", expect: "顔氏家訓" },
  { id: "wenxin-diaolong-gutenberg-zh", pg: 23822, lang: "zh", title: "文心雕龍", category: "中文 · 文论", expect: "文心雕龍" },
  { id: "lin-er-bao-gutenberg-zh", pg: 27399, lang: "zh", title: "麟兒報", category: "中文 · 古典小说", expect: "麟兒報" },
  { id: "shuihu-houzhuan-gutenberg-zh", pg: 25217, lang: "zh", title: "水滸後傳", category: "中文 · 古典小说", expect: "水滸後傳" },
  { id: "xueyuemei-zhuan-gutenberg-zh", pg: 26739, lang: "zh", title: "雪月梅傳", category: "中文 · 古典小说", expect: "雪月梅傳" },
  { id: "zuixing-shi-gutenberg-zh", pg: 24027, lang: "zh", title: "醉醒石", category: "中文 · 古典小说", expect: "醉醒石" },
  { id: "jingshi-tongyan-gutenberg-zh", pg: 24141, lang: "zh", title: "警世通言", category: "中文 · 古典小说", expect: "警世通言" },
  { id: "suiyuan-shihua-gutenberg-zh", pg: 52206, lang: "zh", title: "隨園詩話", category: "中文 · 诗话", expect: "隨園詩話" },
  { id: "jingu-qiguan-gutenberg-zh", pg: 24230, lang: "zh", title: "今古奇觀", category: "中文 · 古典小说", expect: "今古奇觀" },
  { id: "xiyouji-gutenberg-zh", pg: 23962, lang: "zh", title: "西遊記", category: "中文 · 古典小说", expect: "西遊記" },
  { id: "hongloumeng-gutenberg-zh", pg: 24264, lang: "zh", title: "紅樓夢", category: "中文 · 古典小说", expect: "紅樓夢" },
  { id: "jinpingmei-gutenberg-zh", pg: 52200, lang: "zh", title: "金瓶梅", category: "中文 · 古典小说", expect: "金瓶梅" },
  { id: "rizhilu-gutenberg-zh", pg: 25262, lang: "zh", title: "日知錄", category: "中文 · 笔记", expect: "日知錄" },
  { id: "rulin-waishi-gutenberg-zh", pg: 24032, lang: "zh", title: "儒林外史", category: "中文 · 古典小说", expect: "儒林外史" },
  { id: "zhongguo-xiaoshuo-shilue-gutenberg-zh", pg: 25559, lang: "zh", title: "中國小說史略", category: "中文 · 文论", expect: "中國小說史略" },
  { id: "lengyanguan-gutenberg-zh", pg: 24029, lang: "zh", title: "冷眼观", category: "中文 · 近代小说", expect: "冷眼观" },
  { id: "penggong-an-gutenberg-zh", pg: 26970, lang: "zh", title: "彭公案", category: "中文 · 公案小说", expect: "彭公案" },
  { id: "pingyao-zhuan-gutenberg-zh", pg: 57227, lang: "zh", title: "平妖傳", category: "中文 · 神魔小说", expect: "平妖傳" },
  { id: "erke-paian-jingqi-gutenberg-zh", pg: 26729, lang: "zh", title: "二刻拍案驚奇", category: "中文 · 古典小说", expect: "二刻拍案" },
  { id: "chibei-outan-gutenberg-zh", pg: 25162, lang: "zh", title: "池北偶談", category: "中文 · 笔记", expect: "池北偶談" },
  { id: "chuke-paian-jingqi-gutenberg-zh", pg: 57248, lang: "zh", title: "初刻拍案驚奇", category: "中文 · 古典小说", expect: "初刻拍案" },
  { id: "yushi-mingyan-gutenberg-zh", pg: 27582, lang: "zh", title: "喻世明言", category: "中文 · 古典小说", expect: "喻世明言" },
  { id: "doupeng-xianhua-gutenberg-zh", pg: 25328, lang: "zh", title: "豆棚閒話", category: "中文 · 古典小说", expect: "豆棚閒話" },
  { id: "bimuyu-gutenberg-zh", pg: 24185, lang: "zh", title: "比目魚", category: "中文 · 古典小说", expect: "比目魚" },
  { id: "shanhaijing-gutenberg-zh", pg: 25288, lang: "zh", title: "山海經", category: "中文 · 神话地理", expect: "山海經" },
  { id: "mulan-qinv-zhuan-gutenberg-zh", pg: 23938, lang: "zh", title: "木蘭奇女傳", category: "中文 · 古典小说", expect: "木蘭奇女傳" },
  { id: "haigong-an-gutenberg-zh", pg: 54494, lang: "zh", title: "海公案", category: "中文 · 公案小说", expect: "海公案" },
  { id: "yandan-zi-gutenberg-zh", pg: 24068, lang: "zh", title: "燕丹子", category: "中文 · 史传", expect: "燕丹子" },
  { id: "digong-an-gutenberg-zh", pg: 27686, lang: "zh", title: "狄公案", category: "中文 · 公案小说", expect: "狄公案" },
  { id: "lv-mudan-gutenberg-zh", pg: 27330, lang: "zh", title: "綠牡丹", category: "中文 · 古典小说", expect: "綠牡丹" },
  { id: "tianbao-tu-gutenberg-zh", pg: 26904, lang: "zh", title: "天豹圖", category: "中文 · 古典小说", expect: "天豹圖" },
  { id: "lianggong-jiujian-gutenberg-zh", pg: 26886, lang: "zh", title: "梁公九諫", category: "中文 · 史传", expect: "梁公九諫" },
  { id: "changhen-ge-gutenberg-zh", pg: 25352, lang: "zh", title: "長恨歌", category: "中文 · 诗歌", expect: "長恨歌" },
  { id: "liwa-zhuan-gutenberg-zh", pg: 24051, lang: "zh", title: "李娃傳", category: "中文 · 唐传奇", expect: "李娃傳" },
  { id: "yulou-chun-gutenberg-zh", pg: 25422, lang: "zh", title: "玉樓春", category: "中文 · 古典小说", expect: "玉樓春" },
  { id: "hanshu-gutenberg-zh", pg: 23841, lang: "zh", title: "漢書", category: "中文 · 史书", expect: "漢書" },
  { id: "hou-xiyouji-gutenberg-zh", pg: 27332, lang: "zh", title: "後西游記", category: "中文 · 神魔小说", expect: "後西游記" },
  { id: "luoshen-fu-gutenberg-zh", pg: 24041, lang: "zh", title: "洛神賦", category: "中文 · 辞赋", expect: "洛神賦" },
  { id: "youxue-qionglin-gutenberg-zh", pg: 52269, lang: "zh", title: "幼學瓊林", category: "中文 · 蒙学", expect: "幼學瓊林" },
  { id: "pipa-ji-gutenberg-zh", pg: 25246, lang: "zh", title: "琵琶記", category: "中文 · 戏曲", expect: "琵琶記" },
  { id: "sanguo-zhi-gutenberg-zh", pg: 25606, lang: "zh", title: "三國志", category: "中文 · 史书", expect: "三國志" },
  { id: "baigui-zhi-gutenberg-zh", pg: 27023, lang: "zh", title: "白圭志", category: "中文 · 古典小说", expect: "白圭志" },
  { id: "mengzi-ziyi-shuzheng-gutenberg-zh", pg: 25360, lang: "zh", title: "孟子字義疏證", category: "中文 · 儒家", expect: "孟子字義疏證" },
  { id: "anle-ji-gutenberg-zh", pg: 24106, lang: "zh", title: "安樂集", category: "中文 · 佛典", expect: "安樂集" },
  { id: "dengxizi-gutenberg-zh", pg: 7215, lang: "zh", title: "鄧析子", category: "中文 · 名家", expect: "鄧析子" },
  { id: "qiuranke-zhuan-gutenberg-zh", pg: 23915, lang: "zh", title: "虬髯客傳", category: "中文 · 唐传奇", expect: "虬髯客傳" },
  { id: "wuchuan-lu-gutenberg-zh", pg: 27581, lang: "zh", title: "吳船錄", category: "中文 · 地理游记", expect: "吳船錄" },
  { id: "xingcha-shenglan-gutenberg-zh", pg: 24143, lang: "zh", title: "星槎勝覽", category: "中文 · 地理游记", expect: "星槎勝覽" },
  { id: "dongzhou-lieguo-zhi-gutenberg-zh", pg: 25349, lang: "zh", title: "東周列國志", category: "中文 · 历史小说", expect: "東周列國志" },
  { id: "xingshi-hengyan-gutenberg-zh", pg: 24239, lang: "zh", title: "醒世恆言", category: "中文 · 话本小说", expect: "醒世恆言" },
  { id: "soushen-ji-gutenberg-zh", pg: 25362, lang: "zh", title: "搜神記", category: "中文 · 志怪", expect: "搜神記" },
  { id: "baopuzi-gutenberg-zh", pg: 25696, lang: "zh", title: "抱朴子", category: "中文 · 道家", expect: "抱朴子" },
  { id: "xijing-zaji-gutenberg-zh", pg: 25368, lang: "zh", title: "西京雜記", category: "中文 · 笔记", expect: "西京雜記" },
  { id: "youming-lu-gutenberg-zh", pg: 52278, lang: "zh", title: "幽明錄", category: "中文 · 志怪", expect: "幽明錄" },
  { id: "mingjing-gongan-gutenberg-zh", pg: 52280, lang: "zh", title: "明鏡公案", category: "中文 · 公案小说", expect: "明鏡公案" },
  { id: "dou-e-yuan-gutenberg-zh", pg: 52276, lang: "zh", title: "竇娥冤", category: "中文 · 戏曲", expect: "竇娥冤" },
  { id: "guanzi-gutenberg-zh", pg: 7367, lang: "zh", title: "管子", category: "中文 · 诸子", expect: "管子" },
  { id: "guiguzi-gutenberg-zh", pg: 25168, lang: "zh", title: "鬼谷子", category: "中文 · 纵横家", expect: "鬼谷子" },
  { id: "mutianzi-zhuan-gutenberg-zh", pg: 24058, lang: "zh", title: "穆天子传", category: "中文 · 史传", expect: "穆天子" },
  { id: "haishanghua-liezhuan-gutenberg-zh", pg: 26872, lang: "zh", title: "海上花列傳", category: "中文 · 近代小说", expect: "海上花列傳" },
  { id: "fengyue-meng-gutenberg-zh", pg: 26931, lang: "zh", title: "風月夢", category: "中文 · 近代小说", expect: "風月夢" },
  { id: "hanshi-waizhuan-gutenberg-zh", pg: 7290, lang: "zh", title: "韓詩外傳", category: "中文 · 儒家", expect: "韓詩外傳" },
  // Gutenberg #24040 metadata is public-domain, but its text/EPUB body is
  // mojibake. Keep it out until we find a clean public-domain/CC0 source.

  { id: "alice-wonderland-gutenberg-en", pg: 11, lang: "en", title: "Alice's Adventures in Wonderland", category: "English · Fiction", expect: "Alice" },
  { id: "pride-prejudice-gutenberg-en", pg: 1342, lang: "en", title: "Pride and Prejudice", category: "English · Fiction", expect: "Pride" },
  { id: "frankenstein-gutenberg-en", pg: 84, lang: "en", title: "Frankenstein", category: "English · Fiction", expect: "Frankenstein" },
  { id: "moby-dick-gutenberg-en", pg: 2701, lang: "en", title: "Moby-Dick", category: "English · Fiction", expect: "Moby" },
  { id: "dracula-gutenberg-en", pg: 345, lang: "en", title: "Dracula", category: "English · Fiction", expect: "Dracula" },
  { id: "sherlock-holmes-gutenberg-en", pg: 1661, lang: "en", title: "The Adventures of Sherlock Holmes", category: "English · Detective", expect: "Sherlock" },
  { id: "tale-two-cities-gutenberg-en", pg: 98, lang: "en", title: "A Tale of Two Cities", category: "English · Fiction", expect: "Cities" },
  { id: "yellow-wallpaper-gutenberg-en", pg: 1952, lang: "en", title: "The Yellow Wallpaper", category: "English · Fiction", expect: "Wallpaper" },
  { id: "jane-eyre-gutenberg-en", pg: 1260, lang: "en", title: "Jane Eyre", category: "English · Fiction", expect: "Jane" },
  { id: "huckleberry-finn-gutenberg-en", pg: 76, lang: "en", title: "Adventures of Huckleberry Finn", category: "English · Fiction", expect: "Huckleberry" },
  { id: "treasure-island-gutenberg-en", pg: 120, lang: "en", title: "Treasure Island", category: "English · Adventure", expect: "Treasure" },
  { id: "dorian-gray-gutenberg-en", pg: 174, lang: "en", title: "The Picture of Dorian Gray", category: "English · Fiction", expect: "Dorian" },
  { id: "time-machine-gutenberg-en", pg: 35, lang: "en", title: "The Time Machine", category: "English · Science Fiction", expect: "Time Machine" },
  { id: "war-worlds-gutenberg-en", pg: 36, lang: "en", title: "The War of the Worlds", category: "English · Science Fiction", expect: "Worlds" },
  { id: "christmas-carol-gutenberg-en", pg: 46, lang: "en", title: "A Christmas Carol", category: "English · Fiction", expect: "Christmas" },
  { id: "great-expectations-gutenberg-en", pg: 1400, lang: "en", title: "Great Expectations", category: "English · Fiction", expect: "Expectations" },
  { id: "crime-punishment-gutenberg-en", pg: 2554, lang: "en", title: "Crime and Punishment", category: "English · Fiction", expect: "Punishment" },
  { id: "brothers-karamazov-gutenberg-en", pg: 28054, lang: "en", title: "The Brothers Karamazov", category: "English · Fiction", expect: "Karamazov" },
  { id: "little-women-gutenberg-en", pg: 514, lang: "en", title: "Little Women", category: "English · Fiction", expect: "Little Women" },
  { id: "count-monte-cristo-gutenberg-en", pg: 1184, lang: "en", title: "The Count of Monte Cristo", category: "English · Adventure", expect: "Monte Cristo" },
  { id: "gulliver-travels-gutenberg-en", pg: 829, lang: "en", title: "Gulliver's Travels", category: "English · Satire", expect: "Gulliver" },
  { id: "tom-sawyer-gutenberg-en", pg: 74, lang: "en", title: "The Adventures of Tom Sawyer", category: "English · Fiction", expect: "Tom Sawyer" },
  { id: "walden-gutenberg-en", pg: 205, lang: "en", title: "Walden", category: "English · Philosophy", expect: "Walden" },
  { id: "prince-gutenberg-en", pg: 1232, lang: "en", title: "The Prince", category: "English · Political Philosophy", expect: "Prince" },
  { id: "wuthering-heights-gutenberg-en", pg: 768, lang: "en", title: "Wuthering Heights", category: "English · Fiction", expect: "Wuthering" },
  { id: "emma-gutenberg-en", pg: 158, lang: "en", title: "Emma", category: "English · Fiction", expect: "Emma" },
  { id: "sense-sensibility-gutenberg-en", pg: 161, lang: "en", title: "Sense and Sensibility", category: "English · Fiction", expect: "Sensibility" },
  { id: "study-scarlet-gutenberg-en", pg: 244, lang: "en", title: "A Study in Scarlet", category: "English · Detective", expect: "Scarlet" },
  { id: "dr-jekyll-gutenberg-en", pg: 43, lang: "en", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", category: "English · Fiction", expect: "Jekyll" },
  { id: "wizard-oz-gutenberg-en", pg: 55, lang: "en", title: "The Wonderful Wizard of Oz", category: "English · Fantasy", expect: "Wizard" },
  { id: "dubliners-gutenberg-en", pg: 2814, lang: "en", title: "Dubliners", category: "English · Fiction", expect: "Dubliners" },
  { id: "leviathan-gutenberg-en", pg: 3207, lang: "en", title: "Leviathan", category: "English · Philosophy", expect: "Leviathan" },
  { id: "wealth-nations-gutenberg-en", pg: 3300, lang: "en", title: "An Inquiry into the Nature and Causes of the Wealth of Nations", category: "English · Economics", expect: "Wealth" },
  { id: "jungle-book-gutenberg-en", pg: 236, lang: "en", title: "The Jungle Book", category: "English · Fiction", expect: "Jungle" },
  { id: "secret-garden-gutenberg-en", pg: 113, lang: "en", title: "The Secret Garden", category: "English · Fiction", expect: "Secret Garden" },
  { id: "anne-green-gables-gutenberg-en", pg: 45, lang: "en", title: "Anne of Green Gables", category: "English · Fiction", expect: "Anne" },
  { id: "peter-pan-gutenberg-en", pg: 16, lang: "en", title: "Peter Pan", category: "English · Fiction", expect: "Peter Pan" },
  { id: "hamlet-gutenberg-en", pg: 1524, lang: "en", title: "Hamlet", category: "English · Drama", expect: "Hamlet" },
  { id: "macbeth-gutenberg-en", pg: 1533, lang: "en", title: "Macbeth", category: "English · Drama", expect: "Macbeth" },
  { id: "romeo-juliet-gutenberg-en", pg: 1513, lang: "en", title: "Romeo and Juliet", category: "English · Drama", expect: "Romeo" },
  { id: "odyssey-gutenberg-en", pg: 1727, lang: "en", title: "The Odyssey", category: "English · Epic", expect: "Odyssey" },
  { id: "leaves-grass-gutenberg-en", pg: 1322, lang: "en", title: "Leaves of Grass", category: "English · Poetry", expect: "Leaves" },
  { id: "grimms-fairy-tales-gutenberg-en", pg: 2591, lang: "en", title: "Grimms' Fairy Tales", category: "English · Folklore", expect: "Grimms" },
  { id: "call-wild-gutenberg-en", pg: 215, lang: "en", title: "The Call of the Wild", category: "English · Fiction", expect: "Call" },
  { id: "white-fang-gutenberg-en", pg: 910, lang: "en", title: "White Fang", category: "English · Fiction", expect: "White Fang" },
  { id: "heart-darkness-gutenberg-en", pg: 219, lang: "en", title: "Heart of Darkness", category: "English · Fiction", expect: "Darkness" },
  { id: "turn-screw-gutenberg-en", pg: 209, lang: "en", title: "The Turn of the Screw", category: "English · Fiction", expect: "Screw" },
  { id: "wind-willows-gutenberg-en", pg: 27805, lang: "en", title: "The Wind in the Willows", category: "English · Fiction", expect: "Willows" },
  { id: "tarzan-apes-gutenberg-en", pg: 78, lang: "en", title: "Tarzan of the Apes", category: "English · Adventure", expect: "Tarzan" },
  { id: "red-badge-courage-gutenberg-en", pg: 73, lang: "en", title: "The Red Badge of Courage", category: "English · Fiction", expect: "Courage" },
  { id: "around-world-gutenberg-en", pg: 103, lang: "en", title: "Around the World in Eighty Days", category: "English · Adventure", expect: "World" },
  { id: "scarlet-letter-gutenberg-en", pg: 33, lang: "en", title: "The Scarlet Letter", category: "English · Fiction", expect: "Scarlet Letter" },
  { id: "middlemarch-gutenberg-en", pg: 145, lang: "en", title: "Middlemarch", category: "English · Fiction", expect: "Middlemarch" },
  { id: "room-view-gutenberg-en", pg: 2641, lang: "en", title: "A Room with a View", category: "English · Fiction", expect: "Room with a View" },
  { id: "hound-baskervilles-gutenberg-en", pg: 2852, lang: "en", title: "The Hound of the Baskervilles", category: "English · Detective", expect: "Baskervilles" },
  { id: "sign-four-gutenberg-en", pg: 2097, lang: "en", title: "The Sign of the Four", category: "English · Detective", expect: "Sign of the Four" },
  { id: "souls-black-folk-gutenberg-en", pg: 408, lang: "en", title: "The Souls of Black Folk", category: "English · Essays", expect: "Souls" },
  { id: "narrative-douglass-gutenberg-en", pg: 23, lang: "en", title: "Narrative of the Life of Frederick Douglass", category: "English · Memoir", expect: "Douglass" },
  { id: "paradise-lost-gutenberg-en", pg: 20, lang: "en", title: "Paradise Lost", category: "English · Epic Poetry", expect: "Paradise Lost" },
  { id: "federalist-papers-gutenberg-en", pg: 18, lang: "en", title: "The Federalist Papers", category: "English · Political Essays", expect: "Federalist" },
  { id: "utopia-gutenberg-en", pg: 2130, lang: "en", title: "Utopia", category: "English · Political Philosophy", expect: "Utopia" },
  { id: "importance-earnest-gutenberg-en", pg: 844, lang: "en", title: "The Importance of Being Earnest", category: "English · Drama", expect: "Earnest" },
  { id: "doll-house-gutenberg-en", pg: 2542, lang: "en", title: "A Doll's House", category: "English · Drama", expect: "Doll" },
  { id: "pygmalion-gutenberg-en", pg: 3825, lang: "en", title: "Pygmalion", category: "English · Drama", expect: "Pygmalion" },
  { id: "don-quixote-en-gutenberg-en", pg: 996, lang: "en", title: "Don Quixote", category: "English · Fiction", expect: "Quixote" },
  { id: "siddhartha-gutenberg-en", pg: 2500, lang: "en", title: "Siddhartha", category: "English · Fiction", expect: "Siddhartha" },
  { id: "art-of-war-gutenberg", pg: 132, lang: "en", title: "The Art of War", category: "English · Strategy", expect: "Art of War" },

  { id: "madame-bovary-gutenberg-fr", pg: 14155, lang: "fr", title: "Madame Bovary", category: "Français · Roman", expect: "Bovary" },
  { id: "candide-gutenberg-fr", pg: 4650, lang: "fr", title: "Candide", category: "Français · Conte philosophique", expect: "Candide" },
  { id: "rouge-et-noir-gutenberg-fr", pg: 798, lang: "fr", title: "Le rouge et le noir", category: "Français · Roman", expect: "rouge" },
  { id: "trois-mousquetaires-gutenberg-fr", pg: 13951, lang: "fr", title: "Les trois mousquetaires", category: "Français · Roman", expect: "mousquetaires" },
  { id: "fleurs-du-mal-gutenberg-fr", pg: 6099, lang: "fr", title: "Les Fleurs du Mal", category: "Français · Poésie", expect: "Fleurs" },
  { id: "swann-gutenberg-fr", pg: 2650, lang: "fr", title: "Du côté de chez Swann", category: "Français · Roman", expect: "Swann" },
  { id: "les-miserables-fantine-gutenberg-fr", pg: 17489, lang: "fr", title: "Les misérables Tome I: Fantine", category: "Français · Roman", expect: "Fantine" },
  { id: "notre-dame-paris-gutenberg-fr", pg: 70891, lang: "fr", title: "Notre-Dame de Paris - Tome 1", category: "Français · Roman", expect: "Notre-Dame" },
  { id: "journey-center-earth-gutenberg-fr", pg: 4791, lang: "fr", title: "Voyage au Centre de la Terre", category: "Français · Aventure", expect: "Terre" },
  { id: "monte-cristo-tome1-gutenberg-fr", pg: 17989, lang: "fr", title: "Le comte de Monte-Cristo, Tome I", category: "Français · Aventure", expect: "Monte-Cristo" },
  { id: "fantome-opera-gutenberg-fr", pg: 62215, lang: "fr", title: "Le Fantôme de l'Opéra", category: "Français · Roman", expect: "Fantôme" },
  { id: "arsene-lupin-gutenberg-fr", pg: 32854, lang: "fr", title: "Arsène Lupin, gentleman-cambrioleur", category: "Français · Policier", expect: "Lupin" },
  { id: "ile-mysterieuse-gutenberg-fr", pg: 14287, lang: "fr", title: "L'île mystérieuse", category: "Français · Aventure", expect: "mystérieuse" },
  { id: "romeo-juliette-gutenberg-fr", pg: 18143, lang: "fr", title: "Roméo et Juliette", category: "Français · Théâtre", expect: "Juliette" },
  { id: "memoires-outre-tombe-t4-gutenberg-fr", pg: 25575, lang: "fr", title: "Mémoires d'Outre-Tombe, Tome 4", category: "Français · Mémoires", expect: "Outre-Tombe" },

  { id: "faust-i-gutenberg-de", pg: 2229, lang: "de", title: "Faust I", category: "Deutsch · Drama", expect: "Faust" },
  { id: "faust-ii-gutenberg-de", pg: 2230, lang: "de", title: "Faust II", category: "Deutsch · Drama", expect: "Faust" },
  { id: "verwandlung-gutenberg-de", pg: 22367, lang: "de", title: "Die Verwandlung", category: "Deutsch · Erzählung", expect: "Verwandlung" },
  { id: "zarathustra-gutenberg-de", pg: 7205, lang: "de", title: "Also sprach Zarathustra", category: "Deutsch · Philosophie", expect: "Zarathustra" },
  { id: "immensee-gutenberg-de", pg: 6651, lang: "de", title: "Immensee", category: "Deutsch · Novelle", expect: "Immensee" },
  { id: "werther-1-gutenberg-de", pg: 2407, lang: "de", title: "Die Leiden des jungen Werther — Band 1", category: "Deutsch · Roman", expect: "Werther" },
  { id: "werther-2-gutenberg-de", pg: 2408, lang: "de", title: "Die Leiden des jungen Werther — Band 2", category: "Deutsch · Roman", expect: "Werther" },
  { id: "taugenichts-gutenberg-de", pg: 35312, lang: "de", title: "Aus dem Leben eines Taugenichts", category: "Deutsch · Novelle", expect: "Taugenichts" },
  { id: "traumdeutung-gutenberg-de", pg: 40739, lang: "de", title: "Die Traumdeutung", category: "Deutsch · Psychologie", expect: "Traumdeutung" },
  { id: "gogol-dramatische-werke-gutenberg-de", pg: 55487, lang: "de", title: "Sämmtliche Werke 5: Dramatische Werke", category: "Deutsch · Drama", expect: "Gogol" },
  { id: "mabuse-gutenberg-de", pg: 50285, lang: "de", title: "Dr. Mabuse, der Spieler", category: "Deutsch · Roman", expect: "Mabuse" },
  { id: "buddenbrooks-gutenberg-de", pg: 34811, lang: "de", title: "Buddenbrooks", category: "Deutsch · Roman", expect: "Buddenbrooks" },

  { id: "divina-commedia-gutenberg-it", pg: 1000, lang: "it", title: "La Divina Commedia", category: "Italiano · Poesia", expect: "Commedia" },
  { id: "pinocchio-gutenberg-it", pg: 52484, lang: "it", title: "Le avventure di Pinocchio", category: "Italiano · Narrativa", expect: "Pinocchio" },
  { id: "promessi-sposi-gutenberg-it", pg: 45334, lang: "it", title: "I promessi sposi", category: "Italiano · Romanzo", expect: "Promessi" },
  { id: "orlando-furioso-gutenberg-it", pg: 3747, lang: "it", title: "Orlando Furioso", category: "Italiano · Poema", expect: "Orlando" },
  { id: "divina-dottrina-gutenberg-it", pg: 26961, lang: "it", title: "Libro della divina dottrina", category: "Italiano · Mistica", expect: "divina dottrina" },
  { id: "demagoghi-gutenberg-it", pg: 22026, lang: "it", title: "I demagoghi", category: "Italiano · Romanzo", expect: "demagoghi" },
  { id: "damiano-gutenberg-it", pg: 25178, lang: "it", title: "Damiano", category: "Italiano · Romanzo", expect: "Damiano" },
  { id: "carita-prossimo-gutenberg-it", pg: 25179, lang: "it", title: "La carità del prossimo", category: "Italiano · Romanzo", expect: "prossimo" },
  { id: "favorita-mahdi-gutenberg-it", pg: 25180, lang: "it", title: "La favorita del Mahdi", category: "Italiano · Avventura", expect: "Mahdi" },

  { id: "don-quijote-gutenberg-es", pg: 2000, lang: "es", title: "Don Quijote", category: "Español · Novela", expect: "Quijote" },
  { id: "celestina-gutenberg-es", pg: 1619, lang: "es", title: "La Celestina", category: "Español · Teatro", expect: "Celestina" },
  { id: "lazarillo-gutenberg-es", pg: 320, lang: "es", title: "Lazarillo de Tormes", category: "Español · Novela", expect: "Lazarillo" },
  { id: "crimen-castigo-gutenberg-es", pg: 61851, lang: "es", title: "El crimen y el castigo", category: "Español · Novela", expect: "castigo" },
  { id: "argonautas-gutenberg-es", pg: 25640, lang: "es", title: "Los argonautas", category: "Español · Novela", expect: "argonautas" },
  { id: "odisea-gutenberg-es", pg: 58221, lang: "es", title: "La Odisea", category: "Español · Épica", expect: "Odisea" },
  { id: "spanish-american-reader-gutenberg-es", pg: 39647, lang: "es", title: "The Spanish American Reader", category: "Español · Lecturas", expect: "Spanish American" },
  { id: "historia-literatura-dramatico-gutenberg-es", pg: 25988, lang: "es", title: "Historia de la literatura y del arte dramático en España, tomo II", category: "Español · Historia literaria", expect: "literatura" },
  { id: "el-mar-gutenberg-es", pg: 26284, lang: "es", title: "El Mar", category: "Español · Ciencia natural", expect: "El Mar" },
  { id: "jose-gutenberg-es", pg: 27738, lang: "es", title: "José", category: "Español · Lecturas", expect: "José" },
  { id: "quilito-gutenberg-es", pg: 23035, lang: "es", title: "Quilito", category: "Español · Novela", expect: "Quilito" },

  { id: "dom-casmurro-gutenberg-pt", pg: 55752, lang: "pt", title: "Dom Casmurro", category: "Português · Romance", expect: "Casmurro" },
  { id: "bras-cubas-gutenberg-pt", pg: 54829, lang: "pt", title: "Memórias Póstumas de Brás Cubas", category: "Português · Romance", expect: "Braz" },
  { id: "quincas-borba-gutenberg-pt", pg: 55682, lang: "pt", title: "Quincas Borba", category: "Português · Romance", expect: "Quincas" },
  { id: "minas-salomao-gutenberg-pt", pg: 22015, lang: "pt", title: "As Minas de Salomão", category: "Português · Aventura", expect: "Salomão" },
  { id: "iracema-gutenberg-pt", pg: 67740, lang: "pt", title: "Iracema", category: "Português · Romance", expect: "Iracema" },
  { id: "viagens-minha-terra-gutenberg-pt", pg: 24401, lang: "pt", title: "Viagens na Minha Terra", category: "Português · Romance", expect: "Viagens" },
  { id: "cinco-minutos-gutenberg-pt", pg: 44540, lang: "pt", title: "Cinco minutos", category: "Português · Romance", expect: "Cinco minutos" },
  { id: "pata-gazella-gutenberg-pt", pg: 67831, lang: "pt", title: "A Pata da Gazella", category: "Português · Romance", expect: "Gazella" },
  { id: "ubirajara-gutenberg-pt", pg: 38496, lang: "pt", title: "Ubirajara", category: "Português · Lenda", expect: "Ubirajara" },
  { id: "frei-luiz-sousa-gutenberg-pt", pg: 17591, lang: "pt", title: "Frei Luiz de Sousa", category: "Português · Drama", expect: "Frei Luiz" },
  { id: "illustre-casa-ramires-gutenberg-pt", pg: 23145, lang: "pt", title: "A Illustre Casa de Ramires", category: "Português · Romance", expect: "Ramires" },
  { id: "viriatho-gutenberg-pt", pg: 26850, lang: "pt", title: "Viriatho", category: "Português · Romance histórico", expect: "Viriatho" },
  { id: "poesias-herculano-gutenberg-pt", pg: 25925, lang: "pt", title: "Poesias", category: "Português · Poesia", expect: "Poesias" },
  { id: "four-plays-gil-vicente-gutenberg-pt", pg: 28399, lang: "pt", title: "Four Plays of Gil Vicente", category: "Português · Teatro", expect: "Vicente" },

  { id: "max-havelaar-gutenberg-nl", pg: 11024, lang: "nl", title: "Max Havelaar", category: "Nederlands · Roman", expect: "Havelaar" },
  { id: "onder-moeders-vleugels-gutenberg-nl", pg: 17337, lang: "nl", title: "Onder Moeders Vleugels", category: "Nederlands · Roman", expect: "Moeders" },
  { id: "prometheus-geboeid-gutenberg-nl", pg: 57697, lang: "nl", title: "Prometheus Geboeid", category: "Nederlands · Drama", expect: "Prometheus" },
  { id: "nederlandsche-volkskunde-gutenberg-nl", pg: 22968, lang: "nl", title: "Nederlandsche Volkskunde", category: "Nederlands · Volkskunde", expect: "Volkskunde" },
  { id: "gevoel-en-verstand-gutenberg-nl", pg: 25946, lang: "nl", title: "Gevoel en verstand", category: "Nederlands · Roman", expect: "verstand" },
  { id: "noli-me-tangere-gutenberg-nl", pg: 21848, lang: "nl", title: "Noli me tangere", category: "Nederlands · Roman", expect: "Noli" },
  { id: "andersens-sproken-gutenberg-nl", pg: 25580, lang: "nl", title: "Andersens Sproken en vertellingen", category: "Nederlands · Sprookjes", expect: "Andersens" },
  { id: "egyptische-koningsdochter-gutenberg-nl", pg: 28120, lang: "nl", title: "Eene Egyptische Koningsdochter", category: "Nederlands · Historische roman", expect: "Koningsdochter" },
  { id: "dokter-helmond-gutenberg-nl", pg: 25138, lang: "nl", title: "Dokter Helmond en zijn vrouw", category: "Nederlands · Roman", expect: "Helmond" },
  { id: "ivanhoe-gutenberg-nl", pg: 26564, lang: "nl", title: "Ivanhoe", category: "Nederlands · Historische roman", expect: "Ivanhoe" },
  { id: "betuwsche-novellen-gutenberg-nl", pg: 26483, lang: "nl", title: "Betuwsche novellen", category: "Nederlands · Novellen", expect: "Betuwsche" },
  { id: "kalevala-gutenberg-fi", pg: 7000, lang: "fi", title: "Kalevala", category: "Suomi · Eepos", expect: "Kalevala" },
  { id: "agamemnon-gutenberg-fi", pg: 53137, lang: "fi", title: "Agamemnon", category: "Suomi · Draama", expect: "Agamemnon" },
  { id: "aisopoksen-satuja-gutenberg-fi", pg: 74326, lang: "fi", title: "Aisopoksen satuja", category: "Suomi · Sadut", expect: "Aisopoksen" },
  { id: "kavaluus-rakkaus-gutenberg-fi", pg: 49552, lang: "fi", title: "Kavaluus ja rakkaus", category: "Suomi · Draama", expect: "Kavaluus" },
  { id: "rautakorko-gutenberg-fi", pg: 24848, lang: "fi", title: "Rautakorko", category: "Suomi · Romaani", expect: "Rautakorko" },
  { id: "ihmisvihaaja-gutenberg-fi", pg: 78042, lang: "fi", title: "Ihmisvihaaja", category: "Suomi · Draama", expect: "Ihmisvihaaja" },
  { id: "huligaani-gutenberg-fi", pg: 78081, lang: "fi", title: "Huligaani", category: "Suomi · Novellit", expect: "Huligaani" },
  { id: "sointula-gutenberg-fi", pg: 78049, lang: "fi", title: "Sointula", category: "Suomi · Draama", expect: "Sointula" },
  { id: "karavaani-gutenberg-fi", pg: 78018, lang: "fi", title: "Karavaani ja muita juttuja", category: "Suomi · Novellit", expect: "Karavaani" },
  { id: "terveeks-buddha-gutenberg-fi", pg: 76730, lang: "fi", title: "Terveeks' — Buddha!", category: "Suomi · Matkakertomus", expect: "Buddha" },
  { id: "hauska-tutustua-gutenberg-fi", pg: 78008, lang: "fi", title: "Hauska tutustua!", category: "Suomi · Kertomukset", expect: "Hauska" },
  { id: "velisurmaaja-gutenberg-fi", pg: 78070, lang: "fi", title: "Velisurmaaja", category: "Suomi · Draama", expect: "Velisurmaaja" },
  { id: "lintukoto-gutenberg-fi", pg: 78058, lang: "fi", title: "Lintukoto", category: "Suomi · Kertomukset", expect: "Lintukoto" },
  { id: "roda-rummet-gutenberg-sv", pg: 57052, lang: "sv", title: "Röda rummet", category: "Svenska · Roman", expect: "Röda" },
  { id: "hemsoborna-gutenberg-sv", pg: 30078, lang: "sv", title: "Hemsöborna", category: "Svenska · Roman", expect: "Hemsöborna" },
  { id: "det-gar-an-gutenberg-sv", pg: 14670, lang: "sv", title: "Det går an", category: "Svenska · Roman", expect: "Det går an" },
  { id: "kalevala-sv-gutenberg-sv", pg: 56421, lang: "sv", title: "Kalevala", category: "Svenska · Epos", expect: "Kalevala" },
  { id: "teckningar-drommar-gutenberg-sv", pg: 27875, lang: "sv", title: "Teckningar och drömmar", category: "Svenska · Noveller", expect: "Teckningar" },
  { id: "utvecklingstid-gutenberg-sv", pg: 26479, lang: "sv", title: "I Utvecklingstid", category: "Svenska · Ungdom", expect: "Utvecklingstid" },
  { id: "carl-svenske-gutenberg-sv", pg: 65580, lang: "sv", title: "Carl Svenske", category: "Svenska · Historisk roman", expect: "Carl Svenske" },
  { id: "katornas-folk-gutenberg-sv", pg: 62806, lang: "sv", title: "Kåtornas folk", category: "Svenska · Resa", expect: "Kåtornas" },
  { id: "i-marginalen-gutenberg-sv", pg: 26347, lang: "sv", title: "I marginalen", category: "Svenska · Essäer", expect: "marginalen" },
  { id: "moloks-leende-gutenberg-sv", pg: 62635, lang: "sv", title: "Moloks leende", category: "Svenska · Roman", expect: "Moloks" },
  { id: "den-ljusa-skalpen-gutenberg-sv", pg: 63403, lang: "sv", title: "Den ljusa skalpen", category: "Svenska · Noveller", expect: "skalpen" },
  { id: "drottning-moi-meme-gutenberg-sv", pg: 59921, lang: "sv", title: "Drottning Moi-Même", category: "Svenska · Historisk roman", expect: "Moi" },
  { id: "adelt-vildt-gutenberg-sv", pg: 59341, lang: "sv", title: "Ädelt vildt", category: "Svenska · Roman", expect: "vildt" },
  { id: "en-piga-bland-pigor-gutenberg-sv", pg: 48961, lang: "sv", title: "En piga bland pigor", category: "Svenska · Reportage", expect: "piga" },
  { id: "vildanden-gutenberg-no", pg: 13041, lang: "no", title: "Vildanden", category: "Norsk · Drama", expect: "Vildanden" },
  { id: "sult-gutenberg-no", pg: 30027, lang: "no", title: "Sult", category: "Norsk · Roman", expect: "Sult" },
  { id: "markens-grode-1-gutenberg-no", pg: 43724, lang: "no", title: "Markens grøde, Første del", category: "Norsk · Roman", expect: "Markens" },
  { id: "markens-grode-2-gutenberg-no", pg: 43725, lang: "no", title: "Markens grøde, Anden del", category: "Norsk · Roman", expect: "Markens" },
  { id: "catilina-gutenberg-no", pg: 16665, lang: "no", title: "Catilina", category: "Norsk · Drama", expect: "Catilina" },
  { id: "fru-inger-gutenberg-no", pg: 15669, lang: "no", title: "Fru Inger til Østråt", category: "Norsk · Drama", expect: "Fru Inger" },
  { id: "haermaendene-helgeland-gutenberg-no", pg: 14686, lang: "no", title: "Hærmændene på Helgeland", category: "Norsk · Drama", expect: "Helgeland" },
  { id: "kaerlighedens-komedie-gutenberg-no", pg: 15748, lang: "no", title: "Kærlighedens Komedie", category: "Norsk · Drama", expect: "Kærlighedens" },
  { id: "gildet-solhaug-gutenberg-no", pg: 15291, lang: "no", title: "Gildet på Solhaug", category: "Norsk · Drama", expect: "Solhaug" },
  { id: "baron-munchhausen-gutenberg-no", pg: 63200, lang: "no", title: "Baron von Münchhausens merkværdige reiser og eventyr", category: "Norsk · Eventyr", expect: "Münchhausen" },
  { id: "onkel-toms-hytte-gutenberg-no", pg: 56863, lang: "no", title: "Onkel Toms Hytte", category: "Norsk · Roman", expect: "Toms" },
  { id: "pelle-erobreren-1-gutenberg-da", pg: 76563, lang: "da", title: "Pelle Erobreren 1: Barndom", category: "Dansk · Roman", expect: "Pelle" },
  { id: "pelle-erobreren-2-gutenberg-da", pg: 76723, lang: "da", title: "Pelle Erobreren 2: Læreaar", category: "Dansk · Roman", expect: "Pelle" },
  { id: "pelle-erobreren-3-gutenberg-da", pg: 76883, lang: "da", title: "Pelle Erobreren 3: Den store Kamp", category: "Dansk · Roman", expect: "Pelle" },
  { id: "pelle-erobreren-4-gutenberg-da", pg: 77037, lang: "da", title: "Pelle Erobreren 4: Gryet", category: "Dansk · Roman", expect: "Pelle" },
  { id: "tine-gutenberg-da", pg: 10686, lang: "da", title: "Tine", category: "Dansk · Roman", expect: "Tine" },
  { id: "ved-vejen-gutenberg-da", pg: 13175, lang: "da", title: "Ved Vejen", category: "Dansk · Roman", expect: "Ved Vejen" },
  { id: "kongens-fald-gutenberg-da", pg: 36942, lang: "da", title: "Kongens Fald", category: "Dansk · Roman", expect: "Kongens Fald" },
  { id: "bjorneaet-gutenberg-da", pg: 43781, lang: "da", title: "Bjørneæt", category: "Dansk · Historisk roman", expect: "Bjørneæt" },

  { id: "rashomon-gutenberg-ja", pg: 1982, lang: "ja", title: "羅生門", category: "日本語 · 小説", expect: "羅生門" },
  { id: "kesshoki-gutenberg-ja", pg: 34013, lang: "ja", title: "血笑記", category: "日本語 · 翻訳小説", expect: "血笑記" },
  { id: "kumogata-monsho-gutenberg-ja", pg: 35018, lang: "ja", title: "雲形紋章", category: "日本語 · 小説", expect: "雲形紋章" },
  { id: "irekawatta-otoko-gutenberg-ja", pg: 34158, lang: "ja", title: "入れかわった男", category: "日本語 · 小説", expect: "入れかわった男" },
  { id: "shisei-gutenberg-ja", pg: 31617, lang: "ja", title: "刺青", category: "日本語 · 小説", expect: "刺" },
  { id: "atsumono-gutenberg-ja", pg: 36459, lang: "ja", title: "羹", category: "日本語 · 小説", expect: "羹" },
  { id: "america-monogatari-gutenberg-ja", pg: 35327, lang: "ja", title: "あめりか物語", category: "日本語 · 小説", expect: "あめりか" },
  { id: "doko-e-gutenberg-ja", pg: 32941, lang: "ja", title: "何處へ", category: "日本語 · 小説", expect: "何處" },
  { id: "horadanshaku-tabi-gutenberg-ja", pg: 34084, lang: "ja", title: "法螺男爵旅土産", category: "日本語 · 小説", expect: "法螺男爵" },
  { id: "kumon-no-ran-gutenberg-ja", pg: 39287, lang: "ja", title: "苦悶の欄", category: "日本語 · 小説", expect: "苦悶" },
  { id: "geshukunin-gutenberg-ja", pg: 32978, lang: "ja", title: "下宿人", category: "日本語 · 小説", expect: "下宿人" },
  { id: "junkyo-shishu-gutenberg-ja", pg: 38697, lang: "ja", title: "殉情詩集", category: "日本語 · 詩集", expect: "殉情" },
  { id: "akuma-gutenberg-ja", pg: 37605, lang: "ja", title: "惡魔", category: "日本語 · 小説", expect: "惡魔" },
  { id: "zoku-akuma-gutenberg-ja", pg: 37626, lang: "ja", title: "續惡魔", category: "日本語 · 小説", expect: "續惡魔" },
  { id: "luther-catechism-gutenberg-ja", pg: 2592, lang: "ja", title: "マルチン・ルターの小信仰問答書", category: "日本語 · 宗教", expect: "ルター" },

  { id: "duhovnye-ody-gutenberg-ru", pg: 14741, lang: "ru", title: "Духовные оды", category: "Русский · Поэзия", expect: "Духовные" },
  { id: "krasavitse-tabak-gutenberg-ru", pg: 5316, lang: "ru", title: "Красавице, которая нюхала табак", category: "Русский · Поэзия", expect: "Красавице" },
  { id: "zadachi-ustnogo-scheta-gutenberg-ru", pg: 16527, lang: "ru", title: "1001 задача для умственного счета", category: "Русский · Математика", expect: "1001" },
  { id: "moskovia-inostrantsev-gutenberg-ru", pg: 30774, lang: "ru", title: "Московия в представлении иностранцев XVI-XVII в.", category: "Русский · История", expect: "Московия" },
  { id: "pan-tadeusz-gutenberg-pl", pg: 31536, lang: "pl", title: "Pan Tadeusz", category: "Polski · Poezja", expect: "Tadeusz" },
  { id: "tajemnica-baskerville-gutenberg-pl", pg: 34079, lang: "pl", title: "Tajemnica Baskerville'ów", category: "Polski · Detektywistyczna", expect: "Baskerville" },
  { id: "romeo-julia-gutenberg-pl", pg: 27062, lang: "pl", title: "Romeo i Julia", category: "Polski · Dramat", expect: "Romeo" },
  { id: "grazyna-gutenberg-pl", pg: 28153, lang: "pl", title: "Grażyna", category: "Polski · Poezja", expect: "Grażyna" },
  { id: "bajki-mickiewicz-gutenberg-pl", pg: 27729, lang: "pl", title: "Bajki", category: "Polski · Bajki", expect: "Bajki" },
  { id: "balady-romanse-gutenberg-pl", pg: 28049, lang: "pl", title: "Balady i romanse", category: "Polski · Poezja", expect: "Balady" },
  { id: "sonety-mickiewicza-gutenberg-pl", pg: 27081, lang: "pl", title: "Sonety Adama Mickiewicza", category: "Polski · Poezja", expect: "Sonety" },
  { id: "kopciuszek-gutenberg-pl", pg: 28044, lang: "pl", title: "Kopciuszek", category: "Polski · Baśnie", expect: "Kopciuszek" },
  { id: "odkrycia-wynalazki-gutenberg-pl", pg: 30407, lang: "pl", title: "O odkryciach i wynalazkach", category: "Polski · Nauka", expect: "odkrycia" },
  { id: "sklepy-cynamonowe-gutenberg-pl", pg: 8119, lang: "pl", title: "Sklepy cynamonowe", category: "Polski · Proza", expect: "Sklepy" },
  { id: "laka-lesmian-gutenberg-pl", pg: 35301, lang: "pl", title: "Łąka", category: "Polski · Poezja", expect: "Łąka" },
  { id: "menazerya-ludzka-gutenberg-pl", pg: 34635, lang: "pl", title: "Menazerya ludzka", category: "Polski · Proza", expect: "Menazerya" },
  { id: "jeden-miesiac-zycia-gutenberg-pl", pg: 28014, lang: "pl", title: "Jeden miesiąc życia", category: "Polski · Proza", expect: "miesiąc" },
  { id: "zywila-gutenberg-pl", pg: 28168, lang: "pl", title: "Żywila", category: "Polski · Proza historyczna", expect: "Żywila" },
  { id: "rur-gutenberg-cs", pg: 13083, lang: "cs", title: "R.U.R.", category: "Čeština · Drama", expect: "R.U.R." },
  { id: "zapisky-mrtveho-domu-gutenberg-cs", pg: 34225, lang: "cs", title: "Zápisky z mrtvého domu", category: "Čeština · Román", expect: "Zápisky" },
  { id: "dvojnik-gutenberg-cs", pg: 37525, lang: "cs", title: "Dvojník", category: "Čeština · Novela", expect: "Dvojník" },
  { id: "sto-jisker-ethickych-gutenberg-cs", pg: 68828, lang: "cs", title: "Sto jisker ethických", category: "Čeština · Etika", expect: "jisker" },
  { id: "esperanto-ucebnice-gutenberg-cs", pg: 24575, lang: "cs", title: "Úplná učebnice mezinárodní řeči dra. Esperanta", category: "Čeština · Učebnice", expect: "Esperanta" },
  { id: "katolicky-katechismus-gutenberg-cs", pg: 16843, lang: "cs", title: "Cvičení maličkých ve svatém náboženství křesťansko-katolickém", category: "Čeština · Náboženství", expect: "náboženství" },
  { id: "citanka-pro-skoly-gutenberg-cs", pg: 59765, lang: "cs", title: "Cítanka pro skoly obecné. Díl I", category: "Čeština · Čítanka", expect: "Cítanka" },
  { id: "petofi-poems-gutenberg-hu", pg: 41504, lang: "hu", title: "Petőfi Sándor összes költeményei", category: "Magyar · Költészet", expect: "Petőfi" },
  { id: "magyar-nepdalok-gutenberg-hu", pg: 39737, lang: "hu", title: "Magyar népdalok", category: "Magyar · Népdalok", expect: "népdalok" },
  { id: "don-quijote-gutenberg-hu", pg: 66263, lang: "hu", title: "Don Quijote de la Mancha", category: "Magyar · Regény", expect: "Quijote" },
  { id: "magyar-nepkoltesi-gyujtemeny-1-gutenberg-hu", pg: 47073, lang: "hu", title: "Magyar népköltési gyüjtemény 1. kötet", category: "Magyar · Folklór", expect: "népköltési" },
  { id: "ipolyi-nepmesegyujtemenye-gutenberg-hu", pg: 56996, lang: "hu", title: "Ipolyi Arnold népmesegyüjteménye", category: "Magyar · Népmesék", expect: "Ipolyi" },
  { id: "karolyi-gabor-feljegyzesek-1-gutenberg-hu", pg: 63002, lang: "hu", title: "Gróf Károlyi Gábor följegyzései (1. kötet)", category: "Magyar · Emlékirat", expect: "Károlyi", skipTitles: ["VII"] },
  { id: "mimozak-krizantemok-gutenberg-hu", pg: 78387, lang: "hu", title: "Mimózák és krizántémok", category: "Magyar · Mesék", expect: "Mimózák" },
  { id: "legy-jo-mindhalalig-gutenberg-hu", pg: 67140, lang: "hu", title: "Légy jó mindhalálig", category: "Magyar · Regény", expect: "mindhalálig" },
  { id: "szent-peter-esernyoje-gutenberg-hu", pg: 68911, lang: "hu", title: "Szent Péter esernyője", category: "Magyar · Regény", expect: "esernyője" },
  { id: "complete-grammar-esperanto-gutenberg-eo", pg: 7787, lang: "eo", title: "A Complete Grammar of Esperanto", category: "Esperanto · Gramatiko", expect: "Esperanto" },
  { id: "fundamenta-krestomatio-gutenberg-eo", pg: 8224, lang: "eo", title: "Fundamenta Krestomatio", category: "Esperanto · Legolibro", expect: "Krestomatio" },
  { id: "doktoro-jekyll-gutenberg-eo", pg: 24145, lang: "eo", title: "Doktoro Jekyll kaj Sinjoro Hyde", category: "Esperanto · Fikcio", expect: "Jekyll" },
  { id: "vivo-zamenhof-gutenberg-eo", pg: 26359, lang: "eo", title: "Vivo de Zamenhof", category: "Esperanto · Biografio", expect: "Zamenhof" },
  { id: "hamleto-gutenberg-eo", pg: 37279, lang: "eo", title: "Hamleto, Reĝido de Danujo", category: "Esperanto · Dramo", expect: "Hamleto" },
  { id: "nuntempaj-rakontoj-gutenberg-eo", pg: 23670, lang: "eo", title: "Nuntempaj Rakontoj", category: "Esperanto · Rakontoj", expect: "Rakontoj" },
  { id: "alicio-mirlando-gutenberg-eo", pg: 17482, lang: "eo", title: "La Aventuroj de Alicio en Mirlando", category: "Esperanto · Fantazio", expect: "Alicio" },
  { id: "mirinda-sorcisto-oz-gutenberg-eo", pg: 31348, lang: "eo", title: "La Mirinda Sorĉisto de Oz", category: "Esperanto · Fantazio", expect: "Oz" },
  { id: "un-pis-ensanche-gutenberg-ca", pg: 78123, lang: "ca", title: "Un pis al ensanche", category: "Català · Teatre", expect: "ensanche" },
  { id: "auca-senyor-esteve-gutenberg-ca", pg: 56856, lang: "ca", title: "L'auca del senyor Esteve", category: "Català · Novel·la", expect: "Esteve" },
  { id: "estudiant-garrotxa-gutenberg-ca", pg: 78392, lang: "ca", title: "L'estudiant de la Garrotxa", category: "Català · Novel·la", expect: "Garrotxa" },
  { id: "alegres-comares-windsor-gutenberg-ca", pg: 17046, lang: "ca", title: "Les alegres comares de Windsor", category: "Català · Teatre", expect: "Windsor" },
  { id: "tres-homes-barca-gutenberg-ca", pg: 29944, lang: "ca", title: "Tres Homes Dins D'una Barca", category: "Català · Humor", expect: "Barca" },
  { id: "aventures-tom-sawyer-gutenberg-ca", pg: 30890, lang: "ca", title: "Les Aventures De Tom Sawyer", category: "Català · Aventura", expect: "Sawyer" },
  { id: "contes-andersen-gutenberg-ca", pg: 27142, lang: "ca", title: "Contes D'Andersen", category: "Català · Contes", expect: "Andersen" },
  { id: "pinya-rosa-vol1-gutenberg-ca", pg: 15346, lang: "ca", title: "Pinya de Rosa. Volume 1, Books 1-3", category: "Català · Narrativa", expect: "Pinya" },
  { id: "orfaneta-menargues-gutenberg-ca", pg: 75136, lang: "ca", title: "La orfaneta de Menargues", category: "Català · Novel·la històrica", expect: "Menargues" },
  { id: "reina-del-cor-gutenberg-ca", pg: 76248, lang: "ca", title: "La reina del cor", category: "Català · Teatre", expect: "reina" },
  { id: "marxant-venecia-gutenberg-ca", pg: 27536, lang: "ca", title: "El Marxant de Venecia", category: "Català · Teatre", expect: "Venecia" },
  { id: "els-idols-gutenberg-ca", pg: 78453, lang: "ca", title: "Els idols", category: "Català · Teatre", expect: "idols" },
  { id: "tres-anglesos-gutenberg-ca", pg: 26502, lang: "ca", title: "Tres Anglesos S'esbargeixen", category: "Català · Humor", expect: "Anglesos" },
  { id: "pinya-rosa-vol2-gutenberg-ca", pg: 15347, lang: "ca", title: "Pinya de Rosa. Volume 2, Book 4", category: "Català · Narrativa", expect: "Pinya" },
  { id: "poezii-eminescu-gutenberg-ro", pg: 35323, lang: "ro", title: "Poezii", category: "Română · Poezie", expect: "Poezii" },
  { id: "nuvele-caragiale-gutenberg-ro", pg: 64597, lang: "ro", title: "Nuvele", category: "Română · Proză", expect: "Nuvele" },
  { id: "povesti-slavici-gutenberg-ro", pg: 62916, lang: "ro", title: "Povești", category: "Română · Basme", expect: "Povești" },
  { id: "noli-me-tangere-gutenberg-tl", pg: 20228, lang: "tl", title: "Noli Me Tangere", category: "Tagalog · Nobela", expect: "Noli" },
  { id: "bagong-robinson-tomo1-gutenberg-tl", pg: 20858, lang: "tl", title: "Ang Bagong Robinson (Tomo 1)", category: "Tagalog · Nobela", expect: "Robinson" },
  { id: "filibusterismo-gutenberg-tl", pg: 47629, lang: "tl", title: "Ang Filibusterismo", category: "Tagalog · Nobela", expect: "Filibusterismo" },
  { id: "doctrina-christiana-gutenberg-tl", pg: 16119, lang: "tl", title: "Doctrina Christiana", category: "Tagalog · Relihiyon", expect: "Doctrina" },
  { id: "ibong-adarna-gutenberg-tl", pg: 16157, lang: "tl", title: "Ibong Adarna", category: "Tagalog · Korido", expect: "Adarna" },
  { id: "florante-laura-gutenberg-tl", pg: 15845, lang: "tl", title: "Florante at Laura", category: "Tagalog · Tula", expect: "Florante" },
  { id: "liham-rizal-malolos-gutenberg-tl", pg: 17116, lang: "tl", title: "Ang Liham ni Dr. Jose Rizal sa mga Kadalagahan sa Malolos, Bulakan", category: "Tagalog · Sanaysay", expect: "Malolos" },
  { id: "urbana-feliza-gutenberg-tl", pg: 15980, lang: "tl", title: "Pag Susulatan nang Dalauang Binibini na si Urbana at ni Feliza", category: "Tagalog · Liham", expect: "Urbana" },
  { id: "buhay-rizal-gutenberg-tl", pg: 18282, lang: "tl", title: "Buhay at Mga Ginawâ ni Dr. José Rizal", category: "Tagalog · Talambuhay", expect: "Rizal" },
  { id: "pagibig-layas-gutenberg-tl", pg: 46639, lang: "tl", title: "Ang Pag-ibig ng Layas", category: "Tagalog · Nobela", expect: "Pag-ibig" },
  { id: "dating-pilipinas-gutenberg-tl", pg: 17787, lang: "tl", title: "Dating Pilipinas", category: "Tagalog · Kasaysayan", expect: "Pilipinas" },
  { id: "panukala-republika-gutenberg-tl", pg: 14982, lang: "tl", title: "Panukala sa Pagkakana nang República nang Pilipinas", category: "Tagalog · Pulitika", expect: "República" },
  { id: "dakilang-pilipino-gutenberg-tl", pg: 17786, lang: "tl", title: "Mga Dakilang Pilipino", category: "Tagalog · Talambuhay", expect: "Pilipino" },
  { id: "dakilang-asal-gutenberg-tl", pg: 13687, lang: "tl", title: "Dakilang Asal", category: "Tagalog · Tula", expect: "Dakilang" },
  { id: "hunger-book-one-gutenberg-he", pg: 18291, lang: "he", title: "Hunger: Book One", category: "עברית · רומן", expect: "Hunger" },
  { id: "hatzofe-beit-yisrael-gutenberg-he", pg: 45252, lang: "he", title: "הצופה לבית ישראל: תשליך", category: "עברית · סאטירה", expect: "הצופה" },
  { id: "beit-nekhot-halakhot-gutenberg-he", pg: 43740, lang: "he", title: "בית נכות ההלכות", category: "עברית · הלכה", expect: "בית נכות" },
  { id: "iliad-gutenberg-el", pg: 36248, lang: "el", title: "Ιλιάδα", category: "Ελληνικά · Έπος", expect: "Ιλιάδα" },
  { id: "peri-psyches-gutenberg-el", pg: 27816, lang: "el", title: "Περί Ψυχής", category: "Ελληνικά · Φιλοσοφία", expect: "Ψυχής" },
  { id: "odysseia-tomos-g-gutenberg-el", pg: 30615, lang: "el", title: "Ομήρου Οδύσσεια Τόμος Γ", category: "Ελληνικά · Έπος", expect: "Οδύσσεια" },
  { id: "fonissa-gutenberg-el", pg: 36205, lang: "el", title: "Η Φόνισσα", category: "Ελληνικά · Μυθιστόρημα", expect: "Φόνισσα" },
  { id: "ethika-nikomacheia-gutenberg-el", pg: 28626, lang: "el", title: "Ηθικά Νικομάχεια", category: "Ελληνικά · Φιλοσοφία", expect: "Ηθικά" },
  { id: "istoriai-herodotou-gutenberg-el", pg: 38055, lang: "el", title: "Ιστορίαι Ηροδότου, Τόμος 1", category: "Ελληνικά · Ιστορία", expect: "Ηροδότου" },
  { id: "oidipous-tyrannos-gutenberg-el", pg: 17839, lang: "el", title: "Οιδίπους Τύραννος", category: "Ελληνικά · Θέατρο", expect: "Οιδίπους" },
  { id: "timaios-a-gutenberg-el", pg: 35453, lang: "el", title: "Τίμαιος, Τόμος Α", category: "Ελληνικά · Φιλοσοφία", expect: "Τίμαιος" },
  { id: "solomos-apanta-gutenberg-el", pg: 42031, lang: "el", title: "Διονυσίου Σολωμού - Άπαντα τα Ευρισκόμενα", category: "Ελληνικά · Ποίηση", expect: "Σολωμού" },
  { id: "athinaion-politeia-gutenberg-el", pg: 39963, lang: "el", title: "Αθηναίων Πολιτεία", category: "Ελληνικά · Πολιτική", expect: "Αθηναίων" },
  { id: "kyrou-anabasis-tomos1-gutenberg-el", pg: 39764, lang: "el", title: "Κύρου Ανάβασις Τόμος 1", category: "Ελληνικά · Ιστορία", expect: "Ανάβασις" },
  { id: "aeneidos-gutenberg-la", pg: 227, lang: "la", title: "Aeneidos", category: "Latina · Epic", expect: "Aeneidos" },
  { id: "de-officiis-gutenberg-la", pg: 47001, lang: "la", title: "De Officiis", category: "Latina · Philosophy", expect: "Officiis" },
  { id: "confessiones-gutenberg-la", pg: 33849, lang: "la", title: "Confessiones", category: "Latina · Theology", expect: "Confessiones" },
  { id: "principia-mathematica-gutenberg-la", pg: 28233, lang: "la", title: "Philosophiae Naturalis Principia Mathematica", category: "Latina · Science", expect: "Principia" },
  { id: "catulli-carmina-gutenberg-la", pg: 23294, lang: "la", title: "Catulli Carmina", category: "Latina · Poetry", expect: "Catulli" },
  { id: "de-bello-catilinario-gutenberg-la", pg: 7402, lang: "la", title: "De Bello Catilinario Et Jugurthino", category: "Latina · History", expect: "Catilinario" },
  { id: "plautus-comedies-gutenberg-la", pg: 16564, lang: "la", title: "Amphitryo, Asinaria, Aulularia, Bacchides, Captivi", category: "Latina · Drama", expect: "Amphitryo" },
  { id: "horace-works-gutenberg-la", pg: 46938, lang: "la", title: "The Works of Horace", category: "Latina · Poetry", expect: "Horace" },
  { id: "cato-maior-senectute-gutenberg-la", pg: 14945, lang: "la", title: "Cato Maior de Senectute", category: "Latina · Philosophy", expect: "Senectute" },
  { id: "de-bello-gallico-gutenberg-la", pg: 218, lang: "la", title: "C. Iuli Caesaris De Bello Gallico, I-IV", category: "Latina · History", expect: "Gallico" },
  { id: "fasti-gutenberg-la", pg: 8738, lang: "la", title: "Fasti", category: "Latina · Poetry", expect: "Fasti" },
  { id: "robinson-crusoe-latin-gutenberg-la", pg: 74851, lang: "la", title: "Robinson Crusoe in Latin", category: "Latina · Fiction", expect: "Robinson" },
  { id: "georgicon-gutenberg-la", pg: 231, lang: "la", title: "Georgicon", category: "Latina · Poetry", expect: "Georgicon" },
  { id: "cicero-orations-gutenberg-la", pg: 226, lang: "la", title: "Cicero's Orations", category: "Latina · Oratory", expect: "Cicero" },
];

function parseArgs(argv) {
  const out = { publish: false, json: false, apiUrl: API_URL, ids: BOOKS.map((b) => b.id) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish" || arg === "--json" || arg === "--summary") {
      out[arg.slice(2)] = true;
      continue;
    }
    if (arg === "--continue-on-error") {
      out.continueOnError = true;
      continue;
    }
    if (arg === "--api-url" || arg === "--ids") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--api-url") out.apiUrl = value.replace(/\/+$/, "");
      else out.ids = value.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function epubUrls(book) {
  return [
    `https://www.gutenberg.org/ebooks/${book.pg}.epub.images`,
    `https://www.gutenberg.org/ebooks/${book.pg}.epub.noimages`,
    `https://www.gutenberg.org/ebooks/${book.pg}.epub`,
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
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function rdfValues(xml, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "g");
  return [...String(xml || "").matchAll(re)]
    .map((m) => decodeXmlEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()))
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transientFetchFailure(error) {
  const text = String(error?.message || error || "");
  const code = error?.cause?.code || error?.code || "";
  return /fetch failed|socket|timeout|terminated|network/i.test(text)
    || ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code);
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status >= 500) && attempt < FETCH_RETRIES) {
        await res.arrayBuffer().catch(() => {});
        process.stderr.write(`[gutenberg] retry ${attempt + 1}/${FETCH_RETRIES} ${url}: HTTP ${res.status}\n`);
        await sleep(FETCH_RETRY_BASE_MS * attempt);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES || !transientFetchFailure(error)) throw error;
      process.stderr.write(`[gutenberg] retry ${attempt + 1}/${FETCH_RETRIES} ${url}: ${error.message}\n`);
      await sleep(FETCH_RETRY_BASE_MS * attempt);
    }
  }
  throw lastError;
}

async function fetchGutenbergMetadata(book) {
  const res = await fetchWithRetry(rdfUrl(book), { headers: { "user-agent": "liber-gutenberg-import/0.1" } });
  if (!res.ok) throw new Error(`Failed to verify Project Gutenberg metadata for ${book.id}: HTTP ${res.status}`);
  const rdf = await res.text();
  return {
    rights: rdfValues(rdf, "dcterms:rights"),
    title: rdfValues(rdf, "dcterms:title")[0] || "",
    issued: rdfValues(rdf, "dcterms:issued")[0] || "",
  };
}

function verifyGutenbergPublicDomain(book, metadata) {
  const license = verifyPublishLicense({ metadata: { rights: metadata.rights } }, {
    evidence: `Project Gutenberg RDF rights for ebook ${book.pg}: ${metadata.rights.join("; ")}`,
  });
  if (!license.accepted) {
    throw new Error(`Rejected ${book.id} #${book.pg}: ${license.reason} Rights: ${metadata.rights.join("; ") || "none"}`);
  }
  return license;
}

function isLikelyValidOrdinalHeading(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  return /^(?:[IVXLCDM]+\.?|第[一二三四五六七八九十百千0-9]+[章幕場节節]|[一二三四五六七八九十百千]+|(?:CAPITOLO|HOOFDSTUK|KAPITEL|KAPITLET|CHAPITRE|ROZDZIAŁ)\b)/iu.test(value);
}

function chapterQualityWarnings(chapters) {
  const titles = chapters.map((chapter) => String(chapter.title || "").trim()).filter(Boolean);
  const text = chapters.map((chapter) => chapter.text || "").join("\n\n");
  const warnings = [];
  warnings.push(...garbledTextWarnings(text));
  if (chapters.length > MAX_CHAPTERS_FOR_AUTO_PUBLISH) {
    warnings.push(`EPUB produced ${chapters.length} chapters, likely an index/dictionary split`);
  }
  if (titles.length >= 12) {
    const terse = titles.filter((title) => (
      (!isLikelyValidOrdinalHeading(title) && (title.length <= 4 || /^(?:\d+|[A-Z])\.?$/i.test(title)))
      || /^(?:V|M|F)\.\s*(?:i|p|t|pl|ant|gram|fig|fam)\.?/i.test(title)
    ));
    if (terse.length / titles.length > 0.65) {
      warnings.push(`TOC has ${(terse.length / titles.length * 100).toFixed(0)}% terse/generated-looking headings`);
    }
  }
  return warnings;
}

function assertImportQuality(book, chapters) {
  const warnings = chapterQualityWarnings(chapters);
  if (chapters.length > MAX_CHAPTERS_FOR_AUTO_PUBLISH || warnings.some((warning) => /garbled|mojibake|replacement/i.test(warning))) {
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

function isSameNormalizedTitle(a, b) {
  const left = normalizedTitle(a);
  const right = normalizedTitle(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function isGutenbergMatterTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
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
  return /^(?:contents?|table of contents|inhoudsopgave|inhoud\.?|tartalom\.?|inneh[åa]ll(?:sförteckning)?\.?:?|index\b.*|notes?:|noten\b.*|footnotes?|fodnoter|colophon|colofon|transcriber(?:'|’)?s notes?|javit[aá]sok\.?|afskriverens rettelser|corrigenda|errata|fi)$/iu.test(value)
    || /^I N D E X$/iu.test(value)
    || /^T A R T A L O M$/iu.test(value)
    || /^[*＊\s]+$/u.test(value)
    || /^הערת עורך/u.test(value)
    || /^(?:後記|あとがき)$/u.test(value)
    || folded === "javitasok"
    || matterTitles.has(folded);
}

function isShortTitlePage(book, chapter, index, total) {
  if (total <= 1 || index !== 0) return false;
  const text = String(chapter.text || "").replace(/\s+/g, " ").trim();
  return text.length < 2200 && isSameNormalizedTitle(chapter.title, book.title);
}

function isShortGeneratedCredit(chapter) {
  const title = String(chapter.title || "").replace(/\s+/g, " ").trim();
  return title.length < 120 && /,\s+by\s+/i.test(title);
}

function isShortLeadingRomanPage(chapter, index, total) {
  if (total <= 1 || index !== 0) return false;
  const title = String(chapter.title || "").replace(/\s+/g, " ").trim();
  const text = String(chapter.text || "").replace(/\s+/g, " ").trim();
  return text.length < 1200 && /^(?:[IVXLCDM]+\.?)$/i.test(title);
}

function cleanGutenbergPayload(book, payload) {
  const chapters = payload.chapters || [];
  const skipTitles = new Set((book.skipTitles || []).map(normalizedTitle));
  const filtered = chapters.filter((chapter, index) => {
    if (skipTitles.has(normalizedTitle(chapter.title))) return false;
    if (isShortTitlePage(book, chapter, index, chapters.length)) return false;
    if (isGutenbergMatterTitle(chapter.title)) return false;
    if (isShortGeneratedCredit(chapter)) return false;
    if (isShortLeadingRomanPage(chapter, index, chapters.length)) return false;
    return true;
  });
  if (!filtered.length) return payload;
  payload.chapters = filtered.map((chapter, index) => ({ ...chapter, n: index + 1 }));
  payload.blurb = payload.chapters[0]?.text?.slice(0, 120) || payload.blurb || "";
  return payload;
}

async function download(url, filePath) {
  const res = await fetchWithRetry(url, { headers: { "user-agent": "liber-gutenberg-import/0.1" } });
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

async function importOne(book, options) {
  process.stderr.write(`[gutenberg] ${book.id} #${book.pg} verify rights...\n`);
  const metadata = await fetchGutenbergMetadata(book);
  const metadataLicense = verifyGutenbergPublicDomain(book, metadata);
  process.stderr.write(`[gutenberg] ${book.id} rights: ${metadata.rights.join("; ")}\n`);

  process.stderr.write(`[gutenberg] ${book.id} #${book.pg} download...\n`);
  const dir = await mkdtemp(path.join(tmpdir(), "liber-gutenberg-"));
  const filePath = path.join(dir, `${book.id}.epub`);
  const downloadedFrom = await downloadEpub(book, filePath);

  const info = await inspectEpub(filePath);
  const license = await verifyPublishLicense(info, { source: sourceUrl(book), license: metadataLicense.license, evidence: metadata.rights.join("; ") });
  const manifest = await createBookManifest(filePath, { source: sourceUrl(book), license: metadataLicense.license, evidence: metadata.rights.join("; ") });
  const payload = cleanGutenbergPayload(
    book,
    await createIngestPayload(manifest, { id: book.id, category: book.category, lang: book.lang, includeSource: false }),
  );
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
      concurrency: 6,
      onProgress: (event) => {
        if (event.stage === "chapter") {
          process.stderr.write(`[gutenberg] ${book.id} chapter ${event.current}/${event.total}: ${event.chapter.title}\n`);
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
    byLang,
    failures,
    warnings,
    results,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const knownIds = new Set(BOOKS.map((book) => book.id));
  const missingIds = options.ids.filter((id) => !knownIds.has(id));
  if (missingIds.length) throw new Error(`Unknown book ids: ${missingIds.join(",")}`);
  const selected = BOOKS.filter((book) => options.ids.includes(book.id));
  if (!selected.length) throw new Error(`No matching books for --ids ${options.ids.join(",")}`);
  const results = [];
  for (const book of selected) {
    try {
      results.push(await importOne(book, options));
    } catch (error) {
      if (!options.continueOnError) throw error;
      process.stderr.write(`[gutenberg] ${book.id} failed: ${error.message}\n`);
      results.push({
        id: book.id,
        pg: book.pg,
        title: book.title,
        lang: book.lang,
        category: book.category,
        source: sourceUrl(book),
        accepted: false,
        error: error.message,
      });
    }
  }
  const output = { mode: options.publish ? "publish" : "dry-run", apiUrl: options.apiUrl, results };
  const body = options.summary ? summarizeOutput(output) : output;
  process.stdout.write(options.json ? `${JSON.stringify(body, null, 2)}\n` : `${results.map((r) => `${r.id}: ${r.title}`).join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
