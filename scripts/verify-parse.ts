/**
 * Smoke test for `parseDailyDate`.
 *
 * `parseDailyDate` is the single barrier between an LLM-produced tool
 * input and a real filesystem path inside `daily/`. A regression could
 * let a crafted name (e.g. `daily/../etc/passwd.md`) slip through.
 * This script exercises the table of edge cases that regex-based
 * implementations historically got wrong, and exits non-zero on any
 * mismatch.
 *
 * Run: `npm run verify`
 */

import { parseDailyDate } from "../src/daily-path.js";

interface Case {
  readonly input: string;
  readonly expected: string | null;
  readonly note: string;
}

const CASES: readonly Case[] = [
  { input: "daily/2026-04-18.md", expected: "2026-04-18", note: "valid date" },
  { input: "daily/2026-12-31.md", expected: "2026-12-31", note: "year-end boundary" },
  { input: "daily/2099-01-01.md", expected: "2099-01-01", note: "far-future valid" },

  // Rejections
  { input: "daily/2026-4-18.md", expected: null, note: "single-digit month" },
  { input: "daily/2026-04-8.md", expected: null, note: "single-digit day" },
  { input: "daily/2026-02-30.md", expected: null, note: "impossible date — Feb 30" },
  { input: "daily/2026-13-01.md", expected: null, note: "month 13" },
  { input: "daily/2026-00-01.md", expected: null, note: "month 0" },
  { input: "daily/2026-04-00.md", expected: null, note: "day 0" },
  { input: "daily/April 18 2026.md", expected: null, note: "prose date" },
  { input: "daily/2026-04-18T12:00.md", expected: null, note: "trailing timestamp" },
  { input: "daily/2026-04-18.txt", expected: null, note: "wrong extension" },
  { input: "notdaily/2026-04-18.md", expected: null, note: "wrong prefix" },
  { input: "protocol.md", expected: null, note: "not a daily file" },
  { input: "daily/../protocol.md", expected: null, note: "path traversal attempt" },
  { input: "daily/.md", expected: null, note: "empty stem" },
  { input: "daily/-04-18.md", expected: null, note: "missing year" },

  // Year floor (MIN_YEAR = 2020)
  { input: "daily/0001-01-01.md", expected: null, note: "pre-MIN_YEAR (year 0001)" },
  { input: "daily/1999-12-31.md", expected: null, note: "pre-MIN_YEAR (year 1999)" },
  { input: "daily/2019-12-31.md", expected: null, note: "one year before MIN_YEAR" },
  { input: "daily/2020-01-01.md", expected: "2020-01-01", note: "MIN_YEAR boundary" },
];

let failures = 0;

for (const c of CASES) {
  const got = parseDailyDate(c.input);
  const ok = got === c.expected;
  const mark = ok ? "OK  " : "FAIL";
  console.log(
    `${mark} parseDailyDate(${JSON.stringify(c.input).padEnd(30)}) = ${JSON.stringify(got).padEnd(14)} (expected ${JSON.stringify(c.expected).padEnd(14)}) — ${c.note}`
  );
  if (!ok) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} of ${CASES.length} cases failed`);
  process.exit(1);
}

console.log(`\nAll ${CASES.length} cases passed.`);
