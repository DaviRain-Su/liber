import assert from "node:assert/strict";
import test from "node:test";

import { searchQueryTokens, sqlLikeSearchTerm, sqlLikeSearchTerms } from "../functions/lib/catalog";

test("sqlLikeSearchTerm keeps short Chinese search terms intact", () => {
  assert.equal(sqlLikeSearchTerm("三國志·程黃韓蔣"), "三國志·程黃韓蔣");
});

test("sqlLikeSearchTerm clamps long Han-heavy search terms for D1 LIKE stability", () => {
  assert.equal(
    sqlLikeSearchTerm("三國志·程黃韓蔣周陳董甘淩徐潘丁傳"),
    "三國志·程黃韓蔣周陳董甘淩徐潘丁",
  );
});

test("sqlLikeSearchTerm leaves long Latin search terms intact", () => {
  assert.equal(
    sqlLikeSearchTerm("the complete works of shakespeare"),
    "the complete works of shakespeare",
  );
});

test("searchQueryTokens supports Chinese title plus author queries", () => {
  assert.deepEqual(searchQueryTokens("青玉案 辛棄疾"), ["青玉案", "辛棄疾"]);
  assert.deepEqual(searchQueryTokens("  李清照   永遇樂  "), ["李清照", "永遇樂"]);
});

test("sqlLikeSearchTerms keeps all Chinese query tokens for D1 candidate search", () => {
  assert.deepEqual(sqlLikeSearchTerms("千家詩 朱熹"), ["千家詩", "朱熹"]);
  assert.deepEqual(sqlLikeSearchTerms("  青玉案   辛棄疾  "), ["青玉案", "辛棄疾"]);
});
