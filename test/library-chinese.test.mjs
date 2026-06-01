import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("library route opens on Chinese when Chinese books are available", async () => {
  const source = await readFile("src/components/product-library.jsx", "utf8");
  assert.match(source, /const DEFAULT_LIBRARY_LANG = "zh"/);
  assert.match(source, /useStateLib\(DEFAULT_LIBRARY_LANG\)/);
  assert.match(source, /!langs\.some\(\(row\) => row\.code === lang\)/);
});

test("dynamic catalog quarantines known broken Chinese imports", async () => {
  const source = await readFile("functions/lib/catalog.ts", "utf8");
  assert.match(source, /QUARANTINED_LIBRARY_BOOK_IDS/);
  assert.doesNotMatch(source, /"hongloumeng-gutenberg-zh"/);
  assert.doesNotMatch(source, /"haigong-an-gutenberg-zh"/);
  assert.doesNotMatch(source, /"wenming-xiaoshi-gutenberg-zh"/);
  assert.match(source, /"rulin-waishi-gutenberg-zh"/);
  assert.match(source, /function visibleLibraryBookWhere/);
  assert.match(source, /WHERE \$\{visibleLibraryBookWhere\("lb"\)\}/);
  assert.match(source, /if \(isQuarantinedLibraryBook\(bookId\)\) return null/);
});
