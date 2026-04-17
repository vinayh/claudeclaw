import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { LOGS_DIR, SESSIONS_DIR } from "./paths";
import {
  DEFAULT_SESSION_KEY,
  getSession,
  createSession,
  incrementTurn,
  markCompactWarned,
} from "./sessionManager";
import { getSettings, type ModelConfig, type SecurityConfig } from "./config";
import { buildClockPromptPrefix } from "./timezone";
import { selectModel } from "./model-router";

// Resolve prompts relative to the claudeclaw installation, not the project dir
const PROMPTS_DIR = join(import.meta.dir, "..", "prompts");
const HEARTBEAT_PROMPT_FILE = join(PROMPTS_DIR, "heartbeat", "HEARTBEAT.md");
// Project-level prompt overrides live here (gitignored, user-owned)
const PROJECT_PROMPTS_DIR = join(process.cwd(), ".claude", "claudeclaw", "prompts");
const PROJECT_CLAUDE_MD = join(process.cwd(), "CLAUDE.md");
const LEGACY_PROJECT_CLAUDE_MD = join(process.cwd(), ".claude", "CLAUDE.md");
const CLAUDECLAW_BLOCK_START = "<!-- claudeclaw:managed:start -->";
const CLAUDECLAW_BLOCK_END = "<!-- claudeclaw:managed:end -->";

/**
 * Compact configuration.
 * COMPACT_WARN_THRESHOLD: notify user that context is getting large.
 * COMPACT_TIMEOUT_ENABLED: whether to auto-compact on timeout (exit 124).
 */
const COMPACT_WARN_THRESHOLD = 25;
const COMPACT_TIMEOUT_ENABLED = true;

export type CompactEvent =
  | { type: "warn"; turnCount: number }
  | { type: "auto-compact-start" }
  | { type: "auto-compact-done"; success: boolean }
  | { type: "auto-compact-retry"; success: boolean; stdout: string; stderr: string; exitCode: number };

type CompactEventListener = (event: CompactEvent) => void;
const compactListeners: CompactEventListener[] = [];

/** Register a listener for compact-related events (warnings, auto-compact notifications). */
export function onCompactEvent(listener: CompactEventListener): void {
  compactListeners.push(listener);
}

