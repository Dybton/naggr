/**
 * Persona loader.
 * Reads SOUL.md once and caches it in memory so it doesn't
 * get re-read from disk on every LLM turn.
 */

import { readFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(__dirname, "..", "..");

let cachedSoul: string | null = null;

/** Reads SOUL.md from disk on first call, then returns the cached string on subsequent calls. */
export const loadSoul = (): string => {
  if (cachedSoul) return cachedSoul;
  cachedSoul = readFileSync(join(DATA_DIR, "SOUL.md"), "utf-8");
  return cachedSoul;
};
