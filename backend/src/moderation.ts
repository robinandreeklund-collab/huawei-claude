// Content moderation hook (AppGallery compliance R1).
//
// AppGallery requires a filter mechanism for apps that surface AI/user-generated
// content. This is that seam: every assistant text block passes through moderate()
// before it reaches the client. The default is deliberately narrow so it does NOT
// flag normal code or technical discussion — it catches only clearly disallowed
// categories. Swap the body for a real moderation API (e.g. a classifier endpoint)
// when moving to production; the call site does not change.

export interface ModerationResult {
  flagged: boolean;
  reason?: string;
}

// Narrow, high-precision patterns for clearly disallowed content. Intentionally
// conservative — false positives on a coding assistant are worse than a rare miss,
// and Anthropic's own safety layer is the primary defense.
const DISALLOWED: { re: RegExp; reason: string }[] = [
  { re: /\bchild\s*(sexual|abuse|porn)/i, reason: "csam" },
  { re: /\b(build|make|synthesize)\s+(a\s+)?(bomb|explosive|nerve\s+agent)\b/i, reason: "weapons" },
];

export function moderate(text: string): ModerationResult {
  for (const { re, reason } of DISALLOWED) {
    if (re.test(text)) return { flagged: true, reason };
  }
  return { flagged: false };
}

/** Replacement shown to the user when a message is filtered. */
export const FILTERED_NOTICE =
  "[The response was blocked by the content filter and can't be shown.]";
