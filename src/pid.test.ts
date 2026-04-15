import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-pid-test-"));
const PID_FILE = join(tempDir, "daemon.pid");

mock.module("./paths", () => ({
  PID_FILE,
}));

import { getPidPath, checkExistingDaemon, writePidFile, cleanupPidFile } from "./pid";

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("getPidPath", () => {
  it("returns the PID file path", () => {
    expect(getPidPath()).toBe(PID_FILE);
  });
});

describe("writePidFile", () => {
  beforeEach(cleanTempDir);

  it("writes the current process PID", async () => {
    await writePidFile();
    const content = await readFile(PID_FILE, "utf-8");
    expect(content.trim()).toBe(String(process.pid));
  });
});

describe("cleanupPidFile", () => {
  beforeEach(cleanTempDir);

  it("removes the PID file", async () => {
    await writeFile(PID_FILE, "12345\n");
    await cleanupPidFile();
    const exists = await Bun.file(PID_FILE).exists();
    expect(exists).toBe(false);
  });

  it("does not throw if file already gone", async () => {
    await expect(cleanupPidFile()).resolves.toBeUndefined();
  });
});

describe("checkExistingDaemon", () => {
  beforeEach(cleanTempDir);

  it("returns null when no PID file exists", async () => {
    expect(await checkExistingDaemon()).toBeNull();
  });

  it("returns PID when the process is alive", async () => {
    await writeFile(PID_FILE, String(process.pid) + "\n");
    expect(await checkExistingDaemon()).toBe(process.pid);
  });

  it("returns null and cleans up stale PID file", async () => {
    // Use a PID that's almost certainly not running
    await writeFile(PID_FILE, "999999999\n");
    expect(await checkExistingDaemon()).toBeNull();
    const exists = await Bun.file(PID_FILE).exists();
    expect(exists).toBe(false);
  });

  it("returns null for invalid PID content", async () => {
    await writeFile(PID_FILE, "not-a-number\n");
    expect(await checkExistingDaemon()).toBeNull();
  });
});
