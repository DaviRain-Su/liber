// Behavioral tests for the Workers AI response parser (functions/lib/ai-parse.mjs).
// This is the single chokepoint that turns model output into user-facing text; a
// regression here is exactly what caused the earlier "empty reply" bug (qwen3
// returns the OpenAI shape, not the classic {response} shape).
import test from "node:test";
import assert from "node:assert/strict";
import { workersAiText } from "../functions/lib/ai-parse.mjs";

test("classic { response } shape", () => {
  assert.equal(workersAiText({ response: "你好" }), "你好");
  assert.equal(workersAiText({ response: "  trimmed  " }), "trimmed");
});

test("OpenAI chat.completion shape (qwen3 / reasoning models)", () => {
  assert.equal(
    workersAiText({ choices: [{ message: { content: "答案", reasoning_content: "先想一想…" } }] }),
    "答案",
  );
  // reasoning_content must be ignored, never returned
  assert.notEqual(
    workersAiText({ choices: [{ message: { content: "答案", reasoning_content: "泄露的思考" } }] }),
    "泄露的思考",
  );
});

test("nested { result } wrapper recurses into either shape", () => {
  assert.equal(workersAiText({ result: { response: "x" } }), "x");
  assert.equal(workersAiText({ result: { choices: [{ message: { content: "y" } }] } }), "y");
});

test("empty / missing / malformed → empty string (so the route can flag it)", () => {
  assert.equal(workersAiText(null), "");
  assert.equal(workersAiText(undefined), "");
  assert.equal(workersAiText({}), "");
  assert.equal(workersAiText({ response: "" }), "");
  assert.equal(workersAiText({ response: "   " }), ""); // whitespace-only counts as empty
  assert.equal(workersAiText({ choices: [] }), "");
  assert.equal(workersAiText({ choices: [{ message: {} }] }), "");
  assert.equal(workersAiText({ choices: [{ message: { content: "" } }] }), "");
  assert.equal(workersAiText({ choices: [{ message: { content: 123 } }] }), ""); // non-string content
});

test("prefers a non-empty classic response, else falls through to choices", () => {
  assert.equal(workersAiText({ response: "a", choices: [{ message: { content: "b" } }] }), "a");
  assert.equal(workersAiText({ response: "", choices: [{ message: { content: "b" } }] }), "b");
  assert.equal(workersAiText({ response: "   ", choices: [{ message: { content: "b" } }] }), "b");
});
