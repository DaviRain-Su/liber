#!/usr/bin/env node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBookManifest,
  createIngestPayload,
  inspectEpub,
  publishBookManifestChunked,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";

const API_URL = "https://liber.davirain.xyz";

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

  { id: "faust-i-gutenberg-de", pg: 2229, lang: "de", title: "Faust I", category: "Deutsch · Drama", expect: "Faust" },
  { id: "faust-ii-gutenberg-de", pg: 2230, lang: "de", title: "Faust II", category: "Deutsch · Drama", expect: "Faust" },
  { id: "verwandlung-gutenberg-de", pg: 22367, lang: "de", title: "Die Verwandlung", category: "Deutsch · Erzählung", expect: "Verwandlung" },
  { id: "zarathustra-gutenberg-de", pg: 7205, lang: "de", title: "Also sprach Zarathustra", category: "Deutsch · Philosophie", expect: "Zarathustra" },
  { id: "immensee-gutenberg-de", pg: 6651, lang: "de", title: "Immensee", category: "Deutsch · Novelle", expect: "Immensee" },
  { id: "werther-1-gutenberg-de", pg: 2407, lang: "de", title: "Die Leiden des jungen Werther — Band 1", category: "Deutsch · Roman", expect: "Werther" },
  { id: "werther-2-gutenberg-de", pg: 2408, lang: "de", title: "Die Leiden des jungen Werther — Band 2", category: "Deutsch · Roman", expect: "Werther" },

  { id: "divina-commedia-gutenberg-it", pg: 1000, lang: "it", title: "La Divina Commedia", category: "Italiano · Poesia", expect: "Commedia" },
  { id: "pinocchio-gutenberg-it", pg: 52484, lang: "it", title: "Le avventure di Pinocchio", category: "Italiano · Narrativa", expect: "Pinocchio" },
  { id: "promessi-sposi-gutenberg-it", pg: 45334, lang: "it", title: "I promessi sposi", category: "Italiano · Romanzo", expect: "Promessi" },

  { id: "don-quijote-gutenberg-es", pg: 2000, lang: "es", title: "Don Quijote", category: "Español · Novela", expect: "Quijote" },
  { id: "celestina-gutenberg-es", pg: 1619, lang: "es", title: "La Celestina", category: "Español · Teatro", expect: "Celestina" },
  { id: "lazarillo-gutenberg-es", pg: 320, lang: "es", title: "Lazarillo de Tormes", category: "Español · Novela", expect: "Lazarillo" },

  { id: "dom-casmurro-gutenberg-pt", pg: 55752, lang: "pt", title: "Dom Casmurro", category: "Português · Romance", expect: "Casmurro" },
  { id: "bras-cubas-gutenberg-pt", pg: 54829, lang: "pt", title: "Memórias Póstumas de Brás Cubas", category: "Português · Romance", expect: "Braz" },
  { id: "quincas-borba-gutenberg-pt", pg: 55682, lang: "pt", title: "Quincas Borba", category: "Português · Romance", expect: "Quincas" },

  { id: "max-havelaar-gutenberg-nl", pg: 11024, lang: "nl", title: "Max Havelaar", category: "Nederlands · Roman", expect: "Havelaar" },
  { id: "kalevala-gutenberg-fi", pg: 7000, lang: "fi", title: "Kalevala", category: "Suomi · Eepos", expect: "Kalevala" },
  { id: "roda-rummet-gutenberg-sv", pg: 57052, lang: "sv", title: "Röda rummet", category: "Svenska · Roman", expect: "Röda" },
  { id: "hemsoborna-gutenberg-sv", pg: 30078, lang: "sv", title: "Hemsöborna", category: "Svenska · Roman", expect: "Hemsöborna" },
  { id: "vildanden-gutenberg-no", pg: 13041, lang: "no", title: "Vildanden", category: "Norsk · Drama", expect: "Vildanden" },
  { id: "pelle-erobreren-1-gutenberg-da", pg: 76563, lang: "da", title: "Pelle Erobreren 1: Barndom", category: "Dansk · Roman", expect: "Pelle" },

  { id: "rashomon-gutenberg-ja", pg: 1982, lang: "ja", title: "羅生門", category: "日本語 · 小説", expect: "羅生門" },
  { id: "shisei-gutenberg-ja", pg: 31617, lang: "ja", title: "刺青", category: "日本語 · 小説", expect: "刺" },
  { id: "atsumono-gutenberg-ja", pg: 36459, lang: "ja", title: "羹", category: "日本語 · 小説", expect: "羹" },
  { id: "america-monogatari-gutenberg-ja", pg: 35327, lang: "ja", title: "あめりか物語", category: "日本語 · 小説", expect: "あめりか" },
  { id: "doko-e-gutenberg-ja", pg: 32941, lang: "ja", title: "何處へ", category: "日本語 · 小説", expect: "何處" },

  { id: "duhovnye-ody-gutenberg-ru", pg: 14741, lang: "ru", title: "Духовные оды", category: "Русский · Поэзия", expect: "Духовные" },
  { id: "pan-tadeusz-gutenberg-pl", pg: 31536, lang: "pl", title: "Pan Tadeusz", category: "Polski · Poezja", expect: "Tadeusz" },
  { id: "rur-gutenberg-cs", pg: 13083, lang: "cs", title: "R.U.R.", category: "Čeština · Drama", expect: "R.U.R." },
  { id: "petofi-poems-gutenberg-hu", pg: 41504, lang: "hu", title: "Petőfi Sándor összes költeményei", category: "Magyar · Költészet", expect: "Petőfi" },
  { id: "iliad-gutenberg-el", pg: 36248, lang: "el", title: "Ιλιάδα", category: "Ελληνικά · Έπος", expect: "Ιλιάδα" },
  { id: "aeneidos-gutenberg-la", pg: 227, lang: "la", title: "Aeneidos", category: "Latina · Epic", expect: "Aeneidos" },
];

