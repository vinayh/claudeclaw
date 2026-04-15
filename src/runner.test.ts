import { describe, it, expect } from "bun:test";
import {
  extractRateLimitMessage,
  sameModelConfig,
  hasModelConfig,
  isNotFoundError,
  buildChildEnv,
  getCleanEnv,
  buildSecurityArgs,
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
