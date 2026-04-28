import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdtemp, rm, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteFile } from "./atomic-write";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-atomic-test-"));

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

describe("atomicWriteFile", () => {
  beforeEach(cleanTempDir);
  afterAll(() => rm(tempDir, { recursive: true, force: true }));

  it("writes the file contents", async () => {
    const path = join(tempDir, "out.json");
    await atomicWriteFile(path, '{"hello":"world"}\n');
    expect(await readFile(path, "utf-8")).toBe('{"hello":"world"}\n');
  });

  it("does not leave a temp file behind on success", async () => {
    const path = join(tempDir, "out.json");
    await atomicWriteFile(path, "ok");
    const files = await readdir(tempDir);
    expect(files).toEqual(["out.json"]);
  });

  it("replaces an existing file in place", async () => {
    const path = join(tempDir, "out.json");
    await writeFile(path, "old contents", "utf-8");
    await atomicWriteFile(path, "new contents");
    expect(await readFile(path, "utf-8")).toBe("new contents");
    const files = await readdir(tempDir);
    expect(files).toEqual(["out.json"]);
  });

  it("cleans up the temp file when the destination directory is missing", async () => {
    const path = join(tempDir, "no-such-dir", "out.json");
    await expect(atomicWriteFile(path, "data")).rejects.toThrow();
    // The bogus parent dir should not exist, so nothing to assert there;
    // confirm we didn't pollute the real temp dir.
    const files = await readdir(tempDir);
    expect(files).toEqual([]);
  });
});
