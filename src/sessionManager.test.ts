import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Create temp dir once for the entire test file, before mock.module runs
const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-sm-test-"));

// Mock paths module — values are fixed for the file's lifetime
mock.module("./paths", () => ({
  HEARTBEAT_DIR: tempDir,
  SESSIONS_FILE: join(tempDir, "sessions.json"),
}));

import {
  DEFAULT_SESSION_KEY,
  createSession,
  getSession,
  removeSession,
  incrementTurn,
  markCompactWarned,
  listSessions,
  peekSessionEntry,
  peekDefaultSession,
  resetDefaultSession,
  backupDefaultSession,
  _resetCache,
} from "./sessionManager";

/** Remove all files in tempDir to isolate tests. */
async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

describe("sessionManager", () => {
  beforeEach(async () => {
    await cleanTempDir();
    _resetCache();
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Core CRUD
  // ---------------------------------------------------------------------------

  describe("createSession / getSession", () => {
    it("creates and retrieves a session", async () => {
      await createSession("chan-1", "uuid-abc");
      const session = await getSession("chan-1");
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe("uuid-abc");
      expect(session!.turnCount).toBe(0);
      expect(session!.compactWarned).toBe(false);
    });

    it("returns null for non-existent key", async () => {
      expect(await getSession("missing")).toBeNull();
    });

    it("persists to disk", async () => {
      await createSession("chan-1", "uuid-abc");
      const raw = JSON.parse(await readFile(join(tempDir, "sessions.json"), "utf-8"));
      expect(raw.sessions["chan-1"].sessionId).toBe("uuid-abc");
    });

    it("updates lastUsedAt on incrementTurn", async () => {
      await createSession("chan-1", "uuid-abc");
      const entry1 = await peekSessionEntry("chan-1");
      const before = entry1!.lastUsedAt;

      await new Promise((r) => setTimeout(r, 10));
      await incrementTurn("chan-1");

      const entry2 = await peekSessionEntry("chan-1");
      expect(entry2!.lastUsedAt).not.toBe(before);
    });

    it("does not update lastUsedAt on getSession", async () => {
      await createSession("chan-1", "uuid-abc");
      const entry1 = await peekSessionEntry("chan-1");
      const before = entry1!.lastUsedAt;

      await new Promise((r) => setTimeout(r, 10));
      await getSession("chan-1");

      const entry2 = await peekSessionEntry("chan-1");
      expect(entry2!.lastUsedAt).toBe(before);
    });
  });

  describe("removeSession", () => {
    it("removes an existing session", async () => {
      await createSession("chan-1", "uuid-abc");
      await removeSession("chan-1");
      expect(await getSession("chan-1")).toBeNull();
    });

    it("is a no-op for non-existent key", async () => {
      await removeSession("missing"); // should not throw
    });
  });

  describe("incrementTurn", () => {
    it("increments and returns the new count", async () => {
      await createSession("chan-1", "uuid-abc");
      expect(await incrementTurn("chan-1")).toBe(1);
      expect(await incrementTurn("chan-1")).toBe(2);
      expect(await incrementTurn("chan-1")).toBe(3);
    });

    it("returns 0 for non-existent key", async () => {
      expect(await incrementTurn("missing")).toBe(0);
    });
  });

  describe("markCompactWarned", () => {
    it("sets compactWarned to true", async () => {
      await createSession("chan-1", "uuid-abc");
      await markCompactWarned("chan-1");
      const session = await getSession("chan-1");
      expect(session!.compactWarned).toBe(true);
    });

    it("is a no-op for non-existent key", async () => {
      await markCompactWarned("missing"); // should not throw
    });
  });

  describe("listSessions", () => {
    it("returns all sessions", async () => {
      await createSession("a", "uuid-a");
      await createSession("b", "uuid-b");
      const sessions = await listSessions();
      expect(sessions).toHaveLength(2);
      const keys = sessions.map((s) => s.key).sort();
      expect(keys).toEqual(["a", "b"]);
    });

    it("returns empty array when no sessions exist", async () => {
      expect(await listSessions()).toEqual([]);
    });
  });

  describe("peekSessionEntry", () => {
    it("returns session without updating lastUsedAt", async () => {
      await createSession("chan-1", "uuid-abc");
      const entry = await peekSessionEntry("chan-1");
      const lastUsed = entry!.lastUsedAt;

      await new Promise((r) => setTimeout(r, 10));
      const entry2 = await peekSessionEntry("chan-1");
      expect(entry2!.lastUsedAt).toBe(lastUsed);
    });

    it("returns null for non-existent key", async () => {
      expect(await peekSessionEntry("missing")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Legacy migration
  // ---------------------------------------------------------------------------

  describe("legacy threads migration", () => {
    it("migrates threads format to sessions format", async () => {
      const legacyData = {
        threads: {
          "chan-1": {
            sessionId: "uuid-old",
            threadId: "chan-1",
            createdAt: "2025-01-01T00:00:00Z",
            lastUsedAt: "2025-01-01T00:00:00Z",
            turnCount: 5,
            compactWarned: false,
          },
        },
      };
      await writeFile(join(tempDir, "sessions.json"), JSON.stringify(legacyData));
      _resetCache();

      const session = await getSession("chan-1");
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe("uuid-old");
      expect(session!.turnCount).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Default session helpers
  // ---------------------------------------------------------------------------

  describe("peekDefaultSession", () => {
    it("returns the default session", async () => {
      await createSession(DEFAULT_SESSION_KEY, "uuid-default");
      const session = await peekDefaultSession();
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe("uuid-default");
      expect(session!.key).toBe("default");
    });

    it("returns null when no default session exists", async () => {
      expect(await peekDefaultSession()).toBeNull();
    });
  });

  describe("resetDefaultSession", () => {
    it("removes the default session", async () => {
      await createSession(DEFAULT_SESSION_KEY, "uuid-default");
      await resetDefaultSession();
      _resetCache();
      expect(await peekDefaultSession()).toBeNull();
    });

    it("does not throw when no default session exists", async () => {
      await resetDefaultSession(); // should not throw
    });
  });

  describe("backupDefaultSession", () => {
    it("returns null when no default session exists", async () => {
      expect(await backupDefaultSession()).toBeNull();
    });

    it("creates a numbered backup file and removes the session", async () => {
      await createSession(DEFAULT_SESSION_KEY, "uuid-backup");
      const backupName = await backupDefaultSession();

      expect(backupName).toBe("session_1.backup");

      // Verify backup file exists with correct content
      const backupContent = JSON.parse(await readFile(join(tempDir, backupName!), "utf-8"));
      expect(backupContent.sessionId).toBe("uuid-backup");

      // Verify session was removed
      _resetCache();
      expect(await peekDefaultSession()).toBeNull();
    });

    it("increments backup index based on existing backups", async () => {
      // Create fake existing backups
      await writeFile(join(tempDir, "session_1.backup"), "{}");
      await writeFile(join(tempDir, "session_3.backup"), "{}");

      await createSession(DEFAULT_SESSION_KEY, "uuid-backup");
      const backupName = await backupDefaultSession();

      expect(backupName).toBe("session_4.backup");
    });

    it("does not affect other sessions", async () => {
      await createSession(DEFAULT_SESSION_KEY, "uuid-default");
      await createSession("discord-chan-1", "uuid-discord");

      await backupDefaultSession();
      _resetCache();

      const discord = await peekSessionEntry("discord-chan-1");
      expect(discord).not.toBeNull();
      expect(discord!.sessionId).toBe("uuid-discord");
    });
  });
});
