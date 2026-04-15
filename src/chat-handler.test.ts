import { describe, it, expect } from "bun:test";
import {
  checkAuthorization,
  isBuiltInCommand,
  extractCommand,
  buildPrompt,
  appendMediaFailures,
  logIncomingMessage,
  type PlatformAdapter,
  type ChatContext,
} from "./chat-handler";
import { ChatPlatform } from "./chat-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAdapter(overrides?: Partial<PlatformAdapter>): PlatformAdapter {
  return {
    platform: ChatPlatform.Discord,
    maxMessageLength: 2000,
    typingIntervalMs: 8000,
    sendMessage: async () => {},
    sendTyping: async () => {},
    sendReaction: async () => {},
    debugLog: () => {},
    ...overrides,
  };
}

function mockContext(overrides?: Partial<ChatContext>): ChatContext {
  return {
    chatId: "chan-1",
    userId: "user-1",
    username: "testuser",
    messageId: "msg-1",
    isDM: true,
    rawContent: "hello world",
    imagePath: null,
    voicePath: null,
    voiceTranscript: null,
    documentInfo: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkAuthorization
// ---------------------------------------------------------------------------

describe("checkAuthorization", () => {
  it("returns true when allowedIds is empty (all users allowed)", () => {
    expect(checkAuthorization("any-user", [])).toBe(true);
  });

  it("returns true when userId is in allowedIds", () => {
    expect(checkAuthorization("user-1", ["user-1", "user-2"])).toBe(true);
  });

  it("returns false when userId is not in allowedIds", () => {
    expect(checkAuthorization("user-3", ["user-1", "user-2"])).toBe(false);
  });

  it("returns false when userId is undefined", () => {
    expect(checkAuthorization(undefined, [])).toBe(false);
  });

  it("returns false when userId is undefined with non-empty allowedIds", () => {
    expect(checkAuthorization(undefined, ["user-1"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBuiltInCommand
// ---------------------------------------------------------------------------

describe("isBuiltInCommand", () => {
  it("recognizes /start", () => expect(isBuiltInCommand("/start")).toBe(true));
  it("recognizes /reset", () => expect(isBuiltInCommand("/reset")).toBe(true));
  it("recognizes /compact", () => expect(isBuiltInCommand("/compact")).toBe(true));
  it("recognizes /status", () => expect(isBuiltInCommand("/status")).toBe(true));
  it("recognizes /context", () => expect(isBuiltInCommand("/context")).toBe(true));

  it("rejects unknown commands", () => {
    expect(isBuiltInCommand("/deploy")).toBe(false);
    expect(isBuiltInCommand("/help")).toBe(false);
  });

  it("rejects null", () => {
    expect(isBuiltInCommand(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractCommand
// ---------------------------------------------------------------------------

describe("extractCommand", () => {
  it("extracts a simple command", () => {
    expect(extractCommand("/deploy prod")).toBe("/deploy");
  });

  it("extracts command without arguments", () => {
    expect(extractCommand("/start")).toBe("/start");
  });

  it("returns null for non-command text", () => {
    expect(extractCommand("hello world")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(extractCommand("")).toBeNull();
  });

  it("strips @botname suffix (Telegram format)", () => {
    expect(extractCommand("/start@mybot")).toBe("/start");
  });

  it("lowercases commands", () => {
    expect(extractCommand("/Deploy PROD")).toBe("/deploy");
  });

  it("handles leading whitespace", () => {
    expect(extractCommand("  /start")).toBe("/start");
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  it("builds a basic Discord prompt", () => {
    const adapter = mockAdapter({ platform: ChatPlatform.Discord });
    const ctx = mockContext({ rawContent: "hello" });
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).toContain("[Discord from testuser]");
    expect(result).toContain("Message: hello");
  });

  it("builds a basic Telegram prompt", () => {
    const adapter = mockAdapter({ platform: ChatPlatform.Telegram });
    const ctx = mockContext({ rawContent: "hello" });
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).toContain("[Telegram from testuser]");
  });

  it("includes thread ID when present", () => {
    const adapter = mockAdapter();
    const ctx = mockContext({ threadId: "thread-123" });
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).toContain("[thread:thread-123]");
  });

  it("omits thread ID when absent", () => {
    const adapter = mockAdapter();
    const ctx = mockContext();
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).not.toContain("[thread:");
  });

  it("includes skill context with command-name tag", () => {
    const adapter = mockAdapter();
    const ctx = mockContext({ rawContent: "/deploy prod" });
    const result = buildPrompt(adapter, ctx, "SKILL CONTENT HERE", "/deploy");
    expect(result).toContain("<command-name>/deploy</command-name>");
    expect(result).toContain("SKILL CONTENT HERE");
    expect(result).toContain("User arguments: prod");
    expect(result).not.toContain("Message:");
  });

  it("includes skill context without args when none given", () => {
    const adapter = mockAdapter();
    const ctx = mockContext({ rawContent: "/deploy" });
    const result = buildPrompt(adapter, ctx, "SKILL CONTENT", "/deploy");
    expect(result).not.toContain("User arguments:");
  });

  it("includes image path when present", () => {
    const adapter = mockAdapter();
    const ctx = mockContext({ imagePath: "/tmp/img.jpg" });
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).toContain("Image path: /tmp/img.jpg");
    expect(result).toContain("Inspect this image file");
  });

  it("includes voice transcript when present", () => {
    const adapter = mockAdapter();
    const ctx = mockContext({ voiceTranscript: "hello from voice" });
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).toContain("Voice transcript: hello from voice");
  });

  it("includes document info when present", () => {
    const adapter = mockAdapter();
    const ctx = mockContext({
      documentInfo: { localPath: "/tmp/doc.pdf", originalName: "report.pdf" },
    });
    const result = buildPrompt(adapter, ctx, null, null);
    expect(result).toContain("Document path: /tmp/doc.pdf");
    expect(result).toContain("Original filename: report.pdf");
  });
});

// ---------------------------------------------------------------------------
// appendMediaFailures
// ---------------------------------------------------------------------------

describe("appendMediaFailures", () => {
  it("appends image failure message", () => {
    const result = appendMediaFailures("base prompt", { image: true });
    expect(result).toContain("image, but downloading it failed");
  });

  it("appends voice failure message", () => {
    const result = appendMediaFailures("base prompt", { voice: true });
    expect(result).toContain("voice audio, but it could not be transcribed");
  });

  it("appends document failure message", () => {
    const result = appendMediaFailures("base prompt", { document: true });
    expect(result).toContain("document, but downloading it failed");
  });

  it("appends multiple failures", () => {
    const result = appendMediaFailures("base", { image: true, voice: true, document: true });
    expect(result).toContain("image");
    expect(result).toContain("voice");
    expect(result).toContain("document");
  });

  it("returns base prompt when no failures", () => {
    const result = appendMediaFailures("base prompt", {});
    expect(result).toBe("base prompt");
  });
});
