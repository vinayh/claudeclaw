import { describe, it, expect } from "bun:test";
import { sanitizeSettings } from "./state";

function makeSnapshot(overrides: Partial<Parameters<typeof sanitizeSettings>[0]> = {}) {
  return {
    timezone: "America/New_York",
    timezoneOffsetMinutes: -300,
    heartbeat: { enabled: true, interval: 15, prompt: "", excludeWindows: [] },
    security: { level: "moderate" as const, allowedTools: [], disallowedTools: [] },
    telegram: { token: "secret-token", allowedUserIds: ["u1", "u2"] },
    discord: { token: "discord-secret", allowedUserIds: ["d1"], listenChannelIds: [], guildId: "" },
    web: { enabled: true, host: "0.0.0.0", port: 3000 },
    ...overrides,
  };
}

describe("sanitizeSettings", () => {
  it("redacts telegram token to boolean", () => {
    const result = sanitizeSettings(makeSnapshot());
    expect(result.telegram.configured).toBe(true);
    expect((result.telegram as any).token).toBeUndefined();
  });

  it("redacts discord token to boolean", () => {
    const result = sanitizeSettings(makeSnapshot());
    expect(result.discord.configured).toBe(true);
    expect((result.discord as any).token).toBeUndefined();
  });

  it("counts allowed user IDs", () => {
    const result = sanitizeSettings(makeSnapshot());
    expect(result.telegram.allowedUserCount).toBe(2);
    expect(result.discord.allowedUserCount).toBe(1);
  });

  it("preserves safe fields", () => {
    const result = sanitizeSettings(makeSnapshot());
    expect(result.timezone).toBe("America/New_York");
    expect(result.heartbeat.enabled).toBe(true);
    expect(result.security.level).toBe("moderate");
    expect(result.web.port).toBe(3000);
  });

  it("reports unconfigured when tokens are empty", () => {
    const result = sanitizeSettings(makeSnapshot({
      telegram: { token: "", allowedUserIds: [] },
      discord: { token: "", allowedUserIds: [], listenChannelIds: [], guildId: "" },
    }));
    expect(result.telegram.configured).toBe(false);
    expect(result.discord.configured).toBe(false);
  });
});
