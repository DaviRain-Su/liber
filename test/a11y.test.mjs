import assert from "node:assert/strict";
import test from "node:test";

import { clickable } from "../src/lib/a11y.js";

test("clickable adds button semantics and keyboard activation without losing onClick", () => {
  let n = 0;
  const props = clickable(() => {
    n += 1;
  });
  assert.equal(props.role, "button");
  assert.equal(props.tabIndex, 0);

  const ev = (key) => ({ key, preventDefault() {} });
  props.onKeyDown(ev("Enter"));
  props.onKeyDown(ev(" "));
  props.onKeyDown(ev("a")); // ignored
  assert.equal(n, 2);

  props.onClick();
  assert.equal(n, 3);
});

test("clickable honors a custom role", () => {
  const props = clickable(() => {}, { role: "tab" });
  assert.equal(props.role, "tab");
  assert.equal(props.tabIndex, 0);
});
