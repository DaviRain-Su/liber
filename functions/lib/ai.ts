// AI book companion, backed by Cloudflare Workers AI (on-platform models, no
// external key). Lens/persona-aware system prompts + selected-sentence context.
import type { Env } from "./types";
import { aiChat } from "./aiProvider";
import { agentEnabled, runCompanionAgent } from "./agent";

const LENS_PROMPT: Record<string, string> = {
  translate: "你是「今译 Agent」，专做古汉语、文言文、繁体古籍的现代汉语翻译与字词释义。忠于原文，不擅自扩写，不把翻译写成读后感。",
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
  translate: "古文今译 · Workers AI",
  companion: "通读陪伴 · Workers AI",
  extend: "知识延展 · Workers AI",
  notes: "已整理为笔记 · 可导出",
  debate: "反问 · 苏格拉底式",
  stoic: "斯多葛导师 · community/stoa",
  textual: "考据派 · community/kaoju",
  skeptic: "怀疑论者 · community/pyrrho",
  econ: "经济学家之眼 · community/smith",
};

function isTranslationLens(lens: string): boolean {
  return lens === "translate";
}

export interface CompanionInput {
  lens: string;
  question: string;
  context?: string | null; // selected sentence
  bookTitle?: string;
  chapter?: string | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface CompanionReply { text: string; ref: string; error?: boolean; steps?: Array<{ tool: string; args: any; ok: boolean }> }

export async function companionReply(env: Env, opts: CompanionInput): Promise<CompanionReply> {
  const persona = LENS_PROMPT[opts.lens] || LENS_PROMPT.companion;
  const translate = isTranslationLens(opts.lens);
  const sys = translate
    ? `${persona}\n当前正在读《${opts.bookTitle || "经典"}》${opts.chapter ? " · " + opts.chapter : ""}。` +
      (opts.context ? `待处理原文：「${opts.context}」。` : "") +
      `\n请只用简体中文回答，格式固定为：\n今译：...\n字词：列 2–4 个关键字词，逐个解释。\n提醒：只写必要的不确定处或常见误读；没有就省略。`
    : `${persona}\n` +
      `当前正在读《${opts.bookTitle || "经典"}》${opts.chapter ? " · " + opts.chapter : ""}。` +
      (opts.context ? `读者正就这一句提问：「${opts.context}」。` : "") +
      `\n请用简体中文回答，克制、具体，2–5 句，不要寒暄。`;

  const history = (opts.history || []).slice(-8);

  // Agent path: when enabled + a tool-capable provider, let the book companion
  // actually read passages / look up cross-book echoes / search before answering.
  if (!translate && agentEnabled(env)) {
    try {
      const agentSys = sys + "\n你可以调用工具读正文、查跨书呼应、看热门划线、检索馆藏；先查证再作答，不要凭空编造。";
      const r = await runCompanionAgent(env, { system: agentSys, history, question: opts.question });
      if (r.text) return { text: r.text, ref: LENS_REF[opts.lens] || LENS_REF.companion, steps: r.steps };
      // empty answer → fall through to single-shot
    } catch { /* fall through to single-shot below */ }
  }

  const messages = [
    { role: "system", content: sys },
    ...history,
    { role: "user", content: opts.question },
  ];

  try {
    // routed through the swappable provider gateway (Workers AI / DeepSeek / …)
    const text = (await aiChat(env, messages as any, {
      maxTokens: translate ? 700 : 512,
      temperature: translate ? 0.2 : 0.7,
      model: translate ? env.AI_TRANSLATION_MODEL : undefined,
      gatewayCache: translate,
    }))
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
