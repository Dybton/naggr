/**
 * Persona loader.
 *
 * Reads `SOUL.md` once and caches it in memory so we don't touch disk
 * on every LLM turn. If the file is missing (fresh host, accidental
 * delete), returns a minimal fallback string instead of crashing — the
 * bot should stay usable even when its persona file isn't on disk yet.
 */

import { existsSync, readFileSync } from "fs";
import { SOUL_PATH } from "../paths.js";

/** Short stand-in used when `SOUL.md` is absent. Keeps the bot polite and brief. */
const FALLBACK_SOUL = `# Naggr

You are Naggr — a warm, wry health coach on Telegram. Keep messages to
1-3 sentences, use autonomy-preserving language, and never guilt-trip.`;

let cachedSoul: string | null = null;

/**
 * Returns the persona text used in every LLM system prompt.
 *
 * On the first call: checks disk for `SOUL.md`. If present, reads and
 * caches it. If missing, logs a warning and caches the fallback so the
 * bot keeps running. Later calls return the cached value unchanged.
 */
export const loadSoul = (): string => {
  if (cachedSoul !== null) return cachedSoul;

  if (!existsSync(SOUL_PATH)) {
    console.warn(`[persona] SOUL.md not found at ${SOUL_PATH}; using fallback persona`);
    cachedSoul = FALLBACK_SOUL;
    return cachedSoul;
  }

  cachedSoul = readFileSync(SOUL_PATH, "utf-8");
  return cachedSoul;
};
