import { describe, it, expect } from "bun:test";
import {
  extractRateLimitMessage,
  sameModelConfig,
  hasModelConfig,
  isNotFoundError,
  buildChildEnv,
  getCleanEnv,
  buildSecurityArgs,
  handleStreamJsonEvent,
  consumeStreamJsonStream,
  type StreamJsonHandlers,
} from "./runner";

describe("extractRateLimitMessage", () => {
  it("detects 'hit your limit' in stdout", () => {
    const result = extractRateLimitMessage("You've hit your limit for today", "");
    expect(result).toBe("You've hit your limit for today");
  });

  it("detects 'out of extra usage' in stderr", () => {
    const result = extractRateLimitMessage("", "out of extra usage");
    expect(result).toBe("out of extra usage");
  });

  it("returns null when no rate limit message", () => {
    expect(extractRateLimitMessage("normal output", "normal error")).toBeNull();
  });

  it("returns null for empty strings", () => {
    expect(extractRateLimitMessage("", "")).toBeNull();
  });
});

describe("sameModelConfig", () => {
  it("returns true for identical configs", () => {
    expect(sameModelConfig(
      { model: "claude-sonnet", api: "key1" },
      { model: "claude-sonnet", api: "key1" },
    )).toBe(true);
  });

  it("is case-insensitive for model", () => {
    expect(sameModelConfig(
      { model: "Claude-Sonnet", api: "key1" },
      { model: "claude-sonnet", api: "key1" },
    )).toBe(true);
  });

  it("returns false for different models", () => {
    expect(sameModelConfig(
      { model: "claude-sonnet", api: "key1" },
      { model: "claude-opus", api: "key1" },
    )).toBe(false);
  });

  it("returns false for different apis", () => {
    expect(sameModelConfig(
      { model: "claude-sonnet", api: "key1" },
      { model: "claude-sonnet", api: "key2" },
    )).toBe(false);
  });
});

describe("hasModelConfig", () => {
  it("returns false for empty model and api", () => {
    expect(hasModelConfig({ model: "", api: "" })).toBe(false);
  });

  it("returns false for whitespace-only values", () => {
    expect(hasModelConfig({ model: "  ", api: "  " })).toBe(false);
  });

  it("returns true when model is set", () => {
    expect(hasModelConfig({ model: "claude-sonnet", api: "" })).toBe(true);
  });

  it("returns true when api is set", () => {
    expect(hasModelConfig({ model: "", api: "sk-123" })).toBe(true);
  });
});

