import { isAbsolute, join } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { z } from "zod";
import { normalizeTimezoneName, resolveTimezoneOffsetMinutes } from "./timezone";
import { HEARTBEAT_DIR, JOBS_DIR, LOGS_DIR, SETTINGS_FILE } from "./paths";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const ExcludeWindowSchema = z.object({
  start: z.string().regex(TIME_RE, "Must be HH:MM (00:00–23:59)"),
  end: z.string().regex(TIME_RE, "Must be HH:MM (00:00–23:59)"),
  days: z
    .array(z.number().int().min(0).max(6))
    .default([...ALL_DAYS])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
});

export const AgenticModeSchema = z
  .object({
    name: z.string().trim().min(1, "Mode name is required"),
    model: z.string().trim().min(1, "Mode model is required"),
    keywords: z
      .array(z.string())
      .default([])
      .transform((arr) => arr.map((k) => k.toLowerCase().trim()).filter(Boolean)),
    phrases: z
      .array(z.string())
      .optional()
      .transform((arr) => {
        if (!arr) return undefined;
        const filtered = arr.map((p) => p.toLowerCase().trim()).filter(Boolean);
        return filtered.length > 0 ? filtered : undefined;
      }),
  });

const SECURITY_LEVELS = ["locked", "strict", "moderate", "unrestricted"] as const;

export const SettingsSchema = z
  .object({
    model: z.string().trim().catch(""),
    api: z.string().trim().catch(""),
    fallback: z
      .object({
        model: z.string().trim().catch(""),
        api: z.string().trim().catch(""),
      })
      .catch({ model: "", api: "" }),
    agentic: z.unknown().catch(undefined),
    timezone: z.unknown().catch(undefined),
    timezoneOffsetMinutes: z.unknown().catch(undefined),
    heartbeat: z
      .object({
        enabled: z.boolean().catch(false),
        interval: z.number().catch(15),
        prompt: z.string().catch(""),
        excludeWindows: z.unknown().catch([]),
        forwardToTelegram: z.boolean().catch(false),
      })
      .catch({ enabled: false, interval: 15, prompt: "", excludeWindows: [], forwardToTelegram: true }),
    telegram: z
      .object({
        token: z.string().catch(""),
        allowedUserIds: z.array(z.number()).catch([]),
      })
      .catch({ token: "", allowedUserIds: [] }),
    discord: z
      .object({
        token: z.string().trim().catch(""),
        allowedUserIds: z.array(z.unknown()).transform((arr) => arr.map(String)).catch([]),
        listenChannels: z.array(z.unknown()).transform((arr) => arr.map(String)).catch([]),
      })
      .catch({ token: "", allowedUserIds: [], listenChannels: [] }),
    security: z
      .object({
        level: z.enum(SECURITY_LEVELS).catch("moderate"),
        allowedTools: z.array(z.string()).catch([]),
        disallowedTools: z.array(z.string()).catch([]),
      })
      .catch({ level: "moderate" as const, allowedTools: [], disallowedTools: [] }),
    web: z
      .object({
        enabled: z.boolean().catch(false),
        host: z.string().catch("127.0.0.1"),
        port: z.number().finite().catch(4632),
      })
      .catch({ enabled: false, host: "127.0.0.1", port: 4632 }),
    stt: z
      .object({
        baseUrl: z.string().trim().catch(""),
        model: z.string().trim().catch(""),
      })
      .catch({ baseUrl: "", model: "" }),
    sessionTimeoutMs: z.number().int().positive().catch(300_000),
  });

// ---------------------------------------------------------------------------
// Types (inferred from schemas, re-exported for external consumers)
// ---------------------------------------------------------------------------

export type HeartbeatExcludeWindow = z.infer<typeof ExcludeWindowSchema>;

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number;
  prompt: string;
  excludeWindows: HeartbeatExcludeWindow[];
  forwardToTelegram: boolean;
}

export interface TelegramConfig {
  token: string;
  allowedUserIds: number[];
}

export interface DiscordConfig {
  token: string;
  allowedUserIds: string[];
  listenChannels: string[];
}

export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

export interface SecurityConfig {
  level: SecurityLevel;
  allowedTools: string[];
  disallowedTools: string[];
}

export type AgenticMode = z.infer<typeof AgenticModeSchema>;

export interface AgenticConfig {
  enabled: boolean;
  defaultMode: string;
  modes: AgenticMode[];
}