function emitCompactEvent(event: CompactEvent): void {
  for (const listener of compactListeners) {
    try { listener(event); } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] Compact event listener error:`, err);
    }
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const RATE_LIMIT_PATTERN = /you.ve hit your limit|out of extra usage/i;

// Per-session queues — each session runs independently in parallel
const sessionQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(fn: () => Promise<T>, sessionKey: string): Promise<T> {
  const current = sessionQueues.get(sessionKey) ?? Promise.resolve();
  const task = current.then(fn, fn);
  const sentinel = task.catch((err) => {
    console.error(`[Runner] Queued task error (session ${sessionKey.slice(0, 8)}):`, err);
  }).finally(() => {
    if (sessionQueues.get(sessionKey) === sentinel) {
      sessionQueues.delete(sessionKey);
    }
  });
  sessionQueues.set(sessionKey, sentinel);
  return task;
}

export function extractRateLimitMessage(stdout: string, stderr: string): string | null {
  const candidates = [stdout, stderr];
  for (const text of candidates) {
    const trimmed = text.trim();
    if (trimmed && RATE_LIMIT_PATTERN.test(trimmed)) return trimmed;
  }
  return null;
}

export function sameModelConfig(a: ModelConfig, b: ModelConfig): boolean {
  return a.model.trim().toLowerCase() === b.model.trim().toLowerCase() && a.api.trim() === b.api.trim();
}

export function hasModelConfig(value: ModelConfig): boolean {
  return value.model.trim().length > 0 || value.api.trim().length > 0;
}

export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /enoent|no such file or directory/i.test(message);
}

export function buildChildEnv(baseEnv: Record<string, string>, model: string, api: string): Record<string, string> {
  const childEnv: Record<string, string> = { ...baseEnv };
  const normalizedModel = model.trim().toLowerCase();

  if (api.trim()) childEnv.ANTHROPIC_AUTH_TOKEN = api.trim();

  if (normalizedModel === "glm") {
    childEnv.ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";
    childEnv.API_TIMEOUT_MS = "3000000";
  }

  return childEnv;
}

/** Strip CLAUDECODE env var so child claude processes don't think they're nested. */
export function getCleanEnv(): Record<string, string> {
  const { CLAUDECODE: _, ...rest } = process.env;
  return { ...rest } as Record<string, string>;
}

/** Default timeout for a single Claude Code invocation (5 minutes). */
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Handlers invoked while consuming a stream-json event stream from Claude Code.
 * Callbacks may be sync or async — the consumer awaits each in turn.
 */
export interface StreamJsonHandlers {
  /** Called once per text content block in an assistant message (in order). */
  onText?: (text: string) => void | Promise<void>;
  /** Called once per tool_use content block (in order). */
  onToolUse?: () => void | Promise<void>;
  /** Called when the init `system` event arrives with a session_id. */
  onSessionInit?: (sessionId: string) => void | Promise<void>;
  /** Called on the final `result` event with its `result` field, if non-empty. */
  onResult?: (resultText: string) => void | Promise<void>;
}

/**
 * Pure: dispatch a single parsed stream-json event to handlers. Exported for tests.
 * Unknown event shapes are silently ignored — Claude Code's stream-json may grow
 * new event types across versions and we only care about a handful.
 */
export async function handleStreamJsonEvent(
  event: unknown,
  handlers: StreamJsonHandlers,
): Promise<void> {
  if (!event || typeof event !== "object") return;
  const e = event as Record<string, unknown>;

  switch (e.type) {
    case "system": {
      const sid = typeof e.session_id === "string" ? e.session_id : undefined;
      if (sid && handlers.onSessionInit) await handlers.onSessionInit(sid);
      return;
    }
    case "assistant": {
      type ContentBlock = { type?: string; text?: string };
      const msg = e.message as { content?: ContentBlock[] } | undefined;
      const blocks = msg?.content ?? [];
      for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
          if (handlers.onText) await handlers.onText(block.text);
        } else if (block.type === "tool_use") {
          if (handlers.onToolUse) await handlers.onToolUse();
        }
      }
      return;
    }
    case "tool_use": {
      // Some stream-json versions emit top-level tool_use events too.
      if (handlers.onToolUse) await handlers.onToolUse();
      return;
    }
    case "result": {
      const resultText = typeof e.result === "string" ? e.result : "";
      if (resultText && handlers.onResult) await handlers.onResult(resultText);
      return;
    }
  }
}

/**
 * Consume a newline-delimited JSON stream from Claude Code `-p --output-format stream-json`,
 * dispatching each event to the supplied handlers. Silently skips unparseable lines.
 */
export async function consumeStreamJsonStream(
  stream: ReadableStream<Uint8Array>,
  handlers: StreamJsonHandlers,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: unknown;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      await handleStreamJsonEvent(event, handlers);
    }
  }

  const tail = buf.trim();
  if (tail) {
    try {
      await handleStreamJsonEvent(JSON.parse(tail), handlers);
    } catch {}
  }
}

export interface RunClaudeOnceResult {
  /** Concatenated text from all assistant text blocks, in order. */
  rawStdout: string;
  stderr: string;
  exitCode: number;
  /** Session ID captured from the `system` init event, if any. */
  sessionId: string | null;
}

async function runClaudeOnce(
  baseArgs: string[],
  model: string,
  api: string,
  baseEnv: Record<string, string>,
  timeoutMs: number = CLAUDE_TIMEOUT_MS,
  cwd?: string
): Promise<RunClaudeOnceResult> {
  // Stream-json captures every text block emitted during a turn — including text
  // emitted before tool calls. Default "text" format only surfaces the final text
  // block and silently drops pre-tool text, producing empty Discord/Telegram replies
  // when the model ended a turn with a tool call (see kalai session 2026-04-16).
  const args = [...baseArgs, "--output-format", "stream-json", "--verbose"];
  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm") args.push("--model", model.trim());

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: buildChildEnv(baseEnv, model, api),
    cwd: cwd ?? PROJECT_DIR,
  });

  let timeoutTimer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => reject(new Error(`Claude session timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  });

  let assistantText = "";
  let fallbackResultText = "";
  let sessionId: string | null = null;

  const handlers: StreamJsonHandlers = {
    onText: (text) => { assistantText += text; },
    onSessionInit: (sid) => { sessionId = sid; },
    onResult: (text) => { fallbackResultText = text; },
  };

  try {
    const [, stderr] = await Promise.race([
      Promise.all([
        consumeStreamJsonStream(proc.stdout, handlers),
        new Response(proc.stderr).text(),
      ]),
      timeoutPromise,
    ]) as [void, string];
    clearTimeout(timeoutTimer!);
    await proc.exited;

    // If the stream yielded no assistant text but the final result event did,
    // use that as a safety net. In practice stream-json always carries assistant
    // text when result has text, so this only kicks in on odd edge cases.
    const rawStdout = assistantText || fallbackResultText;

    return {
      rawStdout,
      stderr,
      exitCode: proc.exitCode ?? 1,
      sessionId,
    };
  } catch (err) {
    clearTimeout(timeoutTimer!);
    try { proc.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);

    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${new Date().toLocaleTimeString()}] ${message}`);

    return {
      rawStdout: "",
      stderr: message,
      exitCode: 124,
      sessionId,
    };
  }
}

const PROJECT_DIR = process.cwd();
function getSessionCwd(sessionKey: string): string {
  return join(SESSIONS_DIR, sessionKey);
}

const DIR_SCOPE_PROMPT = [
  `CRITICAL SECURITY CONSTRAINT: You are scoped to the project directory: ${PROJECT_DIR}`,
  "You MUST NOT read, write, edit, or delete any file outside this directory.",
  "You MUST NOT run bash commands that modify anything outside this directory (no cd /, no /etc, no ~/, no ../.. escapes).",
  "If a request requires accessing files outside the project, refuse and explain why.",
].join("\n");

export async function ensureProjectClaudeMd(): Promise<void> {
  // Preflight-only initialization: never rewrite an existing project CLAUDE.md.
  if (existsSync(PROJECT_CLAUDE_MD)) return;

  const promptContent = (await loadPrompts()).trim();
  const managedBlock = [
    CLAUDECLAW_BLOCK_START,
    promptContent,
    CLAUDECLAW_BLOCK_END,
  ].join("\n");

  let content = "";

  if (existsSync(LEGACY_PROJECT_CLAUDE_MD)) {
    try {
      const legacy = await readFile(LEGACY_PROJECT_CLAUDE_MD, "utf8");
      content = legacy.trim();
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read legacy .claude/CLAUDE.md:`, e);
      return;
    }
  }

  const normalized = content.trim();
  const hasManagedBlock =
    normalized.includes(CLAUDECLAW_BLOCK_START) && normalized.includes(CLAUDECLAW_BLOCK_END);
  const managedPattern = new RegExp(
    `${CLAUDECLAW_BLOCK_START}[\\s\\S]*?${CLAUDECLAW_BLOCK_END}`,
    "m"
  );

  const merged = hasManagedBlock
    ? `${normalized.replace(managedPattern, managedBlock)}\n`
    : normalized
      ? `${normalized}\n\n${managedBlock}\n`
      : `${managedBlock}\n`;

  try {
    await writeFile(PROJECT_CLAUDE_MD, merged, "utf8");
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] Failed to write project CLAUDE.md:`, e);
  }
}

export function buildSecurityArgs(security: SecurityConfig): string[] {
  const args: string[] = ["--dangerously-skip-permissions"];

  switch (security.level) {
    case "locked":
      args.push("--tools", "Read,Grep,Glob");
      break;
    case "strict":
      args.push("--disallowedTools", "Bash,WebSearch,WebFetch");
      break;
    case "moderate":
      // all tools available, scoped to project dir via system prompt
      break;
    case "unrestricted":
      // all tools, no directory restriction
      break;
  }

  if (security.allowedTools.length > 0) {
    args.push("--allowedTools", security.allowedTools.join(" "));
  }
  if (security.disallowedTools.length > 0) {
    args.push("--disallowedTools", security.disallowedTools.join(" "));
  }

  return args;
}

/** Load and concatenate all prompt files from the prompts/ directory. */
async function loadPrompts(): Promise<string> {
  const selectedPromptFiles = [
    join(PROMPTS_DIR, "IDENTITY.md"),
    join(PROMPTS_DIR, "USER.md"),
    join(PROMPTS_DIR, "SOUL.md"),
  ];
  const parts: string[] = [];

  for (const file of selectedPromptFiles) {
    try {
      const content = await Bun.file(file).text();
      if (content.trim()) parts.push(content.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read prompt file ${file}:`, e);
    }
  }

  return parts.join("\n\n");
}

