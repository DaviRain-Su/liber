/* ============================================================
   Liber Reader — product data
   Books, chapters (道德经 full sample), annotations, highlights,
   reviews. Exposed on window for the JSX component scripts.
   ============================================================ */

/* ---- Library catalogue ---- */
const BOOKS = [
  {
    id: "daodejing", t: "道德经", sub: "Tao Te Ching", a: "老子", cls: "ink", seal: "道",
    cat: "哲学 · 思想", lang: "中文", year: "约前 4 世纪", pages: 81, words: "约 5,000 字",
    reads: "48,201", readsN: 48201, lines: "8,402", liners: 8402, annos: 1247,
    blob: "walrus://0x8f3a…d21c", backup: "ar://Qd9_kP…7Lm", index: "sui::registry::Book#0427",
    blurb: "传世仅五千言，却被译成最多语言的中文典籍。老子以「道」为枢，谈天地、谈治世、谈处身，句句简短，却越读越深。",
    long: "《道德经》又称《老子》，分「道经」与「德经」两部，共八十一章。它不立论、不举证，而以格言与比喻并置——水、谷、婴儿、车毂，反复指向那个「说不尽」的道。两千多年来，它既是哲人案头的玄思，也是寻常人安顿身心的依据。",
    featured: true,
  },
  { id:"meditations", t:"沉思录", sub:"Meditations", a:"马可·奥勒留", cls:"cinnabar", seal:"思",
    cat:"哲学 · 思想", lang:"中文", year:"约 170—180", pages:120, words:"约 6 万字",
    reads:"33,140", readsN:33140, lines:"6,118", liners:6118, annos:903,
    blob:"walrus://0x21be…9f04", backup:"ar://Lm7_xQ…3Kd", index:"sui::registry::Book#0319",
    blurb:"一位罗马皇帝写给自己的札记。不为发表，只为时时提醒自己如何面对命运、他人与死亡。",
    long:"《沉思录》是奥勒留在征战途中以希腊文写下的私人笔记，从未打算示人。正因如此，它格外坦诚——关于忍耐、关于本分、关于「我们感受到的不是事物本身，而是我们对它的看法」。", featured:false },
  { id:"wealth", t:"国富论", sub:"The Wealth of Nations", a:"亚当·斯密", cls:"cream", seal:"富",
    cat:"经济 · 政治", lang:"中文", year:"1776", pages:900, words:"约 35 万字",
    reads:"21,007", readsN:21007, lines:"5,277", liners:5277, annos:612,
    blob:"walrus://0x77cd…1a28", backup:"ar://Pq2_nR…8Wz", index:"sui::registry::Book#0501",
    blurb:"现代经济学的奠基之作。分工、市场、价格与那只「看不见的手」，第一次被系统地讲清楚。",
    long:"亚当·斯密用近百万字论证：个人追逐自利，在竞争市场里会无意中促进公共利益。这部书塑造了之后两百年的经济思想，也塑造了我们今天谈论财富的方式。", featured:false },
  { id:"republic", t:"理想国", sub:"The Republic", a:"柏拉图", cls:"indigo", seal:"理",
    cat:"哲学 · 思想", lang:"中文", year:"约前 375", pages:400, words:"约 20 万字",
    reads:"19,330", readsN:19330, lines:"4,011", liners:4011, annos:540,
    blob:"walrus://0x9a01…ee37", backup:"ar://Tn5_vK…2Lp", index:"sui::registry::Book#0288",
    blurb:"以「什么是正义」开场，柏拉图借苏格拉底之口，构想了一座理想城邦与一种理想的灵魂秩序。", long:"", featured:false },
  { id:"origin", t:"物种起源", sub:"On the Origin of Species", a:"达尔文", cls:"jade", seal:"源",
    cat:"科学 · 博物", lang:"中文", year:"1859", pages:560, words:"约 25 万字",
    reads:"14,720", readsN:14720, lines:"2,733", liners:2733, annos:388,
    blob:"walrus://0x33fa…b7c1", backup:"ar://Hd8_mP…5Rt", index:"sui::registry::Book#0612",
    blurb:"一本改变了人类自我认知的书。自然选择如何在漫长时间里，塑造出万千物种。", long:"", featured:false },
  { id:"artofwar", t:"孙子兵法", sub:"The Art of War", a:"孙武", cls:"slate", seal:"兵",
    cat:"哲学 · 思想", lang:"中文", year:"约前 5 世纪", pages:60, words:"约 6,000 字",
    reads:"26,540", readsN:26540, lines:"5,521", liners:5521, annos:701,
    blob:"walrus://0x05dd…44af", backup:"ar://Zq1_bN…9Cm", index:"sui::registry::Book#0155",
    blurb:"十三篇，论的是战，讲的却是「不战」。两千年来被反复读进商场、棋局与人生。", long:"", featured:false },
  { id:"analects", t:"论语", sub:"The Analects", a:"孔子", cls:"cinnabar", seal:"仁",
    cat:"哲学 · 思想", lang:"中文", year:"约前 5 世纪", pages:200, words:"约 1.6 万字",
    reads:"30,012", readsN:30012, lines:"6,840", liners:6840, annos:988,
    blob:"walrus://0x88ef…2d10", backup:"ar://Wm3_kL…7Pq", index:"sui::registry::Book#0072",
    blurb:"孔子与弟子的对话录。没有体系，只有一句句关于如何做人、如何为政的提点。", long:"", featured:false },
  { id:"prince", t:"君主论", sub:"The Prince", a:"马基雅维利", cls:"ink", seal:"权",
    cat:"经济 · 政治", lang:"中文", year:"1532", pages:140, words:"约 5 万字",
    reads:"12,880", readsN:12880, lines:"3,102", liners:3102, annos:455,
    blob:"walrus://0x4c7a…f9b3", backup:"ar://Yd6_pR…4Nk", index:"sui::registry::Book#0440",
    blurb:"第一次把政治从道德里剥离出来谈。冷峻、争议，却绕不开。", long:"", featured:false },
];

