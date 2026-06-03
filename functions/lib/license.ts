export type PublishableLicense = "CC0-1.0" | "PUBLIC-DOMAIN";

const ACCEPTED = new Set<PublishableLicense>(["CC0-1.0", "PUBLIC-DOMAIN"]);

function restrictiveSignals(raw?: string | null): string[] {
  const text = raw || "";
  const rules: Array<[string, RegExp]> = [
    [
      "CC-BY-NC",
      /\bcc[-\s]?by[-\s]?nc\b|attribution[-\s]?noncommercial|non[-\s]?commercial|\bNC\b/i,
    ],
    ["CC-BY-SA", /\bcc[-\s]?by[-\s]?sa\b|attribution[-\s]?sharealike/i],
    ["CC-BY-ND", /\bcc[-\s]?by[-\s]?nd\b|attribution[-\s]?noderivatives/i],
    ["CC-BY", /\bcc[-\s]?by\b|creative commons attribution/i],
    ["COPYRIGHTED", /\bcopyrighted\b|copyright\s*\(c\)|©/i],
    ["ALL-RIGHTS-RESERVED", /all rights reserved/i],
  ];
  return rules.filter(([, re]) => re.test(text)).map(([id]) => id);
}

export function normalizePublishableLicense(raw?: string | null): PublishableLicense | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const compact = text.toLowerCase().replace(/[_\s]+/g, "-");
  if (/\bcc0\b|\bcc0[-\s]?1\.0\b|creative-commons-zero/.test(compact)) return "CC0-1.0";
  if (/public[-\s]?domain|public-domain-mark|project-gutenberg|wikisource/.test(compact))
    return "PUBLIC-DOMAIN";
  return null;
}

export function validatePublishableLicense(
  raw?: string | null,
): { ok: true; license: PublishableLicense } | { ok: false; reason: string } {
  const signals = restrictiveSignals(raw);
  if (signals.length)
    return {
      ok: false,
      reason: `license contains restrictive signal: ${[...new Set(signals)].join(", ")}`,
    };
  const license = normalizePublishableLicense(raw);
  if (license && ACCEPTED.has(license)) return { ok: true, license };
  return { ok: false, reason: "license must be CC0-1.0 or PUBLIC-DOMAIN" };
}

export function assertPublishableLicense(raw?: string | null): PublishableLicense {
  const result = validatePublishableLicense(raw);
  if (result.ok) return result.license;
  throw new Error(`不可上架：${result.reason}`);
}