/**
 * Load the heartbeat prompt template.
 * Project-level override takes precedence: place a file at
 * .claude/claudeclaw/prompts/HEARTBEAT.md to fully replace the built-in template.
 */
export async function loadHeartbeatPromptTemplate(): Promise<string> {
  const projectOverride = join(PROJECT_PROMPTS_DIR, "HEARTBEAT.md");
  for (const file of [projectOverride, HEARTBEAT_PROMPT_FILE]) {
    try {
      const content = await Bun.file(file).text();
      if (content.trim()) return content.trim();
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.warn(`[${new Date().toLocaleTimeString()}] Failed to read heartbeat prompt file ${file}:`, e);
      }
    }
  }
  return "";
}

/** Run /compact on the current session to reduce context size. */
export async function runCompact(
  sessionId: string,
  model: string,
  api: string,
  baseEnv: Record<string, string>,
  securityArgs: string[],
  timeoutMs: number
): Promise<boolean> {
  // runClaudeOnce appends --output-format stream-json --verbose.
  const compactArgs = [
    "claude", "-p", "/compact",
    "--resume", sessionId,
    ...securityArgs,
  ];
  console.log(`[${new Date().toLocaleTimeString()}] Running /compact on session ${sessionId.slice(0, 8)}...`);
  const result = await runClaudeOnce(compactArgs, model, api, baseEnv, timeoutMs);
  const success = result.exitCode === 0;
  console.log(`[${new Date().toLocaleTimeString()}] Compact ${success ? "succeeded" : `failed (exit ${result.exitCode})`}`);
  return success;
}

