import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";
import {
  ChatPlatform,
  getInboxDir,
  extractReactionDirective,
  extractSendFileDirectives,
  buildProgressBar,
  getContextUsage,
  formatContextUsage,
  formatSessionStatus,
} from "./chat-utils";
import type { Session } from "./sessionManager";
import type { Settings } from "./config";

// ---------------------------------------------------------------------------
// extractReactionDirective
// ---------------------------------------------------------------------------

describe("extractReactionDirective", () => {
  it("extracts a single reaction", () => {
    const result = extractReactionDirective("Hello [react:👍] world");
    expect(result.reactionEmoji).toBe("👍");
    expect(result.cleanedText).toBe("Hello  world");
  });

  it("extracts the first reaction when multiple present", () => {
    const result = extractReactionDirective("[react:🎉] text [react:❤️]");
    expect(result.reactionEmoji).toBe("🎉");
    expect(result.cleanedText).toBe("text");
  });

  it("returns null when no directive present", () => {
    const result = extractReactionDirective("plain text");
    expect(result.reactionEmoji).toBeNull();
    expect(result.cleanedText).toBe("plain text");
  });

  it("handles empty input", () => {
    const result = extractReactionDirective("");
    expect(result.reactionEmoji).toBeNull();
    expect(result.cleanedText).toBe("");
  });

  it("handles directive-only text", () => {
    const result = extractReactionDirective("[react:👍]");
    expect(result.reactionEmoji).toBe("👍");
    expect(result.cleanedText).toBe("");
  });

  it("is case-insensitive for the tag", () => {
    const result = extractReactionDirective("[REACT:🔥] hi");
    expect(result.reactionEmoji).toBe("🔥");
    expect(result.cleanedText).toBe("hi");
  });

  it("collapses excessive blank lines left by removal", () => {
    const result = extractReactionDirective("line1\n\n\n\n[react:👍]\n\n\n\nline2");
    expect(result.reactionEmoji).toBe("👍");
    expect(result.cleanedText).toBe("line1\n\nline2");
  });
});

// ---------------------------------------------------------------------------
// extractSendFileDirectives
// ---------------------------------------------------------------------------

