import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share files on disk (AGENTS.md, protocol.md, daily/*.md)
    // so they must not run in parallel
    fileParallelism: false,
  },
});
