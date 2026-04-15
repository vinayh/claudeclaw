/**
 * Shared chat message handler for Discord, Telegram, and future platforms.
 * Extracts common logic: authorization, built-in commands, skill routing,
 * prompt assembly, response processing, and typing indicators.
 */

import { runUserMessage, compactCurrentSession, type RunResult } from "./runner";
import { getSettings } from "./config";
import { resetDefaultSession, peekDefaultSession, listSessions } from "./sessionManager";
import { resolveSkillPrompt } from "./skills";
import {
  type ChatPlatform,
  extractReactionDirective,
  extractSendFileDirectives,
  getContextUsage,
  formatContextUsage,
  formatSessionStatus,
} from "./chat-utils";

// ---------------------------------------------------------------------------
// Platform adapter interface
// ---------------------------------------------------------------------------

export interface PlatformAdapter {
  readonly platform: ChatPlatform;
  readonly maxMessageLength: number;
  readonly typingIntervalMs: number;

  /** Send a text message, splitting into chunks if needed. */
  sendMessage(chatId: string, text: string, threadId?: string): Promise<void>;
  /** Send a typing indicator. */
  sendTyping(chatId: string, threadId?: string): Promise<void>;
  /** Add a reaction emoji to a message. */
  sendReaction(chatId: string, messageId: string, emoji: string): Promise<void>;
  /** Send a file/document (optional — platforms that don't support it omit this). */
  sendFile?(chatId: string, filePath: string, threadId?: string): Promise<void>;
  /** Platform-specific debug logger. */
  debugLog(message: string): void;
}

// ---------------------------------------------------------------------------
// Chat context (platform-normalized message data)
// ---------------------------------------------------------------------------

