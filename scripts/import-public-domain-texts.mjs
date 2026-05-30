#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBookManifest,
  createIngestPayload,
  inspectEpub,
  publishBookManifest,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";

const BOOKS = [
  {
    id: "xinjing-xuanzang",
    title: "般若波羅蜜多心經",
    subtitle: "Heart Sutra",
    author: "玄奘譯",
    lang: "zh",
    category: "宗教 · 佛典",
    year: "唐",
    source: "https://commons.wikimedia.org/wiki/File:NCPSSD-71016218_%E8%88%AC%E8%8B%A5%E6%B3%A2%E7%BE%85%E8%9C%9C%E5%A4%9A%E5%BF%83%E7%B6%93%E6%B3%A8%E8%A7%A3_%E7%AC%AC%E4%B8%80%E5%86%8C.pdf",
    evidence: "唐玄奘譯本；Wikimedia Commons scan is marked public domain.",
    blurb: "觀自在菩薩，行深般若波羅蜜多時，照見五蘊皆空。",
    description: "玄奘譯《般若波羅蜜多心經》白文，依公版經文整理為 EPUB。",
    chapters: [
      {
        title: "經文",
        body: [
          "觀自在菩薩，行深般若波羅蜜多時，照見五蘊皆空，度一切苦厄。",
          "舍利子，色不異空，空不異色；色即是空，空即是色。受想行識，亦復如是。",
          "舍利子，是諸法空相，不生不滅，不垢不淨，不增不減。",
          "是故空中無色，無受想行識；無眼耳鼻舌身意；無色聲香味觸法；無眼界，乃至無意識界；無無明，亦無無明盡；乃至無老死，亦無老死盡。無苦集滅道，無智亦無得。",
          "以無所得故，菩提薩埵依般若波羅蜜多故，心無罣礙；無罣礙故，無有恐怖，遠離顛倒夢想，究竟涅槃。",
          "三世諸佛依般若波羅蜜多故，得阿耨多羅三藐三菩提。",
          "故知般若波羅蜜多，是大神咒，是大明咒，是無上咒，是無等等咒，能除一切苦，真實不虛。",
          "故說般若波羅蜜多咒，即說咒曰：揭諦揭諦，波羅揭諦，波羅僧揭諦，菩提薩婆訶。",
        ],
      },
    ],
  },
  {
    id: "qingjing-jing",
    title: "太上老君說常清靜經",
    subtitle: "Qingjing Jing",
    author: "題葛玄錄",
    lang: "zh",
    category: "宗教 · 道藏",
    year: "古本",
    source: "https://commons.wikimedia.org/wiki/File:IOC.UTokyo-008019_%E5%A4%AA%E4%B8%8A%E8%80%81%E5%90%9B%E8%AA%AA%E5%B8%B8%E6%B8%85%E9%9D%9C%E7%B6%93%E8%A8%BB%E4%B8%80%E5%8D%B7_%E5%8D%B7%E4%B8%80.pdf",
    evidence: "Wikimedia Commons identifies the source scan as public domain.",
    blurb: "大道無形，生育天地；大道無情，運行日月。",
    description: "《太上老君說常清靜經》白文，依公版道藏經文整理為 EPUB。",
    chapters: [
      {
        title: "道與清靜",
        body: [
          "老君曰：大道無形，生育天地；大道無情，運行日月；大道無名，長養萬物；吾不知其名，強名曰道。",
          "夫道者，有清有濁，有動有靜；天清地濁，天動地靜；男清女濁，男動女靜；降本流末，而生萬物。",
          "清者濁之源，動者靜之基。人能常清靜，天地悉皆歸。",
        ],
      },
      {
        title: "遣欲澄心",
        body: [
          "夫人神好清，而心擾之；人心好靜，而慾牽之。常能遣其慾，而心自靜；澄其心，而神自清。自然六慾不生，三毒消滅。",
          "所以不能者，為心未澄，慾未遣也。能遣之者，內觀其心，心無其心；外觀其形，形無其形；遠觀其物，物無其物。",
          "三者既悟，唯見於空；觀空亦空，空無所空；所空既無，無無亦無；無無既無，湛然常寂。",
        ],
      },
      {
        title: "真常應物",
        body: [
          "寂無所寂，欲豈能生？欲既不生，即是真靜。",
          "真常應物，真常得性；常應常靜，常清靜矣。如此清靜，漸入真道；既入真道，名為得道。",
          "雖名得道，實無所得；為化眾生，名為得道。能悟之者，可傳聖道。",
        ],
      },
      {
        title: "悟者自得",
        body: [
          "老君曰：上士無爭，下士好爭；上德不德，下德執德；執著之者，不明道德。",
          "眾生所以不得真道者，為有妄心。既有妄心，即驚其神；既驚其神，即著萬物；既著萬物，即生貪求；既生貪求，即是煩惱。",
          "煩惱妄想，憂苦身心；便遭濁辱，流浪生死；常沉苦海，永失真道。真常之道，悟者自得；得悟道者，常清靜矣。",
        ],
      },
    ],
  },
];

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

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
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
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0), name, body,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