export interface ModelConfig {
  model: string;
  api: string;
}

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export interface SttConfig {
  baseUrl: string;
  model: string;
}

export interface Settings {
  model: string;
  api: string;
  fallback: ModelConfig;
  agentic: AgenticConfig;
  timezone: string;
  timezoneOffsetMinutes: number;
  heartbeat: HeartbeatConfig;
  telegram: TelegramConfig;
  discord: DiscordConfig;
  security: SecurityConfig;
  web: WebConfig;
  stt: SttConfig;
  sessionTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Default mode definitions (shared by parseAgenticConfig and DEFAULT_SETTINGS)
// ---------------------------------------------------------------------------

const DEFAULT_PLANNING_MODE: AgenticMode = {
  name: "planning",
  model: "opus",
  keywords: [
    "plan", "design", "architect", "strategy", "approach",
    "research", "investigate", "analyze", "explore", "understand",
    "think", "consider", "evaluate", "assess", "review",
    "system design", "trade-off", "decision", "choose", "compare",
    "brainstorm", "ideate", "concept", "proposal",
  ],
  phrases: [
    "how to implement", "how should i", "what's the best way to",
    "should i", "which approach", "help me decide", "help me understand",
  ],
};

const DEFAULT_IMPLEMENTATION_MODE: AgenticMode = {
  name: "implementation",
  model: "sonnet",
  keywords: [
    "implement", "code", "write", "create", "build", "add",
    "fix", "debug", "refactor", "update", "modify", "change",
    "deploy", "run", "execute", "install", "configure",
    "test", "commit", "push", "merge", "release",
    "generate", "scaffold", "setup", "initialize",
  ],
  phrases: undefined,
};

const DEFAULT_MODES: AgenticMode[] = [DEFAULT_PLANNING_MODE, DEFAULT_IMPLEMENTATION_MODE];

const DEFAULT_SETTINGS: Settings = {
  model: "",
  api: "",
  fallback: { model: "", api: "" },
  agentic: { enabled: false, defaultMode: "implementation", modes: DEFAULT_MODES },
  timezone: "UTC",
  timezoneOffsetMinutes: 0,
  heartbeat: { enabled: false, interval: 15, prompt: "", excludeWindows: [], forwardToTelegram: true },
  telegram: { token: "", allowedUserIds: [] },
  discord: { token: "", allowedUserIds: [], listenChannels: [] },
  security: { level: "moderate", allowedTools: [], disallowedTools: [] },
  web: { enabled: false, host: "127.0.0.1", port: 4632 },
  stt: { baseUrl: "", model: "" },
  sessionTimeoutMs: 300_000,
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

let cached: Settings | null = null;

export async function initConfig(): Promise<void> {
  await mkdir(HEARTBEAT_DIR, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });

  if (!existsSync(SETTINGS_FILE)) {
    await Bun.write(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n");
  }
}

/** Parse an array of exclude windows, silently skipping invalid entries. */
export function parseExcludeWindows(value: unknown): HeartbeatExcludeWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const result = ExcludeWindowSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

/** Parse agentic config, handling backward-compat planningModel/implementationModel format. */
export function parseAgenticConfig(raw: unknown): AgenticConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS.agentic;

  const obj = raw as Record<string, unknown>;
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : false;

  // Backward compat: old planningModel/implementationModel format
  if (!Array.isArray(obj.modes) && ("planningModel" in obj || "implementationModel" in obj)) {
    const planningModel = typeof obj.planningModel === "string" ? obj.planningModel.trim() : "opus";
    const implModel = typeof obj.implementationModel === "string" ? obj.implementationModel.trim() : "sonnet";
    return {
      enabled,
      defaultMode: "implementation",
      modes: [
        { ...DEFAULT_PLANNING_MODE, model: planningModel },
        { ...DEFAULT_IMPLEMENTATION_MODE, model: implModel },
      ],
    };
  }

  // Parse modes array, silently skipping invalid entries
  const modes: AgenticMode[] = [];
  if (Array.isArray(obj.modes)) {
    for (const m of obj.modes) {
      const result = AgenticModeSchema.safeParse(m);
      if (result.success) modes.push(result.data);
    }
  }

  return {
    enabled,
    defaultMode: typeof obj.defaultMode === "string" ? obj.defaultMode.trim() : "implementation",
    modes: modes.length > 0 ? modes : DEFAULT_MODES,
  };
}

interface DiscordSnowflakes {
  allowedUserIds: string[];
  listenChannels: string[];
}

/** @internal Exported for testing. */
export function parseSettings(raw: unknown, discordIds?: DiscordSnowflakes): Settings {
  const validated = SettingsSchema.parse(raw);

  const parsedTimezone = normalizeTimezoneName(validated.timezone);

  return {
    model: validated.model,
    api: validated.api,
    fallback: validated.fallback,
    agentic: parseAgenticConfig(validated.agentic),
    timezone: parsedTimezone,
    timezoneOffsetMinutes: resolveTimezoneOffsetMinutes(validated.timezoneOffsetMinutes, parsedTimezone),
    heartbeat: {
      enabled: validated.heartbeat.enabled,
      interval: validated.heartbeat.interval,
      prompt: validated.heartbeat.prompt,
      excludeWindows: parseExcludeWindows(validated.heartbeat.excludeWindows),
      forwardToTelegram: validated.heartbeat.forwardToTelegram,
    },
    telegram: {
      token: process.env.TELEGRAM_TOKEN || validated.telegram.token,
      allowedUserIds: validated.telegram.allowedUserIds,
    },
    discord: {
      token: process.env.DISCORD_TOKEN || validated.discord.token,
      allowedUserIds: discordIds?.allowedUserIds ?? validated.discord.allowedUserIds,
      listenChannels: discordIds?.listenChannels ?? validated.discord.listenChannels,
    },
    security: validated.security,
    web: validated.web,
    stt: validated.stt,
    sessionTimeoutMs: validated.sessionTimeoutMs,
  };
}

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const rawText = await Bun.file(SETTINGS_FILE).text();
  const raw = JSON.parse(rawText);
  cached = parseSettings(raw, {
    allowedUserIds: extractSnowflakeArray(rawText, "allowedUserIds"),
    listenChannels: extractSnowflakeArray(rawText, "listenChannels"),
  });
  return cached;
}