/**
 * High-level compact: resolves session + settings internally.
 * Returns { success, message }.
 */
export async function compactCurrentSession(): Promise<{ success: boolean; message: string }> {
  const existing = await getSession(DEFAULT_SESSION_KEY);
  if (!existing) return { success: false, message: "No active session to compact." };

  const settings = getSettings();
  const securityArgs = buildSecurityArgs(settings.security);
  const baseEnv = getCleanEnv();
  const timeoutMs = settings.sessionTimeoutMs;

  const ok = await runCompact(
    existing.sessionId,
    settings.model,
    settings.api,
    baseEnv,
    securityArgs,
    timeoutMs
  );

  return ok
    ? { success: true, message: `✅ Session compact complete (${existing.sessionId.slice(0, 8)})` }
    : { success: false, message: `❌ Compact failed (${existing.sessionId.slice(0, 8)})` };
}

async function execClaude(name: string, prompt: string, sessionKey: string): Promise<RunResult> {
  await mkdir(LOGS_DIR, { recursive: true });

  const existing = await getSession(sessionKey);
  const isNew = !existing;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join(LOGS_DIR, `${name}-${timestamp}.log`);

  const settings = getSettings();
  const { security, model, api, fallback, agentic } = settings;

  // Determine which model to use based on agentic routing
  let primaryConfig: ModelConfig;
  let taskType = "unknown";
  let routingReasoning = "";

  if (agentic.enabled) {
    const routing = selectModel(prompt, agentic.modes, agentic.defaultMode);
    if (!routing.model) {
      console.warn(`[${new Date().toLocaleTimeString()}] Agentic routing returned empty model, falling back to default`);
      primaryConfig = { model, api };
    } else {
      primaryConfig = { model: routing.model, api };
      taskType = routing.taskType;
      routingReasoning = routing.reasoning;
      console.log(
        `[${new Date().toLocaleTimeString()}] Agentic routing: ${routing.taskType} → ${routing.model} (${routing.reasoning})`
      );
    }
  } else {
    primaryConfig = { model, api };
  }

  const fallbackConfig: ModelConfig = {
    model: fallback?.model ?? "",
    api: fallback?.api ?? "",
  };
  const securityArgs = buildSecurityArgs(security);
  const timeoutMs = settings.sessionTimeoutMs;

  console.log(
    `[${new Date().toLocaleTimeString()}] Running: ${name} (${isNew ? "new session" : `resume ${existing.sessionId.slice(0, 8)}`}, security: ${security.level})`
  );

  // Output format (stream-json) is appended inside runClaudeOnce so session_id
  // and every text block can be captured from the event stream.
  const args = ["claude", "-p", prompt, ...securityArgs];

  if (!isNew) {
    args.push("--resume", existing.sessionId);
  }

  // Build the appended system prompt: prompt files + directory scoping
  // This is passed on EVERY invocation (not just new sessions) because
  // --append-system-prompt does not persist across --resume.
  const promptContent = await loadPrompts();
  const appendParts: string[] = [
    "You are running inside ClaudeClaw.",
  ];
  if (promptContent) appendParts.push(promptContent);

  // Load the project's CLAUDE.md if it exists
  if (existsSync(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim()) appendParts.push(claudeMd.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read project CLAUDE.md:`, e);
    }
  }

  if (security.level !== "unrestricted") appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join("\n\n"));
  }

  const baseEnv = getCleanEnv();

  // Per-session working directory
  const sessionCwd = getSessionCwd(sessionKey);
  await mkdir(sessionCwd, { recursive: true });

  // Per-session memory isolation
  const memoryDir = join(sessionCwd, "memory");
  args.push("--settings", JSON.stringify({ autoMemoryDirectory: memoryDir }));

  let exec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs, sessionCwd);
  const primaryRateLimit = extractRateLimitMessage(exec.rawStdout, exec.stderr);
  let usedFallback = false;

  if (primaryRateLimit && hasModelConfig(fallbackConfig) && !sameModelConfig(primaryConfig, fallbackConfig)) {
    console.warn(
      `[${new Date().toLocaleTimeString()}] Claude limit reached; retrying with fallback${fallbackConfig.model ? ` (${fallbackConfig.model})` : ""}...`
    );
    exec = await runClaudeOnce(args, fallbackConfig.model, fallbackConfig.api, baseEnv, timeoutMs, sessionCwd);
    usedFallback = true;
  }

  const rawStdout = exec.rawStdout;
  const stderr = exec.stderr;
  const exitCode = exec.exitCode;
  let stdout = rawStdout;
  let sessionId = exec.sessionId ?? existing?.sessionId ?? "unknown";
  const rateLimitMessage = extractRateLimitMessage(rawStdout, stderr);

  if (rateLimitMessage) {
    stdout = rateLimitMessage;
  }

  // Persist the session ID that Claude Code reports for new sessions.
  if (!rateLimitMessage && isNew && exitCode === 0 && exec.sessionId) {
    await createSession(sessionKey, exec.sessionId);
    console.log(`[${new Date().toLocaleTimeString()}] Session created: ${exec.sessionId} (key ${sessionKey.slice(0, 8)})`);
  }

  const result: RunResult = {
    stdout,
    stderr,
    exitCode,
  };

  const output = [
    `# ${name}`,
    `Date: ${new Date().toISOString()}`,
    `Session: ${sessionId} (${isNew ? "new" : "resumed"})`,
    `Model config: ${usedFallback ? "fallback" : "primary"}`,
    ...(agentic.enabled ? [`Task type: ${taskType}`, `Routing: ${routingReasoning}`] : []),
    `Prompt: ${prompt}`,
    `Exit code: ${result.exitCode}`,
    "",
    "## Output",
    stdout,
    ...(stderr ? ["## Stderr", stderr] : []),
  ].join("\n");

  await Bun.write(logFile, output);
  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name} → ${logFile}`);

  // --- Auto-compact on timeout (exit 124) ---
  if (COMPACT_TIMEOUT_ENABLED && exitCode === 124 && !isNew && existing) {
    emitCompactEvent({ type: "auto-compact-start" });
    const compactOk = await runCompact(
      existing.sessionId,
      primaryConfig.model,
      primaryConfig.api,
      baseEnv,
      securityArgs,
      timeoutMs
    );
    emitCompactEvent({ type: "auto-compact-done", success: compactOk });

    if (compactOk) {
      console.log(`[${new Date().toLocaleTimeString()}] Retrying ${name} after compact...`);
      const retryExec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs, sessionCwd);
      const retryResult: RunResult = {
        stdout: retryExec.rawStdout,
        stderr: retryExec.stderr,
        exitCode: retryExec.exitCode,
      };
      emitCompactEvent({
        type: "auto-compact-retry",
        success: retryExec.exitCode === 0,
        stdout: retryResult.stdout,
        stderr: retryResult.stderr,
        exitCode: retryResult.exitCode,
      });

      if (retryExec.exitCode === 0) {
        const count = await incrementTurn(sessionKey);
        console.log(`[${new Date().toLocaleTimeString()}] Turn count: ${count} (session ${sessionKey.slice(0, 8)}, after compact + retry)`);
      }
      return retryResult;
    }
  }

  // --- Turn tracking & compact warning ---
  if (exitCode === 0 && !isNew) {
    const turnCount = await incrementTurn(sessionKey);
    console.log(`[${new Date().toLocaleTimeString()}] Turn count: ${turnCount} (session ${sessionKey.slice(0, 8)})`);

    if (turnCount >= COMPACT_WARN_THRESHOLD && existing && !existing.compactWarned) {
      await markCompactWarned(sessionKey);
      emitCompactEvent({ type: "warn", turnCount });
    }
  }

  return result;
}

export async function run(name: string, prompt: string, sessionKey: string = DEFAULT_SESSION_KEY): Promise<RunResult> {
  return enqueue(() => execClaude(name, prompt, sessionKey), sessionKey);
}

async function streamClaude(
  name: string,
  prompt: string,
  onChunk: (text: string) => void,
  onUnblock: () => void
): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true });

  const existing = await getSession(DEFAULT_SESSION_KEY);
  const { security, model, api } = getSettings();
  const securityArgs = buildSecurityArgs(security);

  // stream-json gives us events as they happen — text before tool calls,
  // so we can unblock the UI as soon as Claude acknowledges, not after sub-agents finish.
  // --verbose is required for stream-json to produce output in -p (print) mode.
  const args = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", ...securityArgs];

  if (existing) args.push("--resume", existing.sessionId);

  const promptContent = await loadPrompts();
  const appendParts: string[] = ["You are running inside ClaudeClaw."];
  if (promptContent) appendParts.push(promptContent);

  if (existsSync(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim()) appendParts.push(claudeMd.trim());
    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read project CLAUDE.md:`, err);
    }
  }

  if (security.level !== "unrestricted") appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join("\n\n"));
  }

  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm") args.push("--model", model.trim());

  // Per-session working directory and memory isolation (matches execClaude)
  const sessionCwd = getSessionCwd(DEFAULT_SESSION_KEY);
  await mkdir(sessionCwd, { recursive: true });
  const memoryDir = join(sessionCwd, "memory");
  args.push("--settings", JSON.stringify({ autoMemoryDirectory: memoryDir }));

  const childEnv = buildChildEnv(getCleanEnv(), model, api);

  console.log(`[${new Date().toLocaleTimeString()}] Running: ${name} (stream-json, session: ${existing?.sessionId?.slice(0, 8) ?? "new"})`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv,
    cwd: sessionCwd,
  });

  let unblocked = false;
  let textEmitted = false;
  const maybeUnblock = () => {
    if (unblocked) return;
    unblocked = true;
    onUnblock();
  };

  await consumeStreamJsonStream(proc.stdout, {
    onText: (text) => {
      onChunk(text);
      textEmitted = true;
      maybeUnblock();
    },
    onToolUse: () => { maybeUnblock(); },
    onSessionInit: async (sid) => {
      if (!existing) {
        await createSession(DEFAULT_SESSION_KEY, sid);
        console.log(`[${new Date().toLocaleTimeString()}] Session created (stream-json): ${sid}`);
      }
    },
    onResult: (resultText) => {
      if (!textEmitted) onChunk(resultText);
      maybeUnblock();
    },
  });

  await proc.exited;
  maybeUnblock();

  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name}`);
}

export async function streamUserMessage(
  name: string,
  prompt: string,
  onChunk: (text: string) => void,
  onUnblock: () => void
): Promise<void> {
  return enqueue(() => streamClaude(name, prefixUserMessageWithClock(prompt), onChunk, onUnblock), DEFAULT_SESSION_KEY);
}

function prefixUserMessageWithClock(prompt: string): string {
  try {
    const settings = getSettings();
    const prefix = buildClockPromptPrefix(new Date(), settings.timezoneOffsetMinutes);
    return `${prefix}\n${prompt}`;
  } catch {
    const prefix = buildClockPromptPrefix(new Date(), 0);
    return `${prefix}\n${prompt}`;
  }
}

export async function runUserMessage(name: string, prompt: string, sessionKey?: string): Promise<RunResult> {
  return run(name, prefixUserMessageWithClock(prompt), sessionKey);
}

/**
 * Bootstrap the session: fires Claude with the system prompt so the
 * session is created immediately. No-op if a session already exists.
 */
export async function bootstrap(): Promise<void> {
  const existing = await getSession(DEFAULT_SESSION_KEY);
  if (existing) return;

  console.log(`[${new Date().toLocaleTimeString()}] Bootstrapping new session...`);
  await execClaude("bootstrap", "Wakeup, my friend!", DEFAULT_SESSION_KEY);
  console.log(`[${new Date().toLocaleTimeString()}] Bootstrap complete — session is live.`);
}