/* ---- TOC + body content for 道德经 (sample chapters fully written) ---- */
const CHAPTERS = [
  {
    n: 1, title: "道，可道", paras: [
      [ {id:"c1-s1", t:"道可道，非常道；名可名，非常名。", hot:true},
        {id:"c1-s2", t:"无名天地之始，有名万物之母。"} ],
      [ {id:"c1-s3", t:"故常无欲，以观其妙；常有欲，以观其徼。"},
        {id:"c1-s4", t:"此两者，同出而异名，同谓之玄。"},
        {id:"c1-s5", t:"玄之又玄，众妙之门。", people:true} ],
    ]
  },
  {
    n: 2, title: "天下皆知", paras: [
      [ {id:"c2-s1", t:"天下皆知美之为美，斯恶已；皆知善之为善，斯不善已。", hot:true} ],
      [ {id:"c2-s2", t:"故有无相生，难易相成，长短相形，高下相倾，音声相和，前后相随。"} ],
      [ {id:"c2-s3", t:"是以圣人处无为之事，行不言之教；万物作焉而不辞，生而不有，为而不恃，功成而弗居。"},
        {id:"c2-s4", t:"夫唯弗居，是以不去。"} ],
    ]
  },
  {
    n: 3, title: "不尚贤", paras: [
      [ {id:"c3-s1", t:"不尚贤，使民不争；不贵难得之货，使民不为盗；不见可欲，使民心不乱。"} ],
      [ {id:"c3-s2", t:"是以圣人之治，虚其心，实其腹，弱其志，强其骨。"},
        {id:"c3-s3", t:"常使民无知无欲，使夫智者不敢为也。"},
        {id:"c3-s4", t:"为无为，则无不治。", people:true} ],
    ]
  },
  {
    n: 8, title: "上善若水", paras: [
      [ {id:"c8-s1", t:"上善若水。水善利万物而不争，处众人之所恶，故几于道。", hot:true} ],
      [ {id:"c8-s2", t:"居善地，心善渊，与善仁，言善信，正善治，事善能，动善时。"},
        {id:"c8-s3", t:"夫唯不争，故无尤。"} ],
    ]
  },
  {
    n: 33, title: "知人者智", paras: [
      [ {id:"c33-s1", t:"知人者智，自知者明。", hot:true},
        {id:"c33-s2", t:"胜人者有力，自胜者强。"} ],
      [ {id:"c33-s3", t:"知足者富，强行者有志。"},
        {id:"c33-s4", t:"不失其所者久，死而不亡者寿。"} ],
    ]
  },
];

/* TOC list (full 81, only first ones have content) */
const TOC = [
  { n:1, title:"道，可道", has:true },
  { n:2, title:"天下皆知", has:true },
  { n:3, title:"不尚贤", has:true },
  { n:4, title:"道冲", has:false },
  { n:5, title:"天地不仁", has:false },
  { n:6, title:"谷神不死", has:false },
  { n:7, title:"天长地久", has:false },
  { n:8, title:"上善若水", has:true },
  { n:9, title:"持而盈之", has:false },
  { n:10, title:"载营魄抱一", has:false },
  { n:11, title:"三十辐", has:false },
  { n:33, title:"知人者智", has:true },
];

/* ---- 论语 (The Analects) — opening chapters, classical-Chinese public domain ---- */
const ANALECTS_CHAPTERS = [
  { n:1, title:"学而", paras: [
    [ {id:"analects-c1-s1", t:"子曰：「学而时习之，不亦说乎？", hot:true},
      {id:"analects-c1-s2", t:"有朋自远方来，不亦乐乎？"},
      {id:"analects-c1-s3", t:"人不知而不愠，不亦君子乎？」", people:true} ],
    [ {id:"analects-c1-s4", t:"有子曰：「其为人也孝弟，而好犯上者，鲜矣；"},
      {id:"analects-c1-s5", t:"不好犯上，而好作乱者，未之有也。"},
      {id:"analects-c1-s6", t:"君子务本，本立而道生。"},
      {id:"analects-c1-s7", t:"孝弟也者，其为仁之本与！」"} ],
    [ {id:"analects-c1-s8", t:"子曰：「巧言令色，鲜矣仁。」"} ],
    [ {id:"analects-c1-s9", t:"曾子曰：「吾日三省吾身：为人谋而不忠乎？与朋友交而不信乎？传不习乎？」"} ],
    [ {id:"analects-c1-s10", t:"子曰：「弟子入则孝，出则弟，谨而信，泛爱众，而亲仁。行有余力，则以学文。」"} ] ],
  },
  { n:2, title:"为政", paras: [
    [ {id:"analects-c2-s1", t:"子曰：「为政以德，譬如北辰，居其所而众星共之。」", hot:true} ],
    [ {id:"analects-c2-s2", t:"子曰：「诗三百，一言以蔽之，曰：思无邪。」"} ],
    [ {id:"analects-c2-s3", t:"子曰：「吾十有五而志于学，三十而立，四十而不惑，五十而知天命，六十而耳顺，七十而从心所欲，不逾矩。」", people:true} ],
    [ {id:"analects-c2-s4", t:"子曰：「温故而知新，可以为师矣。」"} ],
    [ {id:"analects-c2-s5", t:"子曰：「学而不思则罔，思而不学则殆。」"} ] ],
  },
];
const ANALECTS_TOC = [
  { n:1, title:"学而", has:true },
  { n:2, title:"为政", has:true },
  { n:3, title:"八佾", has:false },
  { n:4, title:"里仁", has:false },
  { n:5, title:"公冶长", has:false },
];

/* ---- 孙子兵法 (The Art of War) — opening chapters, classical-Chinese public domain ---- */
const ARTOFWAR_CHAPTERS = [
  { n:1, title:"始计", paras: [
    [ {id:"artofwar-c1-s1", t:"孙子曰：兵者，国之大事，死生之地，存亡之道，不可不察也。", hot:true} ],
    [ {id:"artofwar-c1-s2", t:"故经之以五事，校之以计，而索其情：一曰道，二曰天，三曰地，四曰将，五曰法。"} ],
    [ {id:"artofwar-c1-s3", t:"道者，令民与上同意也，故可以与之死，可以与之生，而不畏危。"},
      {id:"artofwar-c1-s4", t:"将者，智、信、仁、勇、严也。"} ],
    [ {id:"artofwar-c1-s5", t:"兵者，诡道也。", people:true},
      {id:"artofwar-c1-s6", t:"故能而示之不能，用而示之不用，近而示之远，远而示之近。"} ],
    [ {id:"artofwar-c1-s7", t:"夫未战而庙算胜者，得算多也；未战而庙算不胜者，得算少也。"},
      {id:"artofwar-c1-s8", t:"多算胜，少算不胜，而况于无算乎！"} ] ],
  },
  { n:2, title:"作战", paras: [
    [ {id:"artofwar-c2-s1", t:"孙子曰：凡用兵之法，驰车千驷，革车千乘，带甲十万，千里馈粮。"} ],
    [ {id:"artofwar-c2-s2", t:"其用战也胜，久则钝兵挫锐，攻城则力屈，久暴师则国用不足。"} ],
    [ {id:"artofwar-c2-s3", t:"故兵贵胜，不贵久。", hot:true} ],
    [ {id:"artofwar-c2-s4", t:"故知兵之将，民之司命，国家安危之主也。", people:true} ] ],
  },
];
const ARTOFWAR_TOC = [
  { n:1, title:"始计", has:true },
  { n:2, title:"作战", has:true },
  { n:3, title:"谋攻", has:false },
  { n:4, title:"军形", has:false },
  { n:5, title:"兵势", has:false },
];