/** Re-read settings from disk, bypassing cache. */
export async function reloadSettings(): Promise<Settings> {
  const rawText = await Bun.file(SETTINGS_FILE).text();
  const raw = JSON.parse(rawText);
  cached = parseSettings(raw, {
    allowedUserIds: extractSnowflakeArray(rawText, "allowedUserIds"),
    listenChannels: extractSnowflakeArray(rawText, "listenChannels"),
  });
  return cached;
}

export function getSettings(): Settings {
  if (!cached) throw new Error("Settings not loaded. Call loadSettings() first.");
  return cached;
}

// ---------------------------------------------------------------------------
// Snowflake extraction (precision-safe parsing of Discord IDs from raw JSON)
// ---------------------------------------------------------------------------

/** @internal Extract a top-level JSON object block by key, handling nested braces. Exported for testing. */
export function extractJsonBlock(rawText: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*\\{`);
  const match = re.exec(rawText);
  if (!match) return null;
  const start = match.index! + match[0].length - 1;
  let depth = 0;
  for (let i = start; i < rawText.length; i++) {
    if (rawText[i] === "{") depth++;
    else if (rawText[i] === "}") depth--;
    if (depth === 0) return rawText.slice(start, i + 1);
  }
  return null;
}

/** @internal Exported for testing. */
export function extractSnowflakeArray(rawText: string, field: string): string[] {
  const discordBlock = extractJsonBlock(rawText, "discord");
  if (!discordBlock) return [];
  const arrayMatch = discordBlock.match(new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  if (!arrayMatch) return [];
  const items: string[] = [];
  for (const m of arrayMatch[1].matchAll(/("(\d+)"|(\d+))/g)) {
    items.push(m[2] ?? m[3]);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Prompt resolution
// ---------------------------------------------------------------------------

const PROMPT_EXTENSIONS = [".md", ".txt", ".prompt"];

export async function resolvePrompt(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;

  const isPath = PROMPT_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
  if (!isPath) return trimmed;

  const resolved = isAbsolute(trimmed) ? trimmed : join(process.cwd(), trimmed);
  try {
    const content = await Bun.file(resolved).text();
    return content.trim();
  } catch {
    console.warn(`[config] Prompt path "${trimmed}" not found, using as literal string`);
    return trimmed;
  }
}