function parseArgs(argv) {
  const out = { publish: false, json: false, apiUrl: API_URL, ids: BOOKS.map((b) => b.id) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish" || arg === "--json") {
      out[arg.slice(2)] = true;
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

function epubUrl(book) {
  return `https://www.gutenberg.org/ebooks/${book.pg}.epub.images`;
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

async function fetchGutenbergMetadata(book) {
  const res = await fetch(rdfUrl(book), { headers: { "user-agent": "liber-gutenberg-import/0.1" } });
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

async function download(url, filePath) {
  const res = await fetch(url, { headers: { "user-agent": "liber-gutenberg-import/0.1" } });
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await writeFile(filePath, new Uint8Array(await res.arrayBuffer()));
}

async function probe(apiUrl, book) {
  const [bookRes, contentRes, searchRes] = await Promise.all([
    fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}`),
    fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}/content/1`),
    fetch(`${apiUrl}/api/search?q=${encodeURIComponent(book.expect)}`),
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
  await download(epubUrl(book), filePath);

  const info = await inspectEpub(filePath);
  const license = await verifyPublishLicense(info, { source: sourceUrl(book), license: metadataLicense.license, evidence: metadata.rights.join("; ") });
  const manifest = await createBookManifest(filePath, { source: sourceUrl(book), license: metadataLicense.license, evidence: metadata.rights.join("; ") });
  const payload = await createIngestPayload(manifest, { id: book.id, category: book.category, lang: book.lang, includeSource: false });

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
    rights: metadata.rights,
    sha256: info.sha256,
    license: license.license,
    accepted: license.accepted,
    chapters: payload.chapters.length,
    sampleTitles: payload.chapters.slice(0, 12).map((chapter) => chapter.title),
    published: Boolean(publish),
    live,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = BOOKS.filter((book) => options.ids.includes(book.id));
  if (!selected.length) throw new Error(`No matching books for --ids ${options.ids.join(",")}`);
  const results = [];
  for (const book of selected) results.push(await importOne(book, options));
  const output = { mode: options.publish ? "publish" : "dry-run", apiUrl: options.apiUrl, results };
  process.stdout.write(options.json ? `${JSON.stringify(output, null, 2)}\n` : `${results.map((r) => `${r.id}: ${r.title}`).join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