/* Per-book readable content, keyed by book id. The reader and book detail read
   here first (offline / no backend); the API serves the same seed for any book
   that hasn't been ingested into D1 yet. Books missing here open to an empty
   state instead of dangling on "正文加载中…". */
const BOOK_CONTENT = {
  daodejing: { toc: TOC, chapters: CHAPTERS },
  analects: { toc: ANALECTS_TOC, chapters: ANALECTS_CHAPTERS },
  artofwar: { toc: ARTOFWAR_TOC, chapters: ARTOFWAR_CHAPTERS },
};

/* ---- Others' annotations, keyed by sentence id ---- */
const ANNOTATIONS = {
  "c1-s1": [
    { u:"林知秋", color:"#3a4fb0", signed:true, cited:12, t:"能说清的「道」就不是恒常的道了——老子一上来就给语言划了边界。", up:42, replies:6 },
    { u:"沈砚", color:"#2e7d57", t:"和维特根斯坦「凡不可说的，应保持沉默」对照着读，很有意思。", up:18, replies:2 },
  ],
  "c1-s5": [
    { u:"书友", color:"var(--accent)", ai:true, agent:"shuyou", signed:true, cited:64, t:"「玄」不是神秘主义，而是指认识不断向更深处递归——门里还有门。", up:23, replies:0 },
  ],
  "c2-s1": [
    { u:"周慕白", color:"#9a5b2e", t:"美与丑是同时被定义出来的：一旦立了标准，对立面就跟着诞生。", up:31, replies:4 },
  ],
  "c8-s1": [
    { u:"叶临", color:"#7a3d6b", t:"「处众人之所恶」——水愿意待在低处，这是最难的。", up:27, replies:3 },
    { u:"书友", color:"var(--accent)", ai:true, agent:"shuyou", signed:true, cited:88, t:"水的「不争」不是软弱，而是一种更高级的策略：以柔克刚，以退为进。", up:15, replies:1 },
  ],
  "c33-s1": [
    { u:"林知秋", color:"#3a4fb0", t:"认识别人靠的是智，认识自己靠的是「明」——明比智更难。", up:58, replies:9 },
  ],
};

/* ---- Popular highlights (per book) ---- */
const HIGHLIGHTS = [
  { rank:1, q:"知人者智，自知者明。", c:"第三十三章", n:"8,402 人划线" },
  { rank:2, q:"上善若水。水善利万物而不争。", c:"第八章", n:"7,115 人划线" },
  { rank:3, q:"道可道，非常道；名可名，非常名。", c:"第一章", n:"6,980 人划线" },
  { rank:4, q:"天下皆知美之为美，斯恶已。", c:"第二章", n:"4,233 人划线" },
];

/* ---- Reader reviews ---- */
const REVIEWS = [
  { u:"沈砚", color:"#2e7d57", rating:5, when:"3 天前", chap:"读到第八章",
    t:"每天睡前读一章，配着 AI 书友把生僻的地方讲开，三周读完了。第一次觉得《道德经》不是高悬的玄学，而是能用的。" },
  { u:"周慕白", color:"#9a5b2e", rating:5, when:"1 周前", chap:"已读完",
    t:"苏格拉底模式很狠，每次都把我自以为懂了的地方戳穿。被反问着读完，理解深了一层。" },
  { u:"叶临", color:"#7a3d6b", rating:4, when:"2 周前", chap:"读到第三十三章",
    t:"喜欢能看到别人在同一句旁的批注，像在一座安静的图书馆里，旁边坐着很多也在读同一本书的人。" },
];

/* ---- Current reader (you) ---- */
const ME = {
  name: "林知秋", handle: "@linzhiqiu", color: "#3a4fb0", seal: "林",
  bio: "在公版经典里慢读。偏爱道家与斯多葛。划线狂魔，偶尔写点批注。",
  joined: "2025 年 3 月加入", wallet: "sui:0x7c…a4f1",
  stats: { read: 7, finished: 3, lines: 214, notes: 38, agreed: 1203, following: 42, followers: 318 },
  reading: [ {id:"daodejing", at:"第八章 · 41%"}, {id:"meditations", at:"卷四 · 22%"}, {id:"analects", at:"学而 · 8%"} ],
  finished: ["artofwar", "prince", "republic"],
  wantToRead: ["wealth", "republic", "origin"],
  streak: 23, weekRead: 5, weekGoal: 7, yearFinished: 3, yearGoal: 12,
  collections: [
    { id:"daoist", name:"道家入门", desc:"从《道德经》到《庄子》的慢读路线", books:["daodejing","analects"], color:"ink" },
    { id:"stoic", name:"睡前哲学", desc:"每晚一段，安顿身心", books:["meditations","prince"], color:"cinnabar" },
    { id:"econ", name:"看懂市场", desc:"古典经济学三种", books:["wealth"], color:"cream" },
  ],
  groups: ["daoist-read", "stoic-morning"],
};

/* ---- Other readers' public profiles (keyed by display name) ----
   These are the people whose avatars show up in the feed, threads,
   annotations and groups. Click an avatar → land here → 关注. */
