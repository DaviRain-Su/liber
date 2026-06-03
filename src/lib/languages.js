export const LANGUAGE_ORDER = [
  "zh",
  "en",
  "ja",
  "ko",
  "sa",
  "ar",
  "fa",
  "pt",
  "fr",
  "de",
  "es",
  "it",
  "eo",
  "ca",
  "ro",
  "tl",
  "he",
  "da",
  "no",
  "sv",
  "fi",
  "nl",
  "pl",
  "cs",
  "ru",
  "hu",
  "el",
  "la",
];

export const LANGUAGE_LABELS = {
  zh: { name: "中文", sub: "Chinese" },
  en: { name: "English", sub: "英文" },
  ja: { name: "日本語", sub: "日文" },
  ko: { name: "한국어", sub: "韩文" },
  sa: { name: "संस्कृतम्", sub: "梵文" },
  ar: { name: "العربية", sub: "阿拉伯语" },
  fa: { name: "فارسی", sub: "波斯语" },
  pt: { name: "Português", sub: "葡萄牙语" },
  fr: { name: "Français", sub: "法语" },
  de: { name: "Deutsch", sub: "德语" },
  es: { name: "Español", sub: "西班牙语" },
  it: { name: "Italiano", sub: "意大利语" },
  eo: { name: "Esperanto", sub: "世界语" },
  ca: { name: "Català", sub: "加泰罗尼亚语" },
  ro: { name: "Română", sub: "罗马尼亚语" },
  tl: { name: "Tagalog", sub: "他加禄语" },
  he: { name: "עברית", sub: "希伯来语" },
  da: { name: "Dansk", sub: "丹麦语" },
  no: { name: "Norsk", sub: "挪威语" },
  sv: { name: "Svenska", sub: "瑞典语" },
  fi: { name: "Suomi", sub: "芬兰语" },
  nl: { name: "Nederlands", sub: "荷兰语" },
  pl: { name: "Polski", sub: "波兰语" },
  cs: { name: "Čeština", sub: "捷克语" },
  ru: { name: "Русский", sub: "俄语" },
  hu: { name: "Magyar", sub: "匈牙利语" },
  el: { name: "Ελληνικά", sub: "希腊语" },
  la: { name: "Latina", sub: "拉丁语" },
};

export const LANGUAGE_CATEGORY_PREFIX = Object.fromEntries(
  Object.entries(LANGUAGE_LABELS).map(([code, label]) => [code, label.name]),
);

const LANGUAGE_ALIASES = {
  中文: "zh",
  chinese: "zh",
  Chinese: "zh",
  英文: "en",
  english: "en",
  English: "en",
  日文: "ja",
  japanese: "ja",
  Japanese: "ja",
  韩文: "ko",
  韓文: "ko",
  korean: "ko",
  Korean: "ko",
  梵文: "sa",
  sanskrit: "sa",
  Sanskrit: "sa",
  阿拉伯语: "ar",
  arabic: "ar",
  Arabic: "ar",
  波斯语: "fa",
  farsi: "fa",
  Farsi: "fa",
  persian: "fa",
  Persian: "fa",
};

export function languageCodeFor(value) {
  const raw =
    typeof value === "object" && value
      ? String(value.lang || "").trim()
      : String(value || "").trim();
  if (!raw) return "unknown";
  return LANGUAGE_ALIASES[raw] || LANGUAGE_ALIASES[raw.toLowerCase()] || raw;
}

export function languageLabel(code) {
  return LANGUAGE_LABELS[code] || { name: code || "未知语言", sub: code || "unknown" };
}

export function languageCategoryPrefix(code) {
  return LANGUAGE_CATEGORY_PREFIX[code] || "";
}

export function compareLanguageCodes(a, b) {
  const ai = LANGUAGE_ORDER.indexOf(a);
  const bi = LANGUAGE_ORDER.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return String(a || "").localeCompare(String(b || ""));
}