describe("extractSendFileDirectives", () => {
  it("extracts a single file path", () => {
    const result = extractSendFileDirectives("Here [send-file:/tmp/report.pdf] you go");
    expect(result.filePaths).toEqual(["/tmp/report.pdf"]);
    expect(result.cleanedText).toBe("Here  you go");
  });

  it("extracts multiple file paths", () => {
    const result = extractSendFileDirectives("[send-file:a.txt] [send-file:b.txt]");
    expect(result.filePaths).toEqual(["a.txt", "b.txt"]);
    expect(result.cleanedText).toBe("");
  });

  it("returns empty array when no directive present", () => {
    const result = extractSendFileDirectives("no files here");
    expect(result.filePaths).toEqual([]);
    expect(result.cleanedText).toBe("no files here");
  });

  it("handles empty input", () => {
    const result = extractSendFileDirectives("");
    expect(result.filePaths).toEqual([]);
    expect(result.cleanedText).toBe("");
  });

  it("is case-insensitive for the tag", () => {
    const result = extractSendFileDirectives("[SEND-FILE:/tmp/x] done");
    expect(result.filePaths).toEqual(["/tmp/x"]);
    expect(result.cleanedText).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// buildProgressBar
// ---------------------------------------------------------------------------

describe("buildProgressBar", () => {
  it("renders 0%", () => {
    const bar = buildProgressBar(0, 100);
    expect(bar).toBe("░".repeat(20));
  });

  it("renders 50%", () => {
    const bar = buildProgressBar(50, 100);
    expect(bar).toBe("█".repeat(10) + "░".repeat(10));
  });

  it("renders 100%", () => {
    const bar = buildProgressBar(100, 100);
    expect(bar).toBe("█".repeat(20));
  });

  it("clamps above 100%", () => {
    const bar = buildProgressBar(200, 100);
    expect(bar).toBe("█".repeat(20));
  });

  it("respects custom width", () => {
    const bar = buildProgressBar(50, 100, 10);
    expect(bar).toBe("█".repeat(5) + "░".repeat(5));
    expect(bar.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getInboxDir
// ---------------------------------------------------------------------------

describe("getInboxDir", () => {
  it("returns platform-specific path under HEARTBEAT_DIR", () => {
    const tg = getInboxDir(ChatPlatform.Telegram);
    expect(tg).toContain("claudeclaw");
    expect(tg).toEndWith("/inbox/telegram");

    const dc = getInboxDir(ChatPlatform.Discord);
    expect(dc).toEndWith("/inbox/discord");
  });

  it("returns different paths for different platforms", () => {
    expect(getInboxDir(ChatPlatform.Telegram)).not.toBe(getInboxDir(ChatPlatform.Discord));
  });
});

// ---------------------------------------------------------------------------
// getContextUsage (filesystem-dependent — uses a real temp dir)
// ---------------------------------------------------------------------------

describe("getContextUsage", () => {
  let tempDir: string;
  let projectSlug: string;
  let projectDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-ctx-test-"));
    projectSlug = process.cwd().replace(/\//g, "-");
    projectDir = join(homedir(), ".claude", "projects", projectSlug);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null for a non-existent session", async () => {
    const result = await getContextUsage("nonexistent-session-id-12345");
    expect(result).toBeNull();
  });

  it("parses valid JSONL and returns usage", async () => {
    const sessionId = `test-ctx-${Date.now()}`;
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

    const lines = [
      JSON.stringify({ message: { usage: { input_tokens: 1000, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 50 } } }),
      JSON.stringify({ message: { usage: { input_tokens: 1500, cache_creation_input_tokens: 250, cache_read_input_tokens: 400, output_tokens: 75 } } }),
    ].join("\n");

    try {
      await writeFile(jsonlPath, lines);
      const result = await getContextUsage(sessionId);

      expect(result).not.toBeNull();
      // lastUsage should be the second line
      expect(result!.input).toBe(1500);
      expect(result!.cacheCreation).toBe(250);
      expect(result!.cacheRead).toBe(400);
      expect(result!.totalContext).toBe(1500 + 250 + 400);
      // totalOutput sums across all lines
      expect(result!.totalOutput).toBe(50 + 75);
      expect(result!.maxContext).toBe(200000);
    } finally {
      await rm(jsonlPath, { force: true });
    }
  });

  it("returns null when file exists but has no usage data", async () => {
    const sessionId = `test-nousage-${Date.now()}`;
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

    try {
      await writeFile(jsonlPath, JSON.stringify({ type: "system", subtype: "init" }) + "\n");
      const result = await getContextUsage(sessionId);
      expect(result).toBeNull();
    } finally {
      await rm(jsonlPath, { force: true });
    }
  });

  it("tolerates malformed JSONL lines", async () => {
    const sessionId = `test-malformed-${Date.now()}`;
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

    const lines = [
      "not json at all",
      JSON.stringify({ message: { usage: { input_tokens: 500, output_tokens: 30 } } }),
      "{broken",
    ].join("\n");

    try {
      await writeFile(jsonlPath, lines);
      const result = await getContextUsage(sessionId);
      expect(result).not.toBeNull();
      expect(result!.input).toBe(500);
      expect(result!.totalOutput).toBe(30);
    } finally {
      await rm(jsonlPath, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// formatContextUsage
// ---------------------------------------------------------------------------

describe("formatContextUsage", () => {
  it("returns stable formatted output", () => {
    const usage = {
      input: 10000,
      cacheCreation: 2000,
      cacheRead: 3000,
      totalContext: 15000,
      totalOutput: 5000,
      maxContext: 200000,
    };
    const lines = formatContextUsage(usage, 12);

    expect(lines[0]).toBe("📐 **Context Window**");
    expect(lines[1]).toContain("%");
    expect(lines[1]).toContain("7.5%");
    expect(lines).toContainEqual(expect.stringContaining("Input:"));
    expect(lines).toContainEqual(expect.stringContaining("Cache creation:"));
    expect(lines).toContainEqual(expect.stringContaining("Cache read:"));
    expect(lines).toContainEqual(expect.stringContaining("Output (cumulative):"));
    expect(lines).toContainEqual("Turns: 12");
  });

  it("includes the progress bar", () => {
    const usage = {
      input: 100000,
      cacheCreation: 0,
      cacheRead: 0,
      totalContext: 100000,
      totalOutput: 0,
      maxContext: 200000,
    };
    const lines = formatContextUsage(usage, 0);
    // 50% → 10 filled blocks
    expect(lines[1]).toContain("█".repeat(10));
    expect(lines[1]).toContain("50.0%");
  });
});

// ---------------------------------------------------------------------------
// formatSessionStatus
// ---------------------------------------------------------------------------

describe("formatSessionStatus", () => {
  const session: Session = {
    sessionId: "abcdef1234567890",
    key: "default",
    createdAt: "2026-01-01T00:00:00Z",
    lastUsedAt: "2026-01-02T12:00:00Z",
    turnCount: 7,
    compactWarned: false,
  };

  const settings = {
    model: "opus",
    security: { level: "moderate" as const },
  } as Settings;

  it("includes all expected fields", () => {
    const lines = formatSessionStatus(session, settings);

    expect(lines[0]).toBe("📊 **Session Status**");
    expect(lines).toContainEqual(expect.stringContaining("abcdef12"));
    expect(lines).toContainEqual("Turns: 7");
    expect(lines).toContainEqual("Model: opus");
    expect(lines).toContainEqual("Security: moderate");
    expect(lines).toContainEqual(expect.stringContaining("2026-01-01"));
    expect(lines).toContainEqual("Compact warned: no");
  });

  it("shows 'default' when model is empty", () => {
    const noModel = { ...settings, model: "" } as Settings;
    const lines = formatSessionStatus(session, noModel);
    expect(lines).toContainEqual("Model: default");
  });

  it("shows 'yes' when compact warned", () => {
    const warned = { ...session, compactWarned: true };
    const lines = formatSessionStatus(warned, settings);
    expect(lines).toContainEqual("Compact warned: yes");
  });
});
