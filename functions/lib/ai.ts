// AI book companion, backed by Cloudflare Workers AI (on-platform models, no
// external key). Lens/persona-aware system prompts + selected-sentence context.
import type { Env } from "./types";
import { aiChat } from "./aiProvider";

const LENS_PROMPT: Record<string, string> = {
  companion: "你是「书友」，一个温和、博学的通读陪伴者。陪读者一句句读懂经典，不剧透后文。",
  extend: "你是知识延展者。把读者眼前的概念，连接到馆里其他经典与思想，给出可顺藤摸瓜的线索。",
  notes: "你是笔记整理者。把要点整理成清晰的脉络与金句，便于读者归档。",
  debate: "你是苏格拉底式的提问者。不直接给答案，只一层层反问，引导读者自己想清楚。",
  stoic: "你是斯多葛导师，用奥勒留的视角重读文本：区分掌控之内与之外，关注判断而非事件。",
  textual: "你是考据派，咬文嚼字，追字词的源流、版本异同与注本分歧。",
  skeptic: "你是怀疑论者，对每个论断都先追问「凭什么」，并主动寻找反例。",
  econ: "你是经济学家之眼，用激励、成本、市场与稀缺重读文本背后的那笔账。",
};

const LENS_REF: Record<string, string> = {
  companion: "通读陪伴 · Workers AI",
  extend: "知识延展 · Workers AI",
  notes: "已整理为笔记 · 可导出",
  debate: "反问 · 苏格拉底式",
  stoic: "斯多葛导师 · community/stoa",
  textual: "考据派 · community/kaoju",
  skeptic: "怀疑论者 · community/pyrrho",
  econ: "经济学家之眼 · community/smith",
};

export interface CompanionInput {
  lens: string;
  question: string;
  context?: string | null; // selected sentence
  bookTitle?: string;
  chapter?: string | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function companionReply(env: Env, opts: CompanionInput): Promise<{ text: string; ref: string; error?: boolean }> {
  const persona = LENS_PROMPT[opts.lens] || LENS_PROMPT.companion;
  const sys =
    `${persona}\n` +
    `当前正在读《${opts.bookTitle || "经典"}》${opts.chapter ? " · " + opts.chapter : ""}。` +
    (opts.context ? `读者正就这一句提问：「${opts.context}」。` : "") +
    `\n请用简体中文回答，克制、具体，2–5 句，不要寒暄。`;

  const messages = [
    { role: "system", content: sys },
    ...(opts.history || []).slice(-8),
    { role: "user", content: opts.question },
  ];

  try {
    // routed through the swappable provider gateway (Workers AI / DeepSeek / …)
    const text = (await aiChat(env, messages as any, { maxTokens: 512, temperature: 0.7 }))
      || "（一时没有头绪，换个问法试试？）";
    return { text, ref: LENS_REF[opts.lens] || LENS_REF.companion };
  } catch (err) {
    return {
      text: "AI 书友暂时不可用（Workers AI 未绑定或超出额度）。本地仍可继续阅读、划线与批注。",
      ref: "offline",
      error: true,
    };
  }
}
