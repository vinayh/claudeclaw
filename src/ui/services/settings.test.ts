import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-settings-test-"));
const SETTINGS_FILE = join(tempDir, "settings.json");

mock.module("../constants", () => ({
  SETTINGS_FILE,
}));

import { readHeartbeatSettings, updateHeartbeatSettings } from "./settings";

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

async function writeSettings(data: Record<string, unknown>) {
  await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readHeartbeatSettings", () => {
  beforeEach(cleanTempDir);

  it("parses valid heartbeat settings", async () => {
    await writeSettings({ heartbeat: { enabled: true, interval: 30, prompt: "check in" } });
    const result = await readHeartbeatSettings();
    expect(result.enabled).toBe(true);
    expect(result.interval).toBe(30);
    expect(result.prompt).toBe("check in");
  });

  it("returns defaults when heartbeat key is missing", async () => {
    await writeSettings({});
    const result = await readHeartbeatSettings();
    expect(result.enabled).toBe(false);
    expect(result.interval).toBe(15);
    expect(result.prompt).toBe("");
    expect(result.excludeWindows).toEqual([]);
  });

  it("defaults interval to 15 when set to 0", async () => {
    await writeSettings({ heartbeat: { interval: 0 } });
    const result = await readHeartbeatSettings();
    expect(result.interval).toBe(15);
  });
});

describe("updateHeartbeatSettings", () => {
  beforeEach(cleanTempDir);

  it("toggles enabled", async () => {
    await writeSettings({ heartbeat: { enabled: false, interval: 15 } });
    const result = await updateHeartbeatSettings({ enabled: true });
    expect(result.enabled).toBe(true);
  });

  it("clamps interval to 1-1440", async () => {
    await writeSettings({ heartbeat: {} });
    const result = await updateHeartbeatSettings({ interval: 5000 });
    expect(result.interval).toBe(1440);
  });

  it("clamps interval minimum to 1", async () => {
    await writeSettings({ heartbeat: {} });
    const result = await updateHeartbeatSettings({ interval: 0 });
    // 0 rounds to 0, clamped to max(1, 0) = 1
    expect(result.interval).toBeGreaterThanOrEqual(1);
  });

  it("updates prompt", async () => {
    await writeSettings({ heartbeat: { prompt: "old" } });
    const result = await updateHeartbeatSettings({ prompt: "new prompt" });
    expect(result.prompt).toBe("new prompt");
  });

  it("preserves other settings keys", async () => {
    await writeSettings({ heartbeat: { enabled: true }, otherKey: "keep" });
    await updateHeartbeatSettings({ interval: 20 });
    const raw = JSON.parse(await readFile(SETTINGS_FILE, "utf-8"));
    expect(raw.otherKey).toBe("keep");
  });

  it("updates excludeWindows", async () => {
    await writeSettings({ heartbeat: {} });
    const windows = [{ days: [1, 2], start: "09:00", end: "17:00" }];
    const result = await updateHeartbeatSettings({ excludeWindows: windows });
    expect(result.excludeWindows).toEqual(windows);
  });
});