function xml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xhtmlParagraphs(lines) {
  return lines.map((line) => `<p>${xml(line)}</p>`).join("\n");
}

async function writeEpub(book) {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-pd-text-"));
  const epubPath = path.join(dir, `${book.id}.epub`);
  const manifestItems = book.chapters
    .map((_, i) => `    <item id="c${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItems = book.chapters.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join("\n");
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="bookid" version="3.0">
  <metadata>
    <dc:identifier id="bookid">urn:liber:${xml(book.id)}</dc:identifier>
    <dc:title>${xml(book.title)}</dc:title>
    <dc:creator>${xml(book.author)}</dc:creator>
    <dc:language>${xml(book.lang)}</dc:language>
    <dc:rights>PUBLIC-DOMAIN</dc:rights>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
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
    ...book.chapters.map((chapter, i) => ({
      name: `OEBPS/chapter${i + 1}.xhtml`,
      body: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xml(book.lang)}">
  <head><title>${xml(chapter.title)}</title></head>
  <body><h1>${xml(chapter.title)}</h1>${xhtmlParagraphs(chapter.body)}</body>
</html>`,
    })),
  ]);
  await writeFile(epubPath, zip);
  return { epubPath, sha256: createHash("sha256").update(zip).digest("hex") };
}

function parseArgs(argv) {
  const out = { publish: false, apiUrl: "https://liber.davirain.xyz", ids: BOOKS.map((b) => b.id), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish" || arg === "--json") {
      out[arg.slice(2)] = true;
      continue;
    }
    if (arg === "--ids" || arg === "--api-url") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--ids") out.ids = value.split(",").map((s) => s.trim()).filter(Boolean);
      else out.apiUrl = value.replace(/\/+$/, "");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function importOne(book, options) {
  process.stderr.write(`[pd] package ${book.id}...\n`);
  const { epubPath } = await writeEpub(book);
  const info = await inspectEpub(epubPath);
  const license = verifyPublishLicense(info, { source: book.source, license: "PUBLIC-DOMAIN", evidence: book.evidence });
  const manifest = await createBookManifest(epubPath, { source: book.source, license: "PUBLIC-DOMAIN", evidence: book.evidence });
  const payload = await createIngestPayload(manifest, book);
  let publish = null;
  if (options.publish) {
    process.stderr.write(`[pd] publish ${book.id} (${payload.chapters.length} chapters)...\n`);
    publish = await publishBookManifest(manifest, { ...book, apiUrl: options.apiUrl });
  }
  return {
    id: book.id,
    title: info.metadata.title,
    sha256: info.sha256,
    license: license.license,
    accepted: license.accepted,
    chapters: payload.chapters.length,
    published: Boolean(publish),
    publish,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = BOOKS.filter((b) => options.ids.includes(b.id));
  if (!selected.length) throw new Error(`No matching books for --ids ${options.ids.join(",")}`);
  const results = [];
  for (const book of selected) results.push(await importOne(book, options));
  process.stdout.write(`${JSON.stringify({ mode: options.publish ? "publish" : "dry-run", results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
