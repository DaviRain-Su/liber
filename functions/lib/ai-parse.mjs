// Pure parser for Workers AI responses, extracted from aiProvider so it can be
// unit-tested (test/ai-parse.test.mjs) without a live AI binding. Workers AI
// returns one of two shapes depending on the model:
//   - classic:  { response: "..." }
//   - OpenAI chat.completion (qwen3 / reasoning models):
//               { choices: [{ message: { content, reasoning_content } }] }
// (sometimes wrapped in { result: ... }). Return the assistant text from
// whichever is present; reasoning_content is ignored. Empty/missing → "".
export function workersAiText(res) {
  if (res == null) return "";
  if (typeof res.response === "string" && res.response.trim()) return res.response.trim();
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (res.result) return workersAiText(res.result);
  return typeof res.response === "string" ? res.response.trim() : "";
}
