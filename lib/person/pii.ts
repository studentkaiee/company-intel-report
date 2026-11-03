/** Personal-data guards for the Individual Legal Screen. Safe to import in the browser. */

// NRIC/FIN: S, T, F, G or M, then 7 digits, then a letter. Spaces or dashes in between are tolerated.
const NRIC_FIN = /\b[STFGM][\s-]?\d{7}[\s-]?[A-Z]\b/gi;

export const NRIC_MESSAGE =
  "This looks like an NRIC or FIN number. Please remove it: we don't collect ID numbers.";

export function containsNricLike(value: string): boolean {
  NRIC_FIN.lastIndex = 0;
  return NRIC_FIN.test(value);
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Singapore numbers (8 digits starting 3, 6, 8 or 9, optional +65) and other international numbers written with +.
// Not preceded by a digit or "$", and not part of a longer number such as 61,234,567.89.
const SG_PHONE = /(?<!\d|\d[.,]|\$)(?:\+?65[\s-]?)?[3689]\d{3}[\s-]?\d{4}(?!\d|[.,]\d)/g;
const INTL_PHONE = /\+\d{1,3}[\s-]?(?:\(?\d{1,4}\)?[\s-]?){2,4}\d{2,4}/g;

/** Replaces NRIC/FIN-like values, email addresses and phone numbers in model-written text. */
export function stripPii(text: string): string {
  return text
    .replace(NRIC_FIN, "[ID removed]")
    .replace(EMAIL, "[email removed]")
    .replace(INTL_PHONE, "[phone removed]")
    .replace(SG_PHONE, "[phone removed]");
}

const COMPANY_WORDS =
  /\b(pte|ltd|llp|llc|inc|corp|corporation|company|limited|holdings|group|bhd|plc|gmbh|enterprises?|trading|services|solutions|technologies)\b/i;

/**
 * Returns an error message when `value` doesn't look like a person's name, or null when it does.
 * Letters from any script, spaces and . ' ’ - , are allowed; digits, symbols, URLs and company suffixes are not.
 */
export function personNameProblem(value: string): string | null {
  if (containsNricLike(value)) return NRIC_MESSAGE;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’,-]*$/u.test(value)) {
    return "Names can only contain letters, spaces and . ' - characters.";
  }
  if ((value.match(/[\p{L}]/gu) ?? []).length < 2) return "Please enter a full name.";
  if (COMPANY_WORDS.test(value)) return "This looks like a company name. This check is for individuals.";
  return null;
}
