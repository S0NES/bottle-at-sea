/**
 * Validation rules shared by the browser, the Cloudflare Worker and the local
 * dev server, so the client rejects exactly what the API rejects.
 */

export const MAX_TEXT = 500;
export const MAX_COMMENT = 300;
export const MAX_EMAIL = 254;
export const TINT_COUNT = 5;
export const BOTTLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REPORTS = 3;
export const MAX_REPLIES_PER_BOTTLE = 20;
export const MAX_COMMENTS_SHOWN = 20;
export const RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 } as const;
export const REPORT_RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 } as const;
export const REPLY_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 } as const;
export const RATING_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 } as const;

type FailCode =
  | 'invalid_body'
  | 'invalid_text'
  | 'invalid_tint'
  | 'invalid_email'
  | 'invalid_rating'
  | 'link_not_allowed'
  | 'language_not_allowed';

export type Fail = { ok: false; code: FailCode; error: string };
export type Validation = { ok: true; text: string; tint: number; email: string | null } | Fail;
export type ReplyValidation = { ok: true; text: string } | Fail;
export type RatingValidation = { ok: true; value: 1 | -1; comment: string | null } | Fail;

const URL_PATTERNS: readonly RegExp[] = [
  /\b(?:https?|ftp):\/\//i,
  /\bwww\s*\./i,
  /\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|app|dev|xyz|info|biz|ru|cn|tk|gg|to|ai|link|click|site|online|shop|store|top|club|vip)\b(?!\w)/i,
  /\b[a-z0-9-]+\.[a-z]{2,}\/\S*/i,
];

const BANNED_STEMS = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'pussy', 'slut', 'whore',
  'nigger', 'nigga', 'faggot', 'retard', 'twat', 'wanker', 'prick',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function squash(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

const BANNED_PATTERNS: readonly RegExp[] = BANNED_STEMS.map(
  (w) => new RegExp(`^(?:mother|bull|dumb)?${squash(w)}(?:s|es|ed|er|ers|ing|in|y|ie|ish|head|hole|face)?$`),
);

function normalizeForScan(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c);
}

export function containsLink(text: string): boolean {
  return URL_PATTERNS.some((re) => re.test(text));
}

export function containsBannedLanguage(text: string): boolean {
  const tokens = normalizeForScan(text).split(/[^a-z]+/).filter(Boolean);
  return tokens.some((tok) => {
    const t = squash(tok);
    return BANNED_PATTERNS.some((re) => re.test(t));
  });
}

export function moderate(input: unknown, max: number, what: string): { ok: true; text: string } | Fail {
  if (typeof input !== 'string') return { ok: false, code: 'invalid_text', error: `The ${what} must be text.` };
  const trimmed = input.trim();
  if (trimmed.length < 1) return { ok: false, code: 'invalid_text', error: `Write a few words first.` };
  if ([...trimmed].length > max) return { ok: false, code: 'invalid_text', error: `The ${what} can be at most ${max} characters.` };
  if (containsLink(trimmed)) return { ok: false, code: 'link_not_allowed', error: 'Links can’t travel by bottle. Keep it to words.' };
  if (containsBannedLanguage(trimmed)) return { ok: false, code: 'language_not_allowed', error: 'Some of those words can’t be sent. Please soften the message.' };
  return { ok: true, text: trimmed };
}

const EMAIL_RE = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\.]{2,}$/;

export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  if (e.length > MAX_EMAIL || !EMAIL_RE.test(e) || e.includes('..')) return null;
  return e;
}

export function validateBottle(input: unknown): Validation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'invalid_body', error: 'Send a JSON object with "text" and "tint".' };
  }
  const { text, tint, email } = input as Record<string, unknown>;
  const t = moderate(text, MAX_TEXT, 'message');
  if (!t.ok) return t;
  if (typeof tint !== 'number' || !Number.isInteger(tint) || tint < 0 || tint >= TINT_COUNT) {
    return { ok: false, code: 'invalid_tint', error: `The glass tint must be a whole number from 0 to ${TINT_COUNT - 1}.` };
  }
  let cleanEmail: string | null = null;
  if (email !== undefined && email !== null && email !== '') {
    cleanEmail = typeof email === 'string' ? normalizeEmail(email) : null;
    if (!cleanEmail) return { ok: false, code: 'invalid_email', error: 'That email address doesn’t look right.' };
  }
  return { ok: true, text: t.text, tint, email: cleanEmail };
}

export function validateReply(input: unknown): ReplyValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'invalid_body', error: 'Send a JSON object with "text".' };
  }
  const t = moderate((input as Record<string, unknown>).text, MAX_TEXT, 'reply');
  return t.ok ? { ok: true, text: t.text } : t;
}

export function validateRating(input: unknown): RatingValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'invalid_body', error: 'Send a JSON object with "value".' };
  }
  const { value, comment } = input as Record<string, unknown>;
  if (value !== 1 && value !== -1) {
    return { ok: false, code: 'invalid_rating', error: 'The rating must be 1 (thumbs up) or -1 (thumbs down).' };
  }
  if (comment === undefined || comment === null || (typeof comment === 'string' && comment.trim() === '')) {
    return { ok: true, value, comment: null };
  }
  const c = moderate(comment, MAX_COMMENT, 'note');
  return c.ok ? { ok: true, value, comment: c.text } : c;
}