const READERS = {
  "沈砚": {
    name:"沈砚", handle:"@shenyan", color:"#2e7d57", seal:"沈",
    bio:"睡前读一章，把东方典籍与西方哲学对照着读。相信慢读比读完更重要。",
    joined:"2024 年 11 月加入", wallet:"sui:0x3a…b920",
    stats:{ read:5, finished:6, lines:308, notes:54, agreed:2140, following:88, followers:512 },
    reading:[ {id:"meditations", at:"卷四 · 33%"}, {id:"daodejing", at:"第八章 · 52%"} ],
    finished:["artofwar","analects","prince"],
    publicNotes:[
      { q:"道可道，非常道；名可名，非常名。", t:"和维特根斯坦「凡不可说的，应保持沉默」对照着读，很有意思。", book:"道德经", chap:"第一章", when:"昨天" },
      { q:"我们感受到的不是事物本身，而是我们对它的看法。", t:"斯多葛把「判断」和「事件」分开——这是整本《沉思录》的钥匙。", book:"沉思录", chap:"卷四", when:"4 天前" },
    ],
  },
  "周慕白": {
    name:"周慕白", handle:"@zhoumubai", color:"#9a5b2e", seal:"周",
    bio:"喜欢被反问着读书。「斯多葛晨读」小组组长，每天清晨一段奥勒留。",
    joined:"2024 年 6 月加入", wallet:"sui:0x71…4e0c",
    stats:{ read:4, finished:9, lines:421, notes:77, agreed:3180, following:64, followers:806 },
    reading:[ {id:"meditations", at:"卷四 · 60%"}, {id:"republic", at:"卷二 · 18%"} ],
    finished:["prince","artofwar","daodejing"],
    publicNotes:[
      { q:"天下皆知美之为美，斯恶已。", t:"美与丑是同时被定义出来的——一旦立了标准，对立面就跟着诞生。", book:"道德经", chap:"第二章", when:"3 天前" },
      { q:"我们感受到的不是事物本身，而是我们对它的看法。", t:"今日句。准备把它用在早高峰堵车上——烦的是判断，不是堵车。", book:"沉思录", chap:"卷四", when:"今早" },
    ],
  },
  "叶临": {
    name:"叶临", handle:"@yelin", color:"#7a3d6b", seal:"叶",
    bio:"在经济学与古典之间来回读。爱看别人在同一句旁的批注，像在安静的图书馆里。",
    joined:"2025 年 1 月加入", wallet:"sui:0x0c…ad13",
    stats:{ read:6, finished:3, lines:196, notes:33, agreed:1024, following:120, followers:288 },
    reading:[ {id:"wealth", at:"第四篇 · 27%"}, {id:"daodejing", at:"第八章 · 44%"} ],
    finished:["prince","artofwar"],
    publicNotes:[
      { q:"上善若水。水善利万物而不争，处众人之所恶，故几于道。", t:"「处众人之所恶」——水愿意待在低处，这是最难的。", book:"道德经", chap:"第八章", when:"2 周前" },
      { q:"我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。", t:"自利不是自私。斯密最常被误读的一句。", book:"国富论", chap:"第四篇", when:"2 天前" },
    ],
  },
  "陈砚之": {
    name:"陈砚之", handle:"@chenyanzhi", color:"#b0553a", seal:"陈",
    bio:"共读小组的发起人：道家共读、古典经济学。读得慢，但坚持每周一聚。",
    joined:"2024 年 3 月加入", wallet:"sui:0x59…1f87",
    stats:{ read:3, finished:12, lines:540, notes:103, agreed:4260, following:51, followers:1320 },
    reading:[ {id:"daodejing", at:"第十二章 · 64%"}, {id:"wealth", at:"第一篇 · 15%"} ],
    finished:["artofwar","analects","prince","republic"],
    publicNotes:[
      { q:"我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。", t:"开篇的别针工厂例子，斯密用它说明分工的威力。今天还成立吗？", book:"国富论", chap:"第一篇", when:"昨天" },
      { q:"上善若水。水善利万物而不争，处众人之所恶。", t:"读「上善若水」，大家怎么理解「处众人之所恶」？甘居下位反而接近道。", book:"道德经", chap:"第八章", when:"2 小时前" },
    ],
  },
  "何苇": {
    name:"何苇", handle:"@hewei", color:"#2e7d57", seal:"何",
    bio:"通勤路上读斯多葛。把读到的句子拿去对付真实生活里的烦躁。",
    joined:"2025 年 2 月加入", wallet:"sui:0x8d…6b2a",
    stats:{ read:2, finished:4, lines:112, notes:19, agreed:486, following:73, followers:140 },
    reading:[ {id:"meditations", at:"卷四 · 48%"}, {id:"daodejing", at:"第三章 · 12%"} ],
    finished:["prince"],
    publicNotes:[
      { q:"我们感受到的不是事物本身，而是我们对它的看法。", t:"早高峰堵车，本来要烦，想起这句，告诉自己烦的是「判断」不是「堵车」。有点用。", book:"沉思录", chap:"卷四", when:"今早" },
    ],
  },
  "许之": {
    name:"许之", handle:"@xuzhi", color:"#3a4fb0", seal:"许",
    bio:"经济学背景，来公版馆里补古典。喜欢把抽象的理念落到具体的激励上。",
    joined:"2024 年 9 月加入", wallet:"sui:0x22…c4d8",
    stats:{ read:3, finished:5, lines:233, notes:41, agreed:1380, following:96, followers:402 },
    reading:[ {id:"wealth", at:"第一篇 · 35%"}, {id:"republic", at:"卷一 · 9%"} ],
    finished:["prince","artofwar","analects"],
    publicNotes:[
      { q:"我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。", t:"自利不等于自私——这是斯密最常被误读的一句。", book:"国富论", chap:"第一篇", when:"1 周前" },
    ],
  },
};

/* who 林知秋（你）already follows — toggled live, persisted to localStorage */
const FOLLOW_SEED = ["沈砚", "叶临"];

