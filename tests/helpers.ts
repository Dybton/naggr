import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(__dirname, "..");

/** Save the current content of a project-root file and return a restore function */
export function backupFile(relativePath: string): () => void {
  const fullPath = join(PROJECT_ROOT, relativePath);
  const existed = existsSync(fullPath);
  const original = existed ? readFileSync(fullPath, "utf-8") : null;

  return () => {
    if (original !== null) {
      writeFileSync(fullPath, original, "utf-8");
    } else if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  };
}

/** Write a fixture file to a project-root path */
export function writeFixture(relativePath: string, content: string): void {
  const fullPath = join(PROJECT_ROOT, relativePath);
  const dir = join(fullPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

/** Read a test fixture from tests/fixtures/ */
export function readFixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

/** Read a project-root file */
export function readProjectFile(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), "utf-8");
}

/** Delete a project-root file if it exists */
export function removeProjectFile(relativePath: string): void {
  const fullPath = join(PROJECT_ROOT, relativePath);
  if (existsSync(fullPath)) unlinkSync(fullPath);
}

/** Generate a unique test date to avoid collisions with real data */
let testDateCounter = 0;
export function testDate(): string {
  testDateCounter++;
  return `9999-01-${String(testDateCounter).padStart(2, "0")}`;
}