export interface ChatContext {
  chatId: string;
  userId: string;
  username: string;
  messageId: string;
  isDM: boolean;
  threadId?: string;
  sessionKey?: string;
  rawContent: string;
  imagePath: string | null;
  voicePath: string | null;
  voiceTranscript: string | null;
  documentInfo: { localPath: string; originalName: string } | null;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export function checkAuthorization(userId: string | undefined, allowedIds: readonly string[]): boolean {
  if (!userId) return false;
  if (allowedIds.length === 0) return true;
  return allowedIds.includes(userId);
}

// ---------------------------------------------------------------------------
// Built-in command handling
// ---------------------------------------------------------------------------

export type BuiltInResult =
  | { handled: true }
  | { handled: false };

const BUILT_IN_COMMANDS = new Set(["/start", "/reset", "/compact", "/status", "/context"]);

export function isBuiltInCommand(command: string | null): boolean {
  return command !== null && BUILT_IN_COMMANDS.has(command);
}

export async function handleBuiltInCommand(
  command: string,
  adapter: PlatformAdapter,
  chatId: string,
  threadId?: string,
): Promise<BuiltInResult> {
  if (command === "/start") {
    await adapter.sendMessage(
      chatId,
      "Hello! Send me a message and I'll respond using Claude.\nUse /reset to start a fresh session.",
      threadId,
    );
    return { handled: true };
  }

  if (command === "/reset") {
    await resetDefaultSession();
    await adapter.sendMessage(chatId, "Global session reset. Next message starts fresh.", threadId);
    return { handled: true };
  }

  if (command === "/compact") {
    await adapter.sendMessage(chatId, "\u23F3 Compacting session...", threadId);
    const result = await compactCurrentSession();
    await adapter.sendMessage(chatId, result.message, threadId);
    return { handled: true };
  }

  if (command === "/status") {
    const session = await peekDefaultSession();
    if (!session) {
      await adapter.sendMessage(chatId, "\uD83D\uDCCA No active session.", threadId);
      return { handled: true };
    }
    const lines = formatSessionStatus(session, getSettings());
    const sessions = await listSessions();
    if (sessions.length > 0) {
      lines.push("", `**Sessions:** ${sessions.length}`);
      for (const ts of sessions.slice(0, 5)) {
        lines.push(`  \`${ts.key.slice(0, 8)}\` \u2192 Session \`${ts.sessionId.slice(0, 8)}\` (${ts.turnCount} turns)`);
      }
      if (sessions.length > 5) {
        lines.push(`  ... and ${sessions.length - 5} more`);
      }
    }
    await adapter.sendMessage(chatId, lines.join("\n"), threadId);
    return { handled: true };
  }

  if (command === "/context") {
    const session = await peekDefaultSession();
    if (!session) {
      await adapter.sendMessage(chatId, "No active session.", threadId);
      return { handled: true };
    }
    try {
      const usage = await getContextUsage(session.sessionId);
      if (!usage) {
        await adapter.sendMessage(chatId, "No usage data found.", threadId);
        return { handled: true };
      }
      const msg = formatContextUsage(usage, session.turnCount ?? 0);
      await adapter.sendMessage(chatId, msg.join("\n"), threadId);
    } catch (err) {
      await adapter.sendMessage(
        chatId,
        `Failed to read context: ${err instanceof Error ? err.message : err}`,
        threadId,
      );
    }
    return { handled: true };
  }

  return { handled: false };
}

// ---------------------------------------------------------------------------
// Skill routing
// ---------------------------------------------------------------------------

export async function resolveSkill(
  command: string,
  debugLog: (msg: string) => void,
): Promise<string | null> {
  try {
    const context = await resolveSkillPrompt(command);
    if (context) {
      debugLog(`Skill resolved for ${command}: ${context.length} chars`);
    }
    return context;
  } catch (err) {
    debugLog(`Skill resolution failed for ${command}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command extraction
// ---------------------------------------------------------------------------

export function extractCommand(text: string): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0];
  if (!firstToken.startsWith("/")) return null;
  // Strip @botname suffix (Telegram sends "/cmd@botname")
  return firstToken.split("@", 1)[0].toLowerCase();
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

export function buildPrompt(
  adapter: PlatformAdapter,
  ctx: ChatContext,
  skillContext: string | null,
  command: string | null,
): string {
  const platformName = adapter.platform === "discord" ? "Discord" : "Telegram";
  const parts = [`[${platformName} from ${ctx.username}]`];

  if (ctx.threadId) parts.push(`[thread:${ctx.threadId}]`);

  if (skillContext && command) {
    const args = ctx.rawContent.trim().slice(command.length).trim();
    parts.push(`<command-name>${command}</command-name>`);
    parts.push(skillContext);
    if (args) parts.push(`User arguments: ${args}`);
  } else if (ctx.rawContent.trim()) {
    parts.push(`Message: ${ctx.rawContent}`);
  }

  if (ctx.imagePath) {
    parts.push(`Image path: ${ctx.imagePath}`);
    parts.push("The user attached an image. Inspect this image file directly before answering.");
  } else if (ctx.imagePath === null && ctx.rawContent === "" && false) {
    // placeholder — actual "download failed" is handled by caller setting imagePath to null
  }

  if (ctx.voiceTranscript) {
    parts.push(`Voice transcript: ${ctx.voiceTranscript}`);
    parts.push("The user attached voice audio. Use the transcript as their spoken message.");
  }

  if (ctx.documentInfo) {
    parts.push(`Document path: ${ctx.documentInfo.localPath}`);
    parts.push(`Original filename: ${ctx.documentInfo.originalName}`);
    parts.push("The user attached a document. Read and process this file directly.");
  }

  return parts.join("\n");
}

/**
 * Append media failure hints to an existing prompt.
 * Called by the platform after building the base prompt, to add fallback messages
 * for attachments that failed to download.
 */
export function appendMediaFailures(
  prompt: string,
  failures: { image?: boolean; voice?: boolean; document?: boolean },
): string {
  const parts = [prompt];
  if (failures.image) {
    parts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
  }
  if (failures.voice) {
    parts.push(
      "The user attached voice audio, but it could not be transcribed. Respond and ask them to resend a clearer clip.",
    );
  }
  if (failures.document) {
    parts.push("The user attached a document, but downloading it failed. Respond and ask them to resend.");
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Response processing
// ---------------------------------------------------------------------------

export async function processResponse(
  adapter: PlatformAdapter,
  ctx: ChatContext,
  result: RunResult,
): Promise<void> {
  if (result.exitCode !== 0) {
    await adapter.sendMessage(
      ctx.chatId,
      `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`,
      ctx.threadId,
    );
    return;
  }

  const { cleanedText: afterReact, reactionEmoji } = extractReactionDirective(result.stdout || "");
  const { cleanedText, filePaths } = extractSendFileDirectives(afterReact);

  if (reactionEmoji) {
    await adapter.sendReaction(ctx.chatId, ctx.messageId, reactionEmoji).catch((err) => {
      console.error(
        `[${adapter.platform}] Failed to send reaction for ${ctx.username}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  if (cleanedText) {
    await adapter.sendMessage(ctx.chatId, cleanedText, ctx.threadId);
  }

  if (adapter.sendFile) {
    for (const fp of filePaths) {
      try {
        await adapter.sendFile(ctx.chatId, fp, ctx.threadId);
      } catch (err) {
        console.error(
          `[${adapter.platform}] Failed to send file for ${ctx.username}: ${err instanceof Error ? err.message : err}`,
        );
        await adapter.sendMessage(ctx.chatId, `Failed to send file: ${fp.split("/").pop()}`, ctx.threadId);
      }
    }
  }

  if (!cleanedText && filePaths.length === 0) {
    await adapter.sendMessage(ctx.chatId, "(empty response)", ctx.threadId);
  }
}

// ---------------------------------------------------------------------------
// Typing indicator wrapper
// ---------------------------------------------------------------------------

export async function withTypingIndicator<T>(
  adapter: PlatformAdapter,
  chatId: string,
  threadId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  await adapter.sendTyping(chatId, threadId);
  const interval = setInterval(() => adapter.sendTyping(chatId, threadId), adapter.typingIntervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function logIncomingMessage(
  platform: string,
  label: string,
  text: string,
  mediaSuffix: string,
): void {
  console.log(
    `[${new Date().toLocaleTimeString()}] ${platform} ${label}${mediaSuffix}: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`,
  );
}

// ---------------------------------------------------------------------------
// Full message handler (shared pipeline)
// ---------------------------------------------------------------------------

/**
 * Handle an incoming user message through the shared pipeline:
 * auth check → built-in commands → skill routing → prompt assembly → run → response.
 *
 * Platform-specific logic (attachment downloading, thread management, etc.)
 * should be done BEFORE calling this function, populating the ChatContext.
 *
 * @param adapter Platform-specific adapter
 * @param ctx Normalized chat context
 * @param opts Options for media failure hints
 * @returns true if the message was handled, false if it was skipped (e.g. unauthorized)
 */
export async function handleChatMessage(
  adapter: PlatformAdapter,
  ctx: ChatContext,
  opts?: {
    /** Set if image attachment existed but download failed */
    imageDownloadFailed?: boolean;
    /** Set if voice existed but transcription failed */
    voiceTranscribeFailed?: boolean;
    /** Set if document existed but download failed */
    documentDownloadFailed?: boolean;
    /** Pre-extracted command (if platform already parsed it) */
    command?: string | null;
    /** Skip built-in command handling (e.g. Discord handles via interactions) */
    skipBuiltInCommands?: boolean;
  },
): Promise<boolean> {
  const command = opts?.command ?? extractCommand(ctx.rawContent);

  // Built-in commands
  if (!opts?.skipBuiltInCommands && isBuiltInCommand(command)) {
    const result = await handleBuiltInCommand(command!, adapter, ctx.chatId, ctx.threadId);
    if (result.handled) return true;
  }

  // Skill routing
  let skillContext: string | null = null;
  if (command && !isBuiltInCommand(command)) {
    skillContext = await resolveSkill(command, (msg) => adapter.debugLog(msg));
  }

  // Prompt assembly
  let prompt = buildPrompt(adapter, ctx, skillContext, command);
  prompt = appendMediaFailures(prompt, {
    image: opts?.imageDownloadFailed,
    voice: opts?.voiceTranscribeFailed,
    document: opts?.documentDownloadFailed,
  });

  // Run
  const result = await runUserMessage(
    adapter.platform,
    prompt,
    ctx.sessionKey,
  );

  // Process response
  await processResponse(adapter, ctx, result);
  return true;
}
