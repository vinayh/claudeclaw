import { describe, it, expect } from "bun:test";
import {
  extractJsonBlock,
  extractSnowflakeArray,
  parseExcludeWindows,
  parseAgenticConfig,
  parseSettings,
  ExcludeWindowSchema,
  AgenticModeSchema,
  SettingsSchema,
} from "./config";

// ---------------------------------------------------------------------------
// extractJsonBlock
// ---------------------------------------------------------------------------

describe("extractJsonBlock", () => {
  it("extracts a top-level object block", () => {
    const json = '{"discord": {"token": "abc", "allowedUserIds": [123]}, "other": true}';
    const block = extractJsonBlock(json, "discord");
    expect(block).toBe('{"token": "abc", "allowedUserIds": [123]}');
  });

  it("handles nested braces", () => {
    const json = '{"discord": {"nested": {"deep": true}, "ids": [1]}}';
    const block = extractJsonBlock(json, "discord");
    expect(block).toBe('{"nested": {"deep": true}, "ids": [1]}');
  });

  it("returns null when key is missing", () => {
    expect(extractJsonBlock('{"other": {}}', "discord")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractJsonBlock("", "discord")).toBeNull();
  });

  it("handles multiline JSON", () => {
    const json = `{
  "discord": {
    "token": "abc",
    "allowedUserIds": [123, 456]
  }
}`;
    const block = extractJsonBlock(json, "discord");
    expect(block).toContain('"allowedUserIds"');
    expect(block).toContain("456");
  });
});

// ---------------------------------------------------------------------------
// extractSnowflakeArray
// ---------------------------------------------------------------------------

describe("extractSnowflakeArray", () => {
  it("extracts bare numbers", () => {
    const json = '{"discord": {"allowedUserIds": [1234567890123456789, 9876543210987654321]}}';
    const ids = extractSnowflakeArray(json, "allowedUserIds");
    expect(ids).toEqual(["1234567890123456789", "9876543210987654321"]);
  });

  it("extracts quoted strings", () => {
    const json = '{"discord": {"allowedUserIds": ["1234567890123456789"]}}';
    const ids = extractSnowflakeArray(json, "allowedUserIds");
    expect(ids).toEqual(["1234567890123456789"]);
  });

  it("handles mixed formats", () => {
    const json = '{"discord": {"allowedUserIds": [123, "456"]}}';
    const ids = extractSnowflakeArray(json, "allowedUserIds");
    expect(ids).toEqual(["123", "456"]);
  });

  it("returns empty array for empty array value", () => {
    const json = '{"discord": {"allowedUserIds": []}}';
    expect(extractSnowflakeArray(json, "allowedUserIds")).toEqual([]);
  });

  it("returns empty array when field is missing", () => {
    const json = '{"discord": {"token": "abc"}}';
    expect(extractSnowflakeArray(json, "allowedUserIds")).toEqual([]);
  });

  it("returns empty array when discord block is missing", () => {
    const json = '{"telegram": {"token": "abc"}}';
    expect(extractSnowflakeArray(json, "allowedUserIds")).toEqual([]);
  });

  it("extracts listenChannels too", () => {
    const json = '{"discord": {"listenChannels": [111222333444555666]}}';
    const ids = extractSnowflakeArray(json, "listenChannels");
    expect(ids).toEqual(["111222333444555666"]);
  });

  it("handles nested discord object (regression test)", () => {
    const json = `{
  "discord": {
    "token": "abc",
    "nested": {"foo": "bar"},
    "allowedUserIds": [1234567890123456789]
  }
}`;
    const ids = extractSnowflakeArray(json, "allowedUserIds");
    expect(ids).toEqual(["1234567890123456789"]);
  });
});

// ---------------------------------------------------------------------------
// ExcludeWindowSchema (strict, single-entry validation)
// ---------------------------------------------------------------------------