/* ---- Shareable AI conversations (对话卡 + 金句卡) ---- */
const SHARED_CONVOS = [
  {
    id:"sc-water", form:"card", book:"daodejing", bookT:"道德经", seal:"道", chap:"第八章 · 上善若水",
    quote:"上善若水。水善利万物而不争，处众人之所恶，故几于道。", sid:"c8-s1",
    title:"「上善若水」常被当成鸡汤，老子到底想说什么？",
    insight:"“不争”，是更长时间尺度上的“争”。",
    author:{ name:"林知秋", ava:"林", color:"#3a4fb0" },
    forks:23, agree:86, comments:12, saves:41, when:"3 天前",
    msgs:[
      { r:"q", t:"「上善若水」常被当成鸡汤，老子到底想说什么？" },
      { r:"a", t:"关键在后半句——水「处众人之所恶」。它甘居低处、脏处。老子推崇的不是水的温柔，而是它不挑位置、不争高下。" },
      { r:"q", t:"那「不争」是不是就是消极、躺平？" },
      { r:"a", t:"不是。注意「水善利万物」——它一直在做事、在利他，只是不争功、不抢位。是「为而不争」，不是「不为」。" },
      { r:"q", t:"有点像现在说的“做事但不抢功”？可这在职场里不就吃亏了吗？" },
      { r:"a", t:"老子会反问：你说的“吃亏”，是用“争”的那把尺子量的。换一把尺子——水正因为往低处去，最后才汇成了江海。" },
      { r:"q", t:"这个“换尺子”点醒我了。那回到结尾「夫唯不争，故无尤」——" },
      { r:"a", t:"对。正因不争，所以无怨无咎。不是没有得失，而是干脆不在那个计较的游戏里。" },
    ],
    tree:[
      { id:"f1", name:"沈砚", ava:"沈", color:"#2e7d57", q:"那如果对方就是不守「不争」，一味地争呢？", agree:24, forks:2,
        children:[
          { id:"f1a", name:"何苇", ava:"何", color:"#b0553a", q:"所以「不争」是一种边界，不是无底线退让？", agree:11, forks:0, children:[] },
        ] },
      { id:"f2", name:"周慕白", ava:"周", color:"#9a5b2e", q:"把「上善若水」用到产品设计上，会是什么样？", agree:18, forks:1, children:[] },
      { id:"f3", name:"叶临", ava:"叶", color:"#7a3d6b", q:"水也会决堤啊，「不争」有没有反例？", agree:9, forks:0, children:[] },
    ],
  },
  {
    id:"sc-name", form:"insight", book:"daodejing", bookT:"道德经", seal:"道", chap:"第一章 · 道，可道",
    quote:"道可道，非常道；名可名，非常名。", sid:"c1-s1",
    insight:"能被说尽的，就不是那个完整的它。",
    author:{ name:"沈砚", ava:"沈", color:"#2e7d57" },
    forks:31, agree:118, comments:20, saves:73, when:"1 周前",
    msgs:[
      { r:"q", t:"开篇这句「道可道，非常道」是不是在说——道根本说不清？" },
      { r:"a", t:"更准确说：凡是能用语言固定下来的「道」，都已经不是那个恒常流动的道了。语言是抓取，道是流动。" },
      { r:"q", t:"那既然说不清，老子为什么还要写五千字？" },
      { r:"a", t:"因为语言可以「指」，却不能「是」。像指月的手指——它帮你看向月亮，但别把手指当月亮。" },
      { r:"q", t:"所以读《道德经》也是这样——别抠字面？" },
      { r:"a", t:"对。它的句子是路标，不是终点。读慢一点，让字句留出的那道缝，自己显出来。" },
    ],
  },
  {
    id:"sc-hand", form:"card", book:"wealth", bookT:"国富论", seal:"富", chap:"第四篇 · 第二章",
    quote:"我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。", sid:"w-hand",
    title:"「看不见的手」是斯密在为自私辩护吗？",
    insight:"自利不是自私——它是在竞争里被驯化的。",
    author:{ name:"叶临", ava:"叶", color:"#7a3d6b" },
    forks:14, agree:52, comments:8, saves:23, when:"2 天前",
    msgs:[
      { r:"q", t:"「看不见的手」是斯密在为自私辩护吗？" },
      { r:"a", t:"恰恰相反。他想说的是：个人追求自利，在竞争市场里会无意中促进公共利益——这是结果，不是动机的辩护。" },
      { r:"q", t:"那它什么时候会失灵？" },
      { r:"a", t:"当竞争被破坏时——垄断、外部性、信息不对称。手之所以「有效」，前提是市场足够竞争、信息足够透明。" },
      { r:"q", t:"所以斯密其实没那么「自由放任」？" },
      { r:"a", t:"对。常被误读。他同样警惕商人合谋抬价，也支持必要的公共制度。手需要一个健康的市场才看得见。" },
    ],
  },
];

/* ---- Agent identities (provenance) ---- */
const AGENTS = {
  shuyou: { name:"书友", kind:"agent", model:"Liber-Sage v2", sig:"sui:0xa17c…9f3d", signed:true, cited:1240, by:"Liber 官方", seal:"友", color:"var(--accent)", does:"通读陪伴 · 就地答疑 · 整理笔记", tracking:412 },
  kaoju:  { name:"考据 Agent", kind:"agent", model:"community/kaoju-0.4", sig:"sui:0x4be2…1a08", signed:true, cited:318, by:"社区贡献", seal:"考", color:"#9a5b2e", does:"字词源流 · 版本异同 · 注本比对", tracking:96 },
  stoic:  { name:"斯多葛导师", kind:"agent", model:"community/stoa-1.1", sig:"sui:0x77a0…2c5e", signed:true, cited:564, by:"社区贡献", seal:"思", color:"#3a4fb0", does:"以斯多葛视角重读任意文本", tracking:188 },
  skeptic:{ name:"怀疑论者", kind:"agent", model:"community/pyrrho-0.3", sig:"sui:0x1d92…8b40", signed:true, cited:209, by:"社区贡献", seal:"疑", color:"#7a3d6b", does:"对论断穷追不舍 · 找反例", tracking:73 },
  econ:   { name:"经济学家之眼", kind:"agent", model:"community/smith-0.6", sig:"sui:0x9c34…d712", signed:true, cited:271, by:"社区贡献", seal:"富", color:"#b0553a", does:"用激励 / 成本 / 市场重读文本", tracking:130 },
  digest: { name:"导读 Agent", kind:"agent", model:"community/digest-1.0", sig:"sui:0x3f51…a6c9", signed:true, cited:402, by:"社区贡献", seal:"导", color:"#2e7d57", does:"自动为新上链的书生成导读", tracking:255 },
};

/* ---- Reading "lenses": invitable, signed perspectives in the reader ---- */
const LENSES = [
  { id:"companion", name:"通读陪伴", seal:"友", color:"var(--accent)", tag:"official", agent:"shuyou", pitch:"陪你一句句读完，不剧透后文。" },
  { id:"extend",    name:"知识延展", seal:"延", color:"#3a4fb0", tag:"official", agent:"shuyou", pitch:"顺藤摸瓜，连到馆里别的书。" },
  { id:"notes",     name:"总结笔记", seal:"记", color:"#2e7d57", tag:"official", agent:"shuyou", pitch:"边读边替你整理成可导出的笔记。" },
  { id:"debate",    name:"苏格拉底", seal:"问", color:"#9a5b2e", tag:"official", agent:"shuyou", pitch:"不给答案，只一层层反问你。" },
  { id:"stoic",     name:"斯多葛导师", seal:"思", color:"#3a4fb0", tag:"community", agent:"stoic", pitch:"用奥勒留的眼光读任何一本书：什么在你掌控之内？" },
  { id:"textual",   name:"考据派", seal:"考", color:"#9a5b2e", tag:"community", agent:"kaoju", pitch:"咬文嚼字，追字词的源流与版本异同。" },
  { id:"skeptic",   name:"怀疑论者", seal:"疑", color:"#7a3d6b", tag:"community", agent:"skeptic", pitch:"对每个论断都先问一句：凭什么？" },
  { id:"econ",      name:"经济学家之眼", seal:"富", color:"#b0553a", tag:"community", agent:"econ", pitch:"用激励、成本与市场，重读任何文本。" },
];