describe("isNotFoundError", () => {
  it("returns true for ENOENT code", () => {
    expect(isNotFoundError({ code: "ENOENT" })).toBe(true);
  });

  it("returns true for 'no such file' message", () => {
    expect(isNotFoundError({ message: "ENOENT: no such file or directory" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isNotFoundError(null)).toBe(false);
  });

  it("returns false for unrelated error", () => {
    expect(isNotFoundError({ code: "EPERM", message: "permission denied" })).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isNotFoundError("string error")).toBe(false);
  });
});

describe("buildChildEnv", () => {
  it("copies base env", () => {
    const base = { PATH: "/usr/bin", HOME: "/home/user" };
    const result = buildChildEnv(base, "", "");
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/user");
  });

  it("sets ANTHROPIC_AUTH_TOKEN when api provided", () => {
    const result = buildChildEnv({}, "claude-sonnet", "my-api-key");
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe("my-api-key");
  });

  it("does not set ANTHROPIC_AUTH_TOKEN when api is empty", () => {
    const result = buildChildEnv({}, "claude-sonnet", "");
    expect(result.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("sets GLM-specific env vars", () => {
    const result = buildChildEnv({}, "glm", "key");
    expect(result.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(result.API_TIMEOUT_MS).toBe("3000000");
  });

  it("does not set GLM env vars for other models", () => {
    const result = buildChildEnv({}, "claude-sonnet", "key");
    expect(result.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result.API_TIMEOUT_MS).toBeUndefined();
  });
});

describe("getCleanEnv", () => {
  it("strips CLAUDECODE from env", () => {
    const original = process.env.CLAUDECODE;
    process.env.CLAUDECODE = "test-value";
    const result = getCleanEnv();
    expect(result.CLAUDECODE).toBeUndefined();
    // Restore
    if (original !== undefined) process.env.CLAUDECODE = original;
    else delete process.env.CLAUDECODE;
  });

  it("preserves other env vars", () => {
    const result = getCleanEnv();
    expect(result.PATH).toBe(process.env.PATH);
  });
});

describe("buildSecurityArgs", () => {
  it("always includes --dangerously-skip-permissions", () => {
    const args = buildSecurityArgs({ level: "moderate", allowedTools: [], disallowedTools: [] });
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("locked level restricts to Read,Grep,Glob", () => {
    const args = buildSecurityArgs({ level: "locked", allowedTools: [], disallowedTools: [] });
    expect(args).toContain("--tools");
    expect(args).toContain("Read,Grep,Glob");
  });

  it("strict level disallows Bash,WebSearch,WebFetch", () => {
    const args = buildSecurityArgs({ level: "strict", allowedTools: [], disallowedTools: [] });
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("Bash,WebSearch,WebFetch");
  });

  it("moderate level adds no extra tool args", () => {
    const args = buildSecurityArgs({ level: "moderate", allowedTools: [], disallowedTools: [] });
    expect(args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("unrestricted level adds no extra tool args", () => {
    const args = buildSecurityArgs({ level: "unrestricted", allowedTools: [], disallowedTools: [] });
    expect(args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("appends allowedTools", () => {
    const args = buildSecurityArgs({ level: "moderate", allowedTools: ["Read", "Write"], disallowedTools: [] });
    expect(args).toContain("--allowedTools");
    expect(args).toContain("Read Write");
  });

  it("appends disallowedTools", () => {
    const args = buildSecurityArgs({ level: "moderate", allowedTools: [], disallowedTools: ["Bash"] });
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("Bash");
  });
});

describe("handleStreamJsonEvent", () => {
  function collect() {
    const text: string[] = [];
    const toolUses: number[] = [];
    const sessionIds: string[] = [];
    const results: string[] = [];
    const handlers: StreamJsonHandlers = {
      onText: (t) => { text.push(t); },
      onToolUse: () => { toolUses.push(toolUses.length); },
      onSessionInit: (sid) => { sessionIds.push(sid); },
      onResult: (r) => { results.push(r); },
    };
    return { text, toolUses, sessionIds, results, handlers };
  }

  it("emits text from assistant text blocks", async () => {
    const c = collect();
    await handleStreamJsonEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }, { type: "text", text: " world" }] },
    }, c.handlers);
    expect(c.text).toEqual(["hello", " world"]);
  });

  it("emits tool_use for each tool_use block", async () => {
    const c = collect();
    await handleStreamJsonEvent({
      type: "assistant",
      message: { content: [{ type: "tool_use" }, { type: "tool_use" }] },
    }, c.handlers);
    expect(c.toolUses.length).toBe(2);
  });

  it("skips empty text blocks", async () => {
    const c = collect();
    await handleStreamJsonEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "" }] },
    }, c.handlers);
    expect(c.text).toEqual([]);
  });

  it("captures session_id from system event", async () => {
    const c = collect();
    await handleStreamJsonEvent({ type: "system", subtype: "init", session_id: "abc-123" }, c.handlers);
    expect(c.sessionIds).toEqual(["abc-123"]);
  });

  it("captures result text from result event", async () => {
    const c = collect();
    await handleStreamJsonEvent({ type: "result", result: "final text" }, c.handlers);
    expect(c.results).toEqual(["final text"]);
  });

  it("skips empty result text", async () => {
    const c = collect();
    await handleStreamJsonEvent({ type: "result", result: "" }, c.handlers);
    expect(c.results).toEqual([]);
  });

  it("handles top-level tool_use event", async () => {
    const c = collect();
    await handleStreamJsonEvent({ type: "tool_use" }, c.handlers);
    expect(c.toolUses.length).toBe(1);
  });

  it("ignores unknown event types", async () => {
    const c = collect();
    await handleStreamJsonEvent({ type: "mystery" }, c.handlers);
    expect(c.text).toEqual([]);
    expect(c.toolUses).toEqual([]);
    expect(c.sessionIds).toEqual([]);
    expect(c.results).toEqual([]);
  });

  it("ignores non-object events", async () => {
    const c = collect();
    await handleStreamJsonEvent(null, c.handlers);
    await handleStreamJsonEvent("string", c.handlers);
    await handleStreamJsonEvent(42, c.handlers);
    expect(c.text).toEqual([]);
  });

  it("invokes handlers only when provided", async () => {
    // No throws when handlers are absent.
    await handleStreamJsonEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "x" }, { type: "tool_use" }] },
    }, {});
    await handleStreamJsonEvent({ type: "system", session_id: "x" }, {});
    await handleStreamJsonEvent({ type: "result", result: "x" }, {});
  });
});

