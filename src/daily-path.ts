/**
 * Parses and validates `daily/YYYY-MM-DD.md` tool-call names without regex.
 *
 * This file is the single gate between an LLM-produced filename string
 * and a real filesystem path inside `daily/`. A regression here could
 * let a crafted tool call reach outside `DAILY_DIR`, so we prefer an
 * explicit step-by-step validator and test it with
 * `scripts/verify-parse.ts`.
 */

/**
 * Lowest year accepted. Anything older is almost certainly a model
 * hallucination — naggr didn't exist before 2026 and we never want to
 * write to `daily/0001-01-01.md`.
 */
const MIN_YEAR = 2020;

/** True when every character of `s` is an ASCII digit '0'..'9'. */
const isDigits = (s: string): boolean => {
  for (const ch of s) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
};

/**
 * Validates that `name` looks like `daily/YYYY-MM-DD.md` and that the
 * date is a real calendar date, without using a regex. Returns the
 * `YYYY-MM-DD` stem on success or `null` on any rejection.
 *
 * Steps:
 *   1. Must start with `daily/` and end with `.md`.
 *   2. The middle segment splits on `-` into exactly 3 parts of lengths 4/2/2.
 *   3. Each part contains only digits.
 *   4. Year must be >= MIN_YEAR (guards against `0001-01-01.md` etc.).
 *   5. The date must round-trip through a UTC Date — this rejects
 *      non-existent dates like `2026-02-30` that Date silently normalises.
 */
export const parseDailyDate = (name: string): string | null => {
  const prefix = "daily/";
  const suffix = ".md";
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return null;

  const stem = name.slice(prefix.length, name.length - suffix.length);
  const parts = stem.split("-");
  if (parts.length !== 3) return null;

  const [y, m, d] = parts;
  if (y.length !== 4 || m.length !== 2 || d.length !== 2) return null;
  if (!isDigits(y) || !isDigits(m) || !isDigits(d)) return null;

  if (Number(y) < MIN_YEAR) return null;

  const asDate = new Date(`${stem}T00:00:00Z`);
  if (isNaN(asDate.getTime())) return null;
  if (asDate.toISOString().slice(0, 10) !== stem) return null;

  return stem;
};