/* ---- Cross-book echoes (L4 connection layer), keyed by sentence id ---- */
const ECHOES = {
  "c8-s1": {
    theme: "不争 · 处下",
    items: [
      { bookT:"论语", seal:"仁", color:"#b0553a", inLib:true, bookId:"analects", chap:"卫灵公篇",
        quote:"君子矜而不争，群而不党。", why:"孔子也把「不争」当作君子的修养——和老子从不同方向，落到同一处。" },
      { bookT:"沉思录", seal:"思", color:"#3a4fb0", inLib:true, bookId:"meditations", chap:"卷八",
        quote:"最好的报复，是不要变得和伤害你的人一样。", why:"奥勒留的「不还手」，与水的「不争」共享同一种以退为进的力量观。" },
      { bookT:"庄子", seal:"逍", color:"#2e7d57", inLib:false, chap:"人间世",
        quote:"人皆知有用之用，而莫知无用之用也。", why:"庄子的「无用」与水「处众人之所恶」呼应：甘居被嫌弃处，反而保全了自己。" },
    ],
  },
  "c1-s1": {
    theme: "语言 · 不可说",
    items: [
      { bookT:"沉思录", seal:"思", color:"#3a4fb0", inLib:true, bookId:"meditations", chap:"卷四",
        quote:"我们感受到的不是事物本身，而是我们对它的看法。", why:"两者都在区分「实在」与「我们对实在的命名/判断」——名不是物本身。" },
      { bookT:"逻辑哲学论", seal:"逻", color:"#7a3d6b", inLib:false, chap:"第七命题",
        quote:"凡不可说的，应当保持沉默。", why:"维特根斯坦给语言划界，与「道可道，非常道」是跨越两千年的同一个手势。" },
      { bookT:"论语", seal:"仁", color:"#b0553a", inLib:true, bookId:"analects", chap:"为政篇",
        quote:"知之为知之，不知为不知，是知也。", why:"对「可说/不可说」边界的诚实，孔子与老子在此处相遇。" },
    ],
  },
  "c33-s1": {
    theme: "自知 · 向内",
    items: [
      { bookT:"论语", seal:"仁", color:"#b0553a", inLib:true, bookId:"analects", chap:"学而篇",
        quote:"吾日三省吾身。", why:"曾子把「自知」变成日课——老子说明，孔门弟子在做。" },
      { bookT:"沉思录", seal:"思", color:"#3a4fb0", inLib:true, bookId:"meditations", chap:"卷七",
        quote:"向内看，善的源泉在内心，只要你不断挖掘，它就不断涌出。", why:"「自知者明」与斯多葛的「向内看」指向同一个方向：力量来自认识自己。" },
    ],
  },
  "c2-s1": {
    theme: "相对 · 对立相生",
    items: [
      { bookT:"国富论", seal:"富", color:"#9a5b2e", inLib:true, bookId:"wealth", chap:"第一篇",
        quote:"分工受市场范围的限制。", why:"老子讲「美/恶」相对而生，斯密讲价值在交换关系中相对而定——都拒绝孤立地看一物。" },
      { bookT:"庄子", seal:"逍", color:"#2e7d57", inLib:false, chap:"齐物论",
        quote:"彼出于是，是亦因彼。", why:"庄子把「对立相生」推到极致：是非彼此互相定义，正是第二章的展开。" },
    ],
  },
};

/* ---- Co-reading groups ---- */
const GROUPS = [
  {
    id:"daoist-read", name:"道家共读", color:"#1f8a5b", seal:"道", book:"daodejing",
    desc:"一周一章，慢读《道德经》。不求快，但求每一句都嚼透。配 AI 书友与组内批注，互相照亮。",
    members:23, joined:true, lead:"陈砚之", weekRange:"第八 — 第十二章", progressPct:62, annos:47,
    memberAvatars:[ {n:"陈",c:"#b0553a"},{n:"林",c:"#3a4fb0"},{n:"沈",c:"#2e7d57"},{n:"叶",c:"#7a3d6b"},{n:"周",c:"#9a5b2e"},{n:"许",c:"#3a4fb0"},{n:"何",c:"#2e7d57"} ],
    schedule:[
      { wk:"第 1 周", chap:"第一 — 第三章", state:"done" },
      { wk:"第 2 周", chap:"第四 — 第七章", state:"done" },
      { wk:"本周", chap:"第八 — 第十二章", state:"current" },
      { wk:"第 4 周", chap:"第十三 — 第十七章", state:"upcoming" },
      { wk:"第 5 周", chap:"第十八 — 第二十二章", state:"upcoming" },
    ],
    discussion:[
      { u:"陈砚之", color:"#b0553a", when:"2 小时前", chap:"第八章", t:"这周读「上善若水」，大家怎么理解「处众人之所恶」？为什么甘居下位反而接近道？", up:12, replies:6 },
      { u:"沈砚", color:"#2e7d57", when:"1 小时前", chap:"第八章", t:"我觉得是因为水从不挑位置，哪里低往哪里去——这种「不争」其实需要极大的定力。", up:8, replies:2 },
      { u:"林知秋", color:"#3a4fb0", when:"45 分钟前", chap:"第八章", t:"接沈砚——而且水利万物却不留名，这点最难。我们做事总想要个说法。", up:5, replies:1, mine:true },
    ],
    topAnno:{ u:"叶临", color:"#7a3d6b", quote:"上善若水。水善利万物而不争。", t:"水的「不争」不是软弱，是把锋芒收起来的力量。", up:27 },
  },
  {
    id:"stoic-morning", name:"斯多葛晨读", color:"#3a4fb0", seal:"思", book:"meditations",
    desc:"每天清晨一段《沉思录》。用奥勒留的话，为一天做好准备。",
    members:41, joined:true, lead:"周慕白", weekRange:"卷四 · 每日一段", progressPct:38, annos:88,
    memberAvatars:[ {n:"周",c:"#9a5b2e"},{n:"林",c:"#3a4fb0"},{n:"何",c:"#2e7d57"},{n:"许",c:"#7a3d6b"},{n:"陈",c:"#b0553a"},{n:"苏",c:"#3a4fb0"} ],
    schedule:[
      { wk:"上周", chap:"卷一 · 致谢", state:"done" },
      { wk:"上周", chap:"卷二 · 晨起", state:"done" },
      { wk:"本周", chap:"卷四 · 判断", state:"current" },
      { wk:"下周", chap:"卷五 · 本分", state:"upcoming" },
    ],
    discussion:[
      { u:"周慕白", color:"#9a5b2e", when:"今早 7:12", chap:"卷四", t:"今日句：「我们感受到的不是事物本身，而是我们对它的看法。」——你们今天打算把它用在哪件事上？", up:19, replies:9 },
      { u:"何苇", color:"#2e7d57", when:"今早 8:30", chap:"卷四", t:"早高峰堵车，本来要烦，想起这句，告诉自己烦的是「判断」不是「堵车」。有点用。", up:11, replies:3 },
    ],
    topAnno:{ u:"林知秋", color:"#3a4fb0", quote:"我们感受到的不是事物本身，而是我们对它的看法。", t:"斯多葛的核心：困住我们的是判断，不是事件。", up:34 },
  },
  {
    id:"econ-classic", name:"古典经济学", color:"#9a5b2e", seal:"富", book:"wealth",
    desc:"精读《国富论》。分工、市场、看不见的手——从源头理解现代经济。",
    members:17, joined:false, lead:"陈砚之", weekRange:"第一篇 · 论分工", progressPct:15, annos:31,
    memberAvatars:[ {n:"陈",c:"#b0553a"},{n:"许",c:"#3a4fb0"},{n:"苏",c:"#2e7d57"},{n:"何",c:"#7a3d6b"} ],
    schedule:[
      { wk:"本周", chap:"第一篇 · 论分工", state:"current" },
      { wk:"下周", chap:"第一篇 · 论货币", state:"upcoming" },
      { wk:"第 3 周", chap:"第一篇 · 论价格", state:"upcoming" },
    ],
    discussion:[
      { u:"陈砚之", color:"#b0553a", when:"昨天", chap:"第一篇", t:"开篇的别针工厂例子，斯密用它说明分工的威力。今天还成立吗？欢迎举现代的例子。", up:9, replies:4 },
    ],
    topAnno:{ u:"许之", color:"#3a4fb0", quote:"我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。", t:"自利不等于自私——这是斯密最常被误读的一句。", up:22 },
  },
];