function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

describe("consumeStreamJsonStream", () => {
  it("reproduces the kalai pattern: text before tool, no text after", async () => {
    // assistant emits text + tool_use (stop_reason: tool_use), then turn ends.
    // Old text-format would drop all of this; stream-json captures it.
    const lines = [
      `{"type":"system","subtype":"init","session_id":"kalai-sess"}\n`,
      `{"type":"assistant","message":{"content":[{"type":"text","text":"The inner critic has ammunition."},{"type":"tool_use","name":"Edit"}]}}\n`,
      `{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}\n`,
      `{"type":"result","result":""}\n`,
    ];
    let collected = "";
    let sessionId: string | null = null;
    let toolUses = 0;
    let fallbackResult = "";
    await consumeStreamJsonStream(streamFromLines(lines), {
      onText: (t) => { collected += t; },
      onToolUse: () => { toolUses++; },
      onSessionInit: (sid) => { sessionId = sid; },
      onResult: (r) => { fallbackResult = r; },
    });
    expect(collected).toBe("The inner critic has ammunition.");
    expect(sessionId).toBe("kalai-sess");
    expect(toolUses).toBe(1);
    expect(fallbackResult).toBe(""); // empty result event is skipped
  });

  it("concatenates text across multiple assistant events", async () => {
    const lines = [
      `{"type":"assistant","message":{"content":[{"type":"text","text":"Looking now."},{"type":"tool_use"}]}}\n`,
      `{"type":"assistant","message":{"content":[{"type":"text","text":"Found: hello"}]}}\n`,
      `{"type":"result","result":"Found: hello"}\n`,
    ];
    let collected = "";
    await consumeStreamJsonStream(streamFromLines(lines), { onText: (t) => { collected += t; } });
    expect(collected).toBe("Looking now.Found: hello");
  });

  it("handles chunks split mid-line", async () => {
    const lines = [
      `{"type":"assistant","message":{"content":[{"type":"text","text":"hel`,
      `lo"}]}}\n{"type":"result","result":"hello"}\n`,
    ];
    let collected = "";
    let finalResult = "";
    await consumeStreamJsonStream(streamFromLines(lines), {
      onText: (t) => { collected += t; },
      onResult: (r) => { finalResult = r; },
    });
    expect(collected).toBe("hello");
    expect(finalResult).toBe("hello");
  });

  it("parses a trailing line without newline", async () => {
    const lines = [`{"type":"assistant","message":{"content":[{"type":"text","text":"tail"}]}}`];
    let collected = "";
    await consumeStreamJsonStream(streamFromLines(lines), { onText: (t) => { collected += t; } });
    expect(collected).toBe("tail");
  });

  it("silently skips malformed JSON lines", async () => {
    const lines = [
      `not json\n`,
      `{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n`,
      `{incomplete\n`,
    ];
    let collected = "";
    await consumeStreamJsonStream(streamFromLines(lines), { onText: (t) => { collected += t; } });
    expect(collected).toBe("ok");
  });

  it("emits nothing when stream contains only tool_use", async () => {
    // Preserves the "(empty response)" fallback path in chat-handler.
    const lines = [
      `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}\n`,
      `{"type":"result","result":""}\n`,
    ];
    let collected = "";
    let toolUses = 0;
    await consumeStreamJsonStream(streamFromLines(lines), {
      onText: (t) => { collected += t; },
      onToolUse: () => { toolUses++; },
    });
    expect(collected).toBe("");
    expect(toolUses).toBe(1);
  });
});
