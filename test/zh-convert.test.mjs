import assert from "node:assert/strict";
import test from "node:test";

import { convertChineseText, isChineseScriptMode } from "../src/lib/zh-convert.js";

test("convertChineseText converts traditional Chinese text to simplified", () => {
  assert.equal(
    convertChineseText("無名天地之始，有名萬物之母。玄之又玄，眾妙之門。", "hans"),
    "无名天地之始，有名万物之母。玄之又玄，众妙之门。",
  );
});

test("convertChineseText converts simplified Chinese text to traditional", () => {
  assert.equal(
    convertChineseText("道德经：故常无欲，以观其妙；常有欲，以观其徼。", "hant"),
    "道德經：故常無欲，以觀其妙；常有欲，以觀其徼。",
  );
});

test("convertChineseText preserves original text when requested", () => {
  const value = "菜根譚前後集";
  assert.equal(convertChineseText(value, "original"), value);
});

test("isChineseScriptMode accepts only supported display modes", () => {
  assert.equal(isChineseScriptMode("original"), true);
  assert.equal(isChineseScriptMode("hans"), true);
  assert.equal(isChineseScriptMode("hant"), true);
  assert.equal(isChineseScriptMode("latin"), false);
});