/* ---- Seed highlights/notes for the notebook (merged with the user's real ones) ---- */
const SEED_HL = [
  { book:"daodejing", sid:"c33-s1", chap:"第三十三章", color:"hl-user", t:"知人者智，自知者明。", note:"认识别人靠智，认识自己靠「明」——明比智更难。", when:"昨天" },
  { book:"daodejing", sid:"c8-s1", chap:"第八章", color:"hl-yellow", t:"上善若水。水善利万物而不争，处众人之所恶，故几于道。", note:"", when:"3 天前" },
  { book:"daodejing", sid:"c1-s1", chap:"第一章", color:"hl-user", t:"道可道，非常道；名可名，非常名。", note:"能说清的道就不是恒常的道。给语言划了边界。", when:"5 天前" },
  { book:"meditations", sid:"m-1", chap:"卷四", color:"hl-green", t:"我们感受到的不是事物本身，而是我们对它的看法。", note:"斯多葛的核心：困住我们的是判断，不是事件。", when:"1 周前" },
  { book:"meditations", sid:"m-2", chap:"卷二", color:"hl-user", t:"你拥有支配自己心灵的力量——而不是外在的事件。", note:"", when:"1 周前" },
];

/* ---- AI chapter summaries (per book/chapter) ---- */
const AI_SUMMARIES = [
  { book:"daodejing", chap:"第一章 · 道，可道", when:"AI 生成 · 5 天前",
    thread:["「道」不可言说，语言天然有边界。","以「无名 / 有名」分说天地之始与万物之母。","结于「玄之又玄，众妙之门」——认识向更深处递归。"],
    quotes:["道可道，非常道；名可名，非常名。"],
    mine:["道可道，非常道；名可名，非常名。"] },
  { book:"daodejing", chap:"第八章 · 上善若水", when:"AI 生成 · 3 天前",
    thread:["以水喻「上善」：利万物而不争。","水甘居下位，「处众人之所恶」，故几于道。","落到处身七善：居、心、与、言、正、事、动。"],
    quotes:["上善若水。水善利万物而不争。","夫唯不争，故无尤。"],
    mine:["上善若水。水善利万物而不争，处众人之所恶，故几于道。"] },
  { book:"daodejing", chap:"第三十三章 · 知人者智", when:"AI 生成 · 昨天",
    thread:["向外认识他人是「智」，向内认识自己是「明」。","胜人靠力，自胜靠强——把锋芒转向自己。","知足者富：富不在多，而在知止。"],
    quotes:["知人者智，自知者明。","知足者富，强行者有志。"],
    mine:["知人者智，自知者明。"] },
];

/* ---- Social feed ---- */
const FEED = [
  { kind:"anno", u:"沈砚", color:"#2e7d57", when:"12 分钟前", book:"道德经", chap:"第八章",
    quote:"上善若水。水善利万物而不争。", t:"水的「不争」不是软弱，是把锋芒收起来的力量。", up:14, replies:3 },
  { kind:"highlight", u:"周慕白", color:"#9a5b2e", when:"1 小时前", book:"沉思录", chap:"卷四",
    quote:"我们感受到的不是事物本身，而是我们对它的看法。", up:38 },
  { kind:"convo", u:"叶临", color:"#7a3d6b", when:"3 小时前", book:"国富论",
    title:"「看不见的手」是在为自私辩护吗？", preview:"恰恰相反——斯密想说的是个人自利在竞争市场里会无意中促进公共利益。", up:52, saved:23 },
  { kind:"finished", u:"陈砚之", color:"#b0553a", when:"5 小时前", book:"孙子兵法",
    t:"读完了。十三篇，讲的其实是「不战而屈人之兵」。", up:21 },
  { kind:"anno", u:"沈砚", color:"#2e7d57", when:"昨天", book:"道德经", chap:"第一章",
    quote:"道可道，非常道。", t:"和维特根斯坦「凡不可说的，应保持沉默」对照着读很有意思。", up:18, replies:2 },
  { kind:"group", u:"道家共读小组", color:"#1f8a5b", when:"昨天", book:"道德经",
    t:"本周共读进度：第八至十二章。23 人在读，已有 47 条批注。", members:23 },
];

