import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-state-test-"));
const STATE_FILE = join(tempDir, "state.json");

mock.module("./paths", () => ({
  STATE_FILE,
}));

import { writeState, type StateData } from "./statusline";

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("writeState", () => {
  beforeEach(cleanTempDir);

  it("writes valid JSON to the state file", async () => {
    const state: StateData = {
      jobs: [],
      security: "moderate",
      telegram: false,
      discord: false,
      startedAt: Date.now(),
    };
    await writeState(state);
    const raw = await readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.security).toBe("moderate");
    expect(parsed.jobs).toEqual([]);
  });

  it("includes optional fields when provided", async () => {
    const state: StateData = {
      heartbeat: { nextAt: 1234567890 },
      jobs: [{ name: "test-job", nextAt: 9999999 }],
      security: "strict",
      telegram: true,
      discord: false,
      startedAt: 1000,
      web: { enabled: true, host: "0.0.0.0", port: 3000 },
    };
    await writeState(state);
    const raw = await readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.heartbeat.nextAt).toBe(1234567890);
    expect(parsed.web.port).toBe(3000);
    expect(parsed.telegram).toBe(true);
  });
});
