/**
 * Shared filesystem paths used by the rest of the app.
 *
 * Defined in one place so moving `src/` or adding nested modules can't
 * cause two files to drift to different guesses for "where is the repo
 * root." Everything that needs to read or write a project file imports
 * from here.
 */

import { join } from "path";

/** Absolute path to the repo root (one level above `src/`). */
export const DATA_DIR = join(__dirname, "..");

/** Directory that holds `YYYY-MM-DD.md` daily logs. */
export const DAILY_DIR = join(DATA_DIR, "daily");

/** Path to the free-form protocol file the LLM reads each turn. */
export const PROTOCOL_PATH = join(DATA_DIR, "protocol.md");

/** Path to the persona file loaded once at boot. */
export const SOUL_PATH = join(DATA_DIR, "SOUL.md");