/* ---- A discussion thread (one sentence) ---- */
const THREAD = {
  book:"道德经", chap:"第二章", quote:"天下皆知美之为美，斯恶已。",
  liners:"4,233", root:{ u:"周慕白", color:"#9a5b2e", when:"2 天前", t:"美与丑是同时被定义出来的——一旦立了标准，对立面就跟着诞生。", up:31 },
  replies:[
    { u:"林知秋", color:"#3a4fb0", when:"2 天前", t:"所以老子接着说「有无相生，难易相成」，都是成对出现的。", up:12, mine:true },
    { u:"书友 · AI", color:"var(--accent)", ai:true, when:"2 天前", t:"这正是老子的「相对」观。可与第二章后文「有无相生」连起来读——他在拆解我们习以为常的二元判断。", up:9 },
    { u:"叶临", color:"#7a3d6b", when:"1 天前", t:"那是不是说，不立标准就没有美丑了？", up:5 },
  ],
};

/* ---- Shared AI conversations (browse) ---- */
const CONVOS = [
  { u:"叶临", color:"#7a3d6b", book:"国富论", title:"「看不见的手」是在为自私辩护吗？", turns:4, up:52, saved:23, when:"3 小时前" },
  { u:"沈砚", color:"#2e7d57", book:"道德经", title:"「无为」是消极避世吗？", turns:6, up:41, saved:30, when:"1 天前" },
  { u:"陈砚之", color:"#b0553a", book:"沉思录", title:"斯多葛和佛家的「无常」有什么不同？", turns:5, up:28, saved:17, when:"2 天前" },
];

/* ---- Charts: today / 7-day / 30-day rankings (open, Agent-readable signal) ---- */
const CHARTS = {
  today: [
    { id:"daodejing", reads:3204, lines:412, convos:96, delta:0 },
    { id:"analects",  reads:2980, lines:388, convos:74, delta:1 },
    { id:"artofwar",  reads:2610, lines:351, convos:61, delta:-1 },
    { id:"meditations", reads:2180, lines:303, convos:88, delta:2 },
    { id:"wealth",    reads:1740, lines:222, convos:43, delta:0 },
    { id:"prince",    reads:1510, lines:198, convos:37, delta:1 },
    { id:"republic",  reads:1330, lines:160, convos:29, delta:-2 },
    { id:"origin",    reads:1090, lines:131, convos:22, delta:0 },
  ],
  week: [
    { id:"daodejing", reads:21840, lines:2980, convos:642, delta:0 },
    { id:"artofwar",  reads:19200, lines:2510, convos:430, delta:1 },
    { id:"analects",  reads:18760, lines:2733, convos:511, delta:-1 },
    { id:"meditations", reads:14120, lines:2018, convos:603, delta:1 },
    { id:"wealth",    reads:11020, lines:1422, convos:288, delta:2 },
    { id:"republic",  reads:9330,  lines:1140, convos:201, delta:-1 },
    { id:"prince",    reads:8880,  lines:1102, convos:255, delta:-1 },
    { id:"origin",    reads:7020,  lines:861,  convos:144, delta:0 },
  ],
  month: [
    { id:"daodejing", reads:48201, lines:8402, convos:1247, delta:0 },
    { id:"analects",  reads:30012, lines:6840, convos:988, delta:1 },
    { id:"artofwar",  reads:26540, lines:5521, convos:701, delta:-1 },
    { id:"meditations", reads:33140, lines:6118, convos:903, delta:0 },
    { id:"wealth",    reads:21007, lines:5277, convos:612, delta:1 },
    { id:"republic",  reads:19330, lines:4011, convos:540, delta:0 },
    { id:"prince",    reads:12880, lines:3102, convos:455, delta:-2 },
    { id:"origin",    reads:14720, lines:2733, convos:388, delta:1 },
  ],
  hotToday: { q:"知人者智，自知者明。", book:"道德经", chap:"第三十三章", n:"今日 1,204 人划线" },
};

/* per-window growth (%), for the 飙升 / 黑马 ranking */
const SURGE = {
  today: { daodejing:12, analects:22, artofwar:-8, meditations:46, wealth:9, prince:64, republic:-14, origin:180 },
  week:  { daodejing:8, analects:14, artofwar:31, meditations:22, wealth:48, prince:-6, republic:12, origin:96 },
  month: { daodejing:5, analects:9, artofwar:-3, meditations:11, wealth:18, prince:24, republic:7, origin:140 },
};

/* hot SENTENCES (single-sentence ranking, today) */
const HOT_SENTENCES = [
  { sid:"c33-s1", bookId:"daodejing", book:"道德经", chap:"第三十三章", q:"知人者智，自知者明。", liners:1204, convos:46, delta:0, surge:18 },
  { sid:"c8-s1",  bookId:"daodejing", book:"道德经", chap:"第八章", q:"上善若水。水善利万物而不争，处众人之所恶，故几于道。", liners:980, convos:62, delta:2, surge:54 },
  { sid:"m-1",    bookId:"meditations", book:"沉思录", chap:"卷四", q:"我们感受到的不是事物本身，而是我们对它的看法。", liners:864, convos:88, delta:1, surge:120 },
  { sid:"c1-s1",  bookId:"daodejing", book:"道德经", chap:"第一章", q:"道可道，非常道；名可名，非常名。", liners:742, convos:37, delta:-1, surge:6 },
  { sid:"w-hand", bookId:"wealth", book:"国富论", chap:"第四篇", q:"我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。", liners:531, convos:43, delta:3, surge:210 },
  { sid:"c2-s1",  bookId:"daodejing", book:"道德经", chap:"第二章", q:"天下皆知美之为美，斯恶已。", liners:433, convos:29, delta:-2, surge:-4 },
];

export { BOOKS, CHAPTERS, TOC, BOOK_CONTENT, ANNOTATIONS, HIGHLIGHTS, REVIEWS, ME, READERS as PEOPLE, FOLLOW_SEED, SEED_HL, AI_SUMMARIES, FEED, THREAD, CONVOS, GROUPS, SHARED_CONVOS, ECHOES, AGENTS, LENSES, CHARTS, SURGE, HOT_SENTENCES };
if (typeof window !== "undefined") Object.assign(window, { BOOKS, CHAPTERS, TOC, BOOK_CONTENT, ANNOTATIONS, HIGHLIGHTS, REVIEWS, ME, PEOPLE: READERS, FOLLOW_SEED, SEED_HL, AI_SUMMARIES, FEED, THREAD, CONVOS, GROUPS, SHARED_CONVOS, ECHOES, AGENTS, LENSES, CHARTS, SURGE, HOT_SENTENCES });
