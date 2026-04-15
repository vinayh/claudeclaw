import { describe, it, expect, mock } from "bun:test";
import {
  checkAuthorization,
  isBuiltInCommand,
  extractCommand,
  downloadAndTranscribe,
  logIncomingMessage,
  type PlatformAdapter,
  type AttachmentSources,
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
    debug: false,
    sendMessage: async () => {},
    sendTyping: async () => {},
    sendReaction: async () => {},
    debugLog: () => {},
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
// downloadAndTranscribe
// ---------------------------------------------------------------------------

describe("downloadAndTranscribe", () => {
  it("returns nulls when no attachments", async () => {
    const sources: AttachmentSources = {
      hasImage: false,
      hasVoice: false,
      hasDocument: false,
      downloadImage: async () => null,
      downloadVoice: async () => null,
      downloadDocument: async () => null,
    };
    const result = await downloadAndTranscribe(sources, mockAdapter());
    expect(result.imagePath).toBeNull();
    expect(result.voicePath).toBeNull();
    expect(result.voiceTranscript).toBeNull();
    expect(result.documentInfo).toBeNull();
    expect(result.failures).toEqual({});
  });

  it("downloads image successfully", async () => {
    const sources: AttachmentSources = {
      hasImage: true,
      hasVoice: false,
      hasDocument: false,
      downloadImage: async () => "/tmp/img.jpg",
      downloadVoice: async () => null,
      downloadDocument: async () => null,
    };
    const result = await downloadAndTranscribe(sources, mockAdapter());
    expect(result.imagePath).toBe("/tmp/img.jpg");
    expect(result.failures.image).toBeUndefined();
  });

  it("sets image failure on download error", async () => {
    const sources: AttachmentSources = {
      hasImage: true,
      hasVoice: false,
      hasDocument: false,
      downloadImage: async () => { throw new Error("download failed"); },
      downloadVoice: async () => null,
      downloadDocument: async () => null,
    };
    const result = await downloadAndTranscribe(sources, mockAdapter());
    expect(result.imagePath).toBeNull();
    expect(result.failures.image).toBe(true);
  });

  it("sets voice failure when voice download returns null", async () => {
    const sources: AttachmentSources = {
      hasImage: false,
      hasVoice: true,
      hasDocument: false,
      downloadImage: async () => null,
      downloadVoice: async () => null,
      downloadDocument: async () => null,
    };
    const result = await downloadAndTranscribe(sources, mockAdapter());
    expect(result.voicePath).toBeNull();
    expect(result.voiceTranscript).toBeNull();
    expect(result.failures.voice).toBe(true);
  });

  it("downloads document successfully", async () => {
    const docInfo = { localPath: "/tmp/doc.pdf", originalName: "report.pdf" };
    const sources: AttachmentSources = {
      hasImage: false,
      hasVoice: false,
      hasDocument: true,
      downloadImage: async () => null,
      downloadVoice: async () => null,
      downloadDocument: async () => docInfo,
    };
    const result = await downloadAndTranscribe(sources, mockAdapter());
    expect(result.documentInfo).toEqual(docInfo);
    expect(result.failures.document).toBeUndefined();
  });

  it("sets document failure on download error", async () => {
    const sources: AttachmentSources = {
      hasImage: false,
      hasVoice: false,
      hasDocument: true,
      downloadImage: async () => null,
      downloadVoice: async () => null,
      downloadDocument: async () => { throw new Error("doc download failed"); },
    };
    const result = await downloadAndTranscribe(sources, mockAdapter());
    expect(result.documentInfo).toBeNull();
    expect(result.failures.document).toBe(true);
  });

  it("skips download callbacks when has* is false", async () => {
    const downloadImage = mock(async () => "/tmp/img.jpg");
    const downloadVoice = mock(async () => "/tmp/voice.ogg");
    const downloadDocument = mock(async () => ({ localPath: "/tmp/doc.pdf", originalName: "doc.pdf" }));

    const sources: AttachmentSources = {
      hasImage: false,
      hasVoice: false,
      hasDocument: false,
      downloadImage,
      downloadVoice,
      downloadDocument,
    };
    await downloadAndTranscribe(sources, mockAdapter());
    expect(downloadImage).not.toHaveBeenCalled();
    expect(downloadVoice).not.toHaveBeenCalled();
    expect(downloadDocument).not.toHaveBeenCalled();
  });
});
