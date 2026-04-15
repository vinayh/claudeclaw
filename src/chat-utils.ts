/**
 * Shared utilities for chat platforms (Telegram, Discord).
 * Centralizes directive extraction, context window parsing,
 * session status formatting, and inbox path helpers.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HEARTBEAT_DIR } from "./paths";
import type { Session } from "./sessionManager";
import type { Settings } from "./config";

// ---------------------------------------------------------------------------
// Chat platform enum
// ---------------------------------------------------------------------------

export enum ChatPlatform {
  Telegram = "telegram",
  Discord = "discord",
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getInboxDir(platform: ChatPlatform): string {
  return join(HEARTBEAT_DIR, "inbox", platform);
}

// ---------------------------------------------------------------------------
// Directive extraction (shared by Telegram + Discord)
// ---------------------------------------------------------------------------

export function extractReactionDirective(text: string): {
  cleanedText: string;
  reactionEmoji: string | null;
} {
  let reactionEmoji: string | null = null;
  const cleanedText = text
    .replace(/\[react:([^\]\r\n]+)\]/gi, (_match, raw) => {
      const candidate = String(raw).trim();
      if (!reactionEmoji && candidate) reactionEmoji = candidate;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedText, reactionEmoji };
}

export function extractSendFileDirectives(text: string): {
  cleanedText: string;
  filePaths: string[];
} {
  const filePaths: string[] = [];
  const cleanedText = text
    .replace(/\[send-file:([^\]\r\n]+)\]/gi, (_match, raw) => {
      const candidate = String(raw).trim();
      if (candidate) filePaths.push(candidate);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedText, filePaths };
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

export function buildProgressBar(current: number, max: number, width = 20): string {
  const ratio = Math.min(current / max, 1);
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Context window usage
// ---------------------------------------------------------------------------

export interface ContextUsage {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  totalContext: number;
  totalOutput: number;
  maxContext: number;
}

function getConversationJsonlPath(sessionId: string): string {
  const projectSlug = process.cwd().replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", projectSlug, `${sessionId}.jsonl`);
}

export async function getContextUsage(sessionId: string): Promise<ContextUsage | null> {
  const jsonlPath = getConversationJsonlPath(sessionId);
  if (!existsSync(jsonlPath)) return null;

  const raw = await readFile(jsonlPath, "utf8");
  const lines = raw.trim().split("\n");
  let lastUsage: Record<string, number> | null = null;
  let totalOutput = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.message?.usage) lastUsage = obj.message.usage;
      if (obj.message?.usage?.output_tokens) totalOutput += obj.message.usage.output_tokens;
    } catch {}
  }
  if (!lastUsage) return null;

  const input = lastUsage.input_tokens ?? 0;
  const cacheCreation = lastUsage.cache_creation_input_tokens ?? 0;
  const cacheRead = lastUsage.cache_read_input_tokens ?? 0;
  const maxContext = 200000;

  return {
    input,
    cacheCreation,
    cacheRead,
    totalContext: input + cacheCreation + cacheRead,
    totalOutput,
    maxContext,
  };
}

export function formatContextUsage(usage: ContextUsage, turnCount: number): string[] {
  const pct = ((usage.totalContext / usage.maxContext) * 100).toFixed(1);
  const bar = buildProgressBar(usage.totalContext, usage.maxContext);
  return [
    "📐 **Context Window**",
    `${bar} ${pct}%`,
    "",
    `Total: \`${usage.totalContext.toLocaleString()}\` / \`${usage.maxContext.toLocaleString()}\` tokens`,
    `├ Input: \`${usage.input.toLocaleString()}\``,
    `├ Cache creation: \`${usage.cacheCreation.toLocaleString()}\``,
    `├ Cache read: \`${usage.cacheRead.toLocaleString()}\``,
    `└ Output (cumulative): \`${usage.totalOutput.toLocaleString()}\``,
    "",
    `Turns: ${turnCount}`,
  ];
}

// ---------------------------------------------------------------------------
// Session status formatting
// ---------------------------------------------------------------------------

export function formatSessionStatus(session: Session, settings: Settings): string[] {
  return [
    "📊 **Session Status**",
    `Session: \`${session.sessionId.slice(0, 8)}\``,
    `Turns: ${session.turnCount ?? 0}`,
    `Model: ${settings.model || "default"}`,
    `Security: ${settings.security.level}`,
    `Created: ${session.createdAt}`,
    `Last used: ${session.lastUsedAt}`,
    `Compact warned: ${session.compactWarned ? "yes" : "no"}`,
  ];
}