describe("ExcludeWindowSchema", () => {
  it("parses a valid window", () => {
    const result = ExcludeWindowSchema.parse({ start: "09:00", end: "17:00" });
    expect(result).toEqual({ start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6] });
  });

  it("parses with specific days", () => {
    const result = ExcludeWindowSchema.parse({ start: "22:00", end: "06:00", days: [1, 2, 3, 4, 5] });
    expect(result.days).toEqual([1, 2, 3, 4, 5]);
  });

  it("deduplicates and sorts days", () => {
    const result = ExcludeWindowSchema.parse({ start: "09:00", end: "17:00", days: [5, 1, 1, 3, 3] });
    expect(result.days).toEqual([1, 3, 5]);
  });

  it("throws on invalid time format", () => {
    expect(() => ExcludeWindowSchema.parse({ start: "25:00", end: "17:00" })).toThrow();
    expect(() => ExcludeWindowSchema.parse({ start: "9:00", end: "17:00" })).toThrow();
    expect(() => ExcludeWindowSchema.parse({ start: "09:60", end: "17:00" })).toThrow();
  });

  it("throws on missing start or end", () => {
    expect(() => ExcludeWindowSchema.parse({ start: "09:00" })).toThrow();
    expect(() => ExcludeWindowSchema.parse({ end: "17:00" })).toThrow();
  });

  it("throws on out-of-range days", () => {
    expect(() => ExcludeWindowSchema.parse({ start: "09:00", end: "17:00", days: [7] })).toThrow();
    expect(() => ExcludeWindowSchema.parse({ start: "09:00", end: "17:00", days: [-1] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseExcludeWindows (lenient array wrapper — skips invalid entries)
// ---------------------------------------------------------------------------

describe("parseExcludeWindows", () => {
  it("parses valid entries", () => {
    const result = parseExcludeWindows([{ start: "09:00", end: "17:00" }]);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe("09:00");
  });

  it("skips invalid entries and keeps valid ones", () => {
    const result = parseExcludeWindows([
      { start: "bad", end: "17:00" },
      { start: "09:00", end: "17:00" },
      null,
      "not an object",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe("09:00");
  });

  it("returns empty array for non-array input", () => {
    expect(parseExcludeWindows(null)).toEqual([]);
    expect(parseExcludeWindows(undefined)).toEqual([]);
    expect(parseExcludeWindows("not an array")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AgenticModeSchema
// ---------------------------------------------------------------------------

describe("AgenticModeSchema", () => {
  it("parses a valid mode", () => {
    const result = AgenticModeSchema.parse({
      name: "planning",
      model: "opus",
      keywords: ["plan", "design"],
      phrases: ["how should i"],
    });
    expect(result).toEqual({
      name: "planning",
      model: "opus",
      keywords: ["plan", "design"],
      phrases: ["how should i"],
    });
  });

  it("throws on missing name", () => {
    expect(() => AgenticModeSchema.parse({ model: "opus", keywords: ["plan"] })).toThrow();
  });

  it("throws on empty name", () => {
    expect(() => AgenticModeSchema.parse({ name: "", model: "opus", keywords: ["plan"] })).toThrow();
  });

  it("throws on missing model", () => {
    expect(() => AgenticModeSchema.parse({ name: "test", keywords: ["plan"] })).toThrow();
  });

  it("throws on empty model", () => {
    expect(() => AgenticModeSchema.parse({ name: "test", model: "", keywords: ["plan"] })).toThrow();
  });

  it("lowercases and trims keywords", () => {
    const result = AgenticModeSchema.parse({
      name: "test",
      model: "m",
      keywords: ["  PLAN  ", "Design"],
    });
    expect(result.keywords).toEqual(["plan", "design"]);
  });

  it("omits phrases when empty or missing", () => {
    const result = AgenticModeSchema.parse({ name: "test", model: "m", keywords: ["k"] });
    expect(result.phrases).toBeUndefined();

    const result2 = AgenticModeSchema.parse({ name: "test", model: "m", keywords: ["k"], phrases: [] });
    expect(result2.phrases).toBeUndefined();
  });

  it("throws on non-object input", () => {
    expect(() => AgenticModeSchema.parse(null)).toThrow();
    expect(() => AgenticModeSchema.parse("string")).toThrow();
    expect(() => AgenticModeSchema.parse(42)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseAgenticConfig (lenient — backward compat, filters invalid modes)
// ---------------------------------------------------------------------------

describe("parseAgenticConfig", () => {
  it("parses valid config with modes", () => {
    const result = parseAgenticConfig({
      enabled: true,
      defaultMode: "planning",
      modes: [
        { name: "planning", model: "opus", keywords: ["plan"] },
        { name: "impl", model: "sonnet", keywords: ["code"] },
      ],
    });
    expect(result.enabled).toBe(true);
    expect(result.defaultMode).toBe("planning");
    expect(result.modes).toHaveLength(2);
  });

  it("handles backward compat with planningModel/implementationModel", () => {
    const result = parseAgenticConfig({
      enabled: true,
      planningModel: "custom-opus",
      implementationModel: "custom-sonnet",
    });
    expect(result.enabled).toBe(true);
    expect(result.modes[0].name).toBe("planning");
    expect(result.modes[0].model).toBe("custom-opus");
    expect(result.modes[1].name).toBe("implementation");
    expect(result.modes[1].model).toBe("custom-sonnet");
  });

  it("returns defaults for null/undefined input", () => {
    const result = parseAgenticConfig(null);
    expect(result.enabled).toBe(false);
    expect(result.defaultMode).toBe("implementation");
    expect(result.modes).toHaveLength(2);
  });

  it("returns defaults for non-object input", () => {
    expect(parseAgenticConfig("string").enabled).toBe(false);
    expect(parseAgenticConfig(42).modes).toHaveLength(2);
  });

  it("falls back to default modes when modes array is empty", () => {
    const result = parseAgenticConfig({ enabled: true, modes: [] });
    expect(result.modes).toHaveLength(2);
    expect(result.modes[0].name).toBe("planning");
  });

  it("filters out invalid modes", () => {
    const result = parseAgenticConfig({
      enabled: true,
      modes: [
        { name: "valid", model: "m", keywords: ["k"] },
        { name: "", model: "m", keywords: ["k"] }, // invalid: empty name
        null,
      ],
    });
    expect(result.modes).toHaveLength(1);
    expect(result.modes[0].name).toBe("valid");
  });
});

// ---------------------------------------------------------------------------
// SettingsSchema (top-level structural validation)
// ---------------------------------------------------------------------------

describe("SettingsSchema", () => {
  it("parses a minimal valid config", () => {
    const result = SettingsSchema.parse({});
    expect(result.model).toBe("");
    expect(result.security.level).toBe("moderate");
    expect(result.web.port).toBe(4632);
  });

  it("validates and trims string fields", () => {
    const result = SettingsSchema.parse({ model: "  opus  ", api: "  key  " });
    expect(result.model).toBe("opus");
    expect(result.api).toBe("key");
  });

  it("falls back on invalid types", () => {
    const result = SettingsSchema.parse({
      model: 123,        // not a string → falls back to ""
      heartbeat: {
        enabled: "yes",  // not a boolean → falls back to false
        interval: "ten", // not a number → falls back to 15
      },
    });
    expect(result.model).toBe("");
    expect(result.heartbeat.enabled).toBe(false);
    expect(result.heartbeat.interval).toBe(15);
  });

  it("validates security level enum", () => {
    expect(SettingsSchema.parse({ security: { level: "strict" } }).security.level).toBe("strict");
    expect(SettingsSchema.parse({ security: { level: "invalid" } }).security.level).toBe("moderate");
  });

  it("validates web port is finite", () => {
    expect(SettingsSchema.parse({ web: { port: 8080 } }).web.port).toBe(8080);
    expect(SettingsSchema.parse({ web: { port: Infinity } }).web.port).toBe(4632);
    expect(SettingsSchema.parse({ web: { port: "abc" } }).web.port).toBe(4632);
  });

  it("parses sessionTimeoutMs with default", () => {
    const result = SettingsSchema.parse({});
    expect(result.sessionTimeoutMs).toBe(300_000);
  });

  it("accepts a valid sessionTimeoutMs", () => {
    const result = SettingsSchema.parse({ sessionTimeoutMs: 600_000 });
    expect(result.sessionTimeoutMs).toBe(600_000);
  });

  it("falls back on invalid sessionTimeoutMs", () => {
    expect(SettingsSchema.parse({ sessionTimeoutMs: "bad" }).sessionTimeoutMs).toBe(300_000);
    expect(SettingsSchema.parse({ sessionTimeoutMs: -1 }).sessionTimeoutMs).toBe(300_000);
    expect(SettingsSchema.parse({ sessionTimeoutMs: 0 }).sessionTimeoutMs).toBe(300_000);
    expect(SettingsSchema.parse({ sessionTimeoutMs: 1.5 }).sessionTimeoutMs).toBe(300_000);
  });
});

describe("parseSettings", () => {
  it("returns full Settings from minimal input", () => {
    const result = parseSettings({});
    expect(result.model).toBe("");
    expect(result.api).toBe("");
    expect(result.heartbeat.enabled).toBe(false);
    expect(result.heartbeat.interval).toBe(15);
    expect(result.telegram.token).toBe("");
    expect(result.discord.token).toBe("");
    expect(result.security.level).toBe("moderate");
    expect(result.sessionTimeoutMs).toBe(300_000);
  });

  it("passes model and api through", () => {
    const result = parseSettings({ model: "opus", api: "my-key" });
    expect(result.model).toBe("opus");
    expect(result.api).toBe("my-key");
  });

  it("resolves timezone into timezoneOffsetMinutes", () => {
    const result = parseSettings({ timezone: "UTC" });
    expect(result.timezone).toBe("UTC");
    expect(result.timezoneOffsetMinutes).toBe(0);
  });

  it("uses explicit timezoneOffsetMinutes when provided", () => {
    const result = parseSettings({ timezoneOffsetMinutes: -300 });
    expect(result.timezoneOffsetMinutes).toBe(-300);
  });

  it("uses discordIds override when provided", () => {
    const result = parseSettings(
      { discord: { allowedUserIds: ["111"], listenChannels: ["222"] } },
      { allowedUserIds: ["999"], listenChannels: ["888"] },
    );
    expect(result.discord.allowedUserIds).toEqual(["999"]);
    expect(result.discord.listenChannels).toEqual(["888"]);
  });

  it("falls back to validated discord IDs when no discordIds override", () => {
    const result = parseSettings({
      discord: { allowedUserIds: ["111"], listenChannels: ["222"] },
    });
    expect(result.discord.allowedUserIds).toEqual(["111"]);
    expect(result.discord.listenChannels).toEqual(["222"]);
  });

  it("parses heartbeat excludeWindows", () => {
    const result = parseSettings({
      heartbeat: {
        excludeWindows: [{ start: "22:00", end: "06:00", days: [0, 6] }],
      },
    });
    expect(result.heartbeat.excludeWindows).toHaveLength(1);
    expect(result.heartbeat.excludeWindows[0].start).toBe("22:00");
  });

  it("parses agentic config", () => {
    const result = parseSettings({
      agentic: {
        enabled: true,
        defaultMode: "planning",
        modes: [{ name: "test", model: "haiku", keywords: ["debug"] }],
      },
    });
    expect(result.agentic.enabled).toBe(true);
    expect(result.agentic.defaultMode).toBe("planning");
    expect(result.agentic.modes).toHaveLength(1);
  });

  it("uses TELEGRAM_TOKEN env var over settings value", () => {
    const orig = process.env.TELEGRAM_TOKEN;
    try {
      process.env.TELEGRAM_TOKEN = "env-token";
      const result = parseSettings({ telegram: { token: "settings-token" } });
      expect(result.telegram.token).toBe("env-token");
    } finally {
      if (orig === undefined) delete process.env.TELEGRAM_TOKEN;
      else process.env.TELEGRAM_TOKEN = orig;
    }
  });

  it("uses DISCORD_TOKEN env var over settings value", () => {
    const orig = process.env.DISCORD_TOKEN;
    try {
      process.env.DISCORD_TOKEN = "env-discord";
      const result = parseSettings({ discord: { token: "settings-discord" } });
      expect(result.discord.token).toBe("env-discord");
    } finally {
      if (orig === undefined) delete process.env.DISCORD_TOKEN;
      else process.env.DISCORD_TOKEN = orig;
    }
  });
});
