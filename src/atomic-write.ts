import { open, rename, unlink } from "fs/promises";

/**
 * Write data to `filePath` atomically: write to a sibling temp file, fsync, then
 * rename over the destination. Same-filesystem rename is atomic on POSIX, so a
 * crash mid-write never leaves the destination half-written or empty — readers
 * either see the previous contents or the new contents, never garbage.
 *
 * The temp file lives in the same directory as the destination so the rename
 * stays on the same filesystem. On error the temp file is best-effort removed.
 */
export async function atomicWriteFile(filePath: string, data: string | Uint8Array): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tmpPath, "w");
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmpPath, filePath);
  } catch (err) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    try { await unlink(tmpPath); } catch {}
    throw err;
  }
}
