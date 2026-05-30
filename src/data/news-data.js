/* ============================================================
   Liber 动态 / News — short, original posts.

   The flagship explainer ("什么是公共领域知识") is published CC0,
   consistent with everything else in the library. Posts are plain
   data; product-news.jsx renders the list and the article body.

   Body blocks:
     { type:"p",  text, lead? }   paragraph (lead = larger opening line)
     { type:"h2", text }          section subheading
     { type:"quote", text, cite } pull-quote
     { type:"ul", items:[...] }   bullet list
   Inline **bold** is supported inside text / items.
   ============================================================ */

const NEWS = [
  {
    id: "what-is-public-domain",
    title: "什么是「公共领域知识」，以及我们为何能自由使用它",
    tag: "理念",
    date: "2026-05-30",
    author: "Liber",
    license: "CC0-1.0",
    seal: "公",
    cls: "ink",
    excerpt:
      "版权不是永恒的。当保护期结束，作品回到所有人手中——这就是公共领域。Liber 整座图书馆，正建立在这份人类共同的遗产之上。",
    body: [
      {
        type: "p",
        lead: true,
        text:
          "打开 Liber，你会发现一件不寻常的事：这里的每一本书都可以免费读、自由下载、随意转发，甚至拿去翻译、改编、再创作——没有人会因此找你麻烦。这不是盗版，恰恰相反，它完全合法。让这一切成立的，是一个常被忽略却至关重要的概念：**公共领域（Public Domain）**。",
      },
      { type: "h2", text: "版权，是有期限的保护" },
      {
        type: "p",
        text:
          "我们习惯了「一切创作都有版权」。这没错，但容易让人忘记后半句：**版权保护是有期限的。** 法律给予作者及其继承人一段独占权利的时间，让创作能换来回报；可一旦这段时间结束，作品就会**自动**离开私人之手，进入公共领域。",
      },
      {
        type: "p",
        text:
          "这个期限各国不尽相同，但大体相近：在中国，是作者去世后 **50 年**；在美国、欧盟等多数地区，是 **70 年**。期满之后，无需任何人申请、批准或付费，作品便成为全人类的共同财产。",
      },
      {
        type: "quote",
        text: "版权的存在，从来不是为了让知识被永久私有，而是为了在「激励创作」与「公共获取」之间取得平衡。",
        cite: "公共领域的基本法理",
      },
      { type: "h2", text: "进入公共领域，意味着什么" },
      {
        type: "p",
        text:
          "当一部作品进入公共领域，它就**属于每一个人**，也**不再属于任何特定的人**。你可以：",
      },
      {
        type: "ul",
        items: [
          "自由复制、保存、分发——无论纸质还是数字；",
          "自由翻译成任何语言，改编成任何形式；",
          "在它之上继续创作，无需署名授权、无需支付版税；",
          "用任何方式使用它，包括商业用途。",
        ],
      },
      {
        type: "p",
        text:
          "这正是 Liber 馆藏的来历。《道德经》《论语》《沉思录》《国富论》《物种起源》……这些塑造了人类文明的著作，早已超过任何版权期限。它们不属于某家出版社，也不属于某个平台——它们属于你我，属于未来。",
      },
      { type: "h2", text: "那「CC0」又是什么？" },
      {
        type: "p",
        text: "在书库里你会反复看到 **CC0** 这个标记。它和公共领域是一对孪生概念。",
      },
      {
        type: "p",
        text:
          "公共领域，是「版权到期后**自动**发生」的状态；而 CC0 是创作者**主动**把自己的作品**提前**捐献给公共领域的一份声明——「我放弃我对这件作品的一切权利，请自由使用」。",
      },
      {
        type: "p",
        text:
          "Liber 对自己所做的工作——整理校订、转写排版、AI 生成的导读与摘要——一律以 **CC0** 发布。也就是说，不只是古老的经典，连我们今天为这座图书馆添上的部分，也同样自由。**拿来即用，永不反悔。**",
      },
      { type: "h2", text: "为什么这件事值得郑重对待" },
      {
        type: "p",
        text:
          "因为公共领域正在被悄悄侵蚀。一方面，版权期限在不少地区被一再延长；另一方面，明明已是公版的书，常被锁进某个 App、某种格式、某家公司的服务器里——平台可以随时下架、关停、改变规则。**知识是自由的，承载它的容器却未必。**",
      },
      {
        type: "p",
        text:
          "Liber 想做的事很简单：把这些本就属于所有人的书，用**任何人都无法单方面收回**的方式保存下来——写入去中心化网络（Walrus、Arweave），把索引记录在链上（Sui）。没有谁能让它消失，包括我们自己。",
      },
      { type: "quote", text: "书会绝版，平台会关停。知识不该如此。", cite: "Liber" },
      { type: "h2", text: "一座建立在公共遗产上的图书馆" },
      {
        type: "p",
        text:
          "所以，当你在 Liber 自由地读一本书时，请记得：这份自由不是某种慷慨的施舍，而是这些作品**本来的、合法的状态**。我们只是把它们收好、存住、讲清楚，再交还到你手里。",
      },
      {
        type: "p",
        text: "这，就是公共领域知识——人类写给未来的、永不过期的礼物。",
      },
    ],
  },

  {
    id: "why-public-domain-first",
    title: "为什么 Liber 从公版经典开始",
    tag: "理念",
    date: "2026-05-20",
    author: "Liber",
    license: "CC0-1.0",
    seal: "始",
    cls: "cinnabar",
    excerpt: "不是因为它们免费，而是因为它们经得起时间，且属于所有人。",
    body: [
      {
        type: "p",
        lead: true,
        text: "有人问：互联网上书那么多，Liber 为什么偏偏先收那些「老书」？",
      },
      {
        type: "p",
        text:
          "答案有两层。第一层关于**权利**：公版经典不受版权束缚，我们可以光明正大地永久保存、自由分发，而不必和谁谈授权、付抽成。这让「永不下架」这件事第一次真正可能。",
      },
      {
        type: "p",
        text:
          "第二层关于**价值**：能熬过几十、几百年仍被反复阅读的书，本身就是一道最严格的筛子。《论语》《沉思录》《国富论》之所以还在被读，是因为它们一次次被证明值得读。",
      },
      {
        type: "p",
        text:
          "把「最自由」和「最经得起时间」这两件事叠在一起，就是 Liber 的起点。我们从这里出发，但不止步于此。",
      },
    ],
  },

  {
    id: "catalog-update-multilingual",
    title: "馆藏更新：新增中文与多语种公版经典",
    tag: "公告",
    date: "2026-05-28",
    author: "Liber",
    license: "CC0-1.0",
    seal: "藏",
    cls: "jade",
    excerpt:
      "一批通过版权核验的公共领域书籍已陆续入库，涵盖中文经典与多语种 Project Gutenberg 文本。",
    body: [
      { type: "p", lead: true, text: "我们刚刚为书库添上了一批新书。" },
      {
        type: "p",
        text:
          "这一批包括两类来源：经过校订的**中文公版经典**，以及来自 **Project Gutenberg** 的多语种公共领域文本。每一本都经过同一套版权核验流程，只有明确属于 **Public Domain 或 CC0** 的作品才会被收录。",
      },
      {
        type: "p",
        text:
          "入库时，我们保留原始文件作为存档层，并从中提取出干净的章节与目录，供阅读与检索使用——许多源文件的导航信息并不完整，这一步让它们重新变得好读。",
      },
      {
        type: "p",
        text:
          "书库仍在持续扩充。如果你也想贡献一本公版书，可以通过 Liber CLI 自行发布——无需我们点头。",
      },
    ],
  },
];

function getNews() {
  return NEWS;
}

function findNewsPost(id) {
  return NEWS.find((p) => p.id === id) || null;
}

export { NEWS, getNews, findNewsPost };
