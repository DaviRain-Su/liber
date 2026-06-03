import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readerSource = await readFile(
  new URL("../src/components/product-reader.jsx", import.meta.url),
  "utf8",
);
const productCss = await readFile(new URL("../src/styles/product.css", import.meta.url), "utf8");
const mobileCss = await readFile(
  new URL("../src/styles/product-mobile.css", import.meta.url),
  "utf8",
);

test("reader settings expose all Chinese reading experience modes", () => {
  for (const label of ["经典", "书页", "批注", "竖排", "沉浸"]) {
    assert.match(readerSource, new RegExp(`label: "${label}"`));
  }
  assert.match(readerSource, /<div className="lab">阅读体验<\/div>/);
  assert.match(readerSource, /data-mode=\{readMode\}/);
});

test("EPUB reader mode also receives layout-specific styling", () => {
  for (const layout of ["folio", "vertical", "immersive"]) {
    assert.match(
      productCss,
      new RegExp(`reader\\[data-mode="epub"\\]\\[data-layout="${layout}"\\]`),
    );
  }
  assert.match(readerSource, /layout=\{layout\}/);
  assert.match(
    readerSource,
    /applyEpubTheme\(renditionRef\.current, \{ font, size, lead, rtheme, layout \}\)/,
  );
});

test("mobile vertical mode remains vertical instead of falling back to horizontal", () => {
  assert.match(mobileCss, /\.reader\[data-layout="vertical"\] \.rd-col\s*\{/);
  assert.match(mobileCss, /height: calc\(100dvh - 130px\)/);
  assert.doesNotMatch(mobileCss, /writing-mode:\s*horizontal-tb/);
});
