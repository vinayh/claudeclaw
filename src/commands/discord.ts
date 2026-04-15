import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  type Message,
  type Interaction,
  type Guild,
  type TextBasedChannel,
  type Attachment,
  type ThreadChannel,
} from "discord.js";
import { ensureProjectClaudeMd, run, compactCurrentSession } from "../runner";
import { getSettings, loadSettings } from "../config";
import { listSessions, removeSession, peekSessionEntry, resetDefaultSession, peekDefaultSession } from "../sessionManager";
import { homedir } from "node:os";
import { transcribeAudioToText } from "../whisper";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  ChatPlatform,
  getInboxDir,
  getContextUsage,
  formatContextUsage,
  formatSessionStatus,
} from "../chat-utils";
import {
  type PlatformAdapter,
  type ChatContext,
  downloadAndTranscribe,
  handleBuiltInCommand,
  handleChatMessage,
  logIncomingMessage,
  withTypingIndicator,
} from "../chat-handler";

// --- Module state ---

let client: Client | null = null;
let discordDebug = false;

function debugLog(message: string): void {
  if (!discordDebug) return;
  console.log(`[Discord][debug] ${message}`);
}

// --- Discord adapter for shared chat handler ---

function createAdapter(): PlatformAdapter {
  return {
    platform: ChatPlatform.Discord,
    maxMessageLength: 2000,
    typingIntervalMs: 8000,
    debug: discordDebug,

    async sendMessage(chatId: string, text: string, _threadId?: string): Promise<void> {
      const normalized = text.replace(/\[react:[^\]\r\n]+\]/gi, "").trim();
      if (!normalized) return;
      const channel = await client?.channels.fetch(chatId);
      if (!channel?.isTextBased()) return;
      const MAX_LEN = 2000;
      for (let i = 0; i < normalized.length; i += MAX_LEN) {
        await (channel as TextBasedChannel).send(normalized.slice(i, i + MAX_LEN));
      }
    },

    async sendTyping(chatId: string, _threadId?: string): Promise<void> {
      try {
        const channel = await client?.channels.fetch(chatId);
        if (channel?.isTextBased()) await (channel as TextBasedChannel).sendTyping();
      } catch { /* best effort */ }
    },

    async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
      try {
        const channel = await client?.channels.fetch(chatId);
        if (channel?.isTextBased()) {
          const msg = await (channel as TextBasedChannel).messages.fetch(messageId);
          await msg.react(emoji);
        }
      } catch { /* best effort */ }
    },

    async sendFile(chatId: string, filePath: string, _threadId?: string): Promise<void> {
      const channel = await client?.channels.fetch(chatId);
      if (!channel?.isTextBased()) return;
      await (channel as TextBasedChannel).send({ files: [filePath] });
    },

    debugLog,
  };
}

// --- Attachment handling ---

function isImageAttachment(a: Attachment): boolean {
  return Boolean(a.contentType?.startsWith("image/"));
}

function isVoiceAttachment(a: Attachment): boolean {
  if ((a.flags?.bitfield ?? 0) & (1 << 13)) return true; // IS_VOICE_MESSAGE
  return Boolean(a.contentType?.startsWith("audio/"));
}

async function downloadAttachment(
  attachment: Attachment,
  type: "image" | "voice",
): Promise<string | null> {
  const dir = getInboxDir(ChatPlatform.Discord);
  await mkdir(dir, { recursive: true });

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Discord attachment download failed: ${response.status}`);

  const ext = extname(attachment.name ?? "") || (type === "voice" ? ".ogg" : ".jpg");
  const filename = `${attachment.id}-${Date.now()}${ext}`;
  const localPath = join(dir, filename);

  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  debugLog(`Attachment downloaded: ${localPath} (${bytes.length} bytes)`);
  return localPath;
}

// --- AI-powered thread intent classifier ---

interface ThreadIntent {
  action: "hire" | "fire";
  names: string[];
}

async function classifyThreadIntent(text: string): Promise<ThreadIntent | null> {
  const systemPrompt = `You classify user messages into thread management intents.

If the user wants to CREATE/SPAWN/DEPLOY threads (e.g. "hire X", "\u6D3E\u51FA X", "\u53EB X \u51FA\u4F86", "\u6D3E X \u53BB\u6253", "\u958B X", "\u5EFA\u7ACB X"):
Return: {"action":"hire","names":["name1","name2"]}

If the user wants to DELETE/REMOVE threads (e.g. "fire X", "\u64A4\u56DE X", "\u628A X \u53EB\u56DE\u4F86", "\u522A X", "\u95DC X"):
Return: {"action":"fire","names":["name1","name2"]}

If the message is NOT about thread management, return: null

Rules:
- Extract individual names. "\u6843\u5712\u4E09\u7D50\u7FA9" = ["\u5289\u5099","\u95DC\u7FBD","\u5F35\u98DB"]. "\u4E94\u864E\u5C07" = ["\u95DC\u7FBD","\u5F35\u98DB","\u8D99\u96F2","\u99AC\u8D85","\u9EC3\u5FE0"].
- Common patterns: \u6D3E/\u6D3E\u51FA/\u51FA\u5F81/\u4E0A\u9663/\u8FCE\u6230/\u51FA\u6230 = hire. \u64A4/\u64A4\u56DE/\u6536\u56DE/\u53EB\u56DE\u4F86/\u6EFE = fire.
- Return ONLY valid JSON or the word null. No explanation.`;

  try {
    const { execSync } = await import("node:child_process");
    const input = `${systemPrompt}\n\n---\nUser message: ${text}`;
    const result = execSync(
      `claude --model claude-sonnet-4-20250514 --print --output-format text`,
      {
        input,
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, HOME: homedir() },
      },
    ).trim();

    if (!result || result === "null") return null;
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as ThreadIntent;
  } catch (err) {
    console.error(`[Discord] Intent classifier error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// --- Guild trigger logic ---

function guildTriggerReason(message: Message): string | null {
  const botId = client?.user?.id;
  if (botId && message.reference?.messageId) {
    // Check if replying to the bot
    const refMsg = message.channel.messages.cache.get(message.reference.messageId);
    if (refMsg?.author.id === botId) return "reply_to_bot";
  }
  if (botId && message.mentions.users.has(botId)) return "mention";

  const config = getSettings().discord;
  if (config.listenChannels.includes(message.channelId)) return "listen_channel";

  // Thread whose parent is a listen channel
  if (message.channel.isThread() && message.channel.parentId) {
    if (config.listenChannels.includes(message.channel.parentId)) return "listen_channel_thread";
  }

  return null;
}

// --- Message handler ---

async function handleMessageCreate(message: Message): Promise<void> {
  const config = getSettings().discord;

  if (message.author.bot) return;

  const userId = message.author.id;
  const channelId = message.channelId;
  const isDM = !message.guild;
  const isGuild = !!message.guild;
  const content = message.content;

  // Guild trigger check
  const triggerReason = isGuild ? guildTriggerReason(message) : "direct_message";
  if (isGuild && !triggerReason) return;

  debugLog(`Handle message channel=${channelId} from=${userId} reason=${triggerReason} text="${content.slice(0, 80)}"`);

  // Detect attachments
  const imageAttachments = message.attachments.filter(isImageAttachment);
  const voiceAttachments = message.attachments.filter(isVoiceAttachment);
  const hasImage = imageAttachments.size > 0;
  const hasVoice = voiceAttachments.size > 0;

  if (!content.trim() && !hasImage && !hasVoice) return;

  // Strip bot mention
  let cleanContent = content;
  const botId = client?.user?.id;
  if (botId) {
    cleanContent = cleanContent.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
  }

  const label = message.author.username;
  const mediaParts = [hasImage ? "image" : "", hasVoice ? "voice" : ""].filter(Boolean);
  const mediaSuffix = mediaParts.length > 0 ? ` [${mediaParts.join("+")}]` : "";
  logIncomingMessage("Discord", label, cleanContent, mediaSuffix);

  const adapter = createAdapter();

  await withTypingIndicator(adapter, channelId, undefined, async () => {
    // Download attachments via shared handler
    const firstImage = imageAttachments.first();
    const firstVoice = voiceAttachments.first();
    const attachments = await downloadAndTranscribe({
      hasImage,
      hasVoice,
      hasDocument: false,
      downloadImage: () => downloadAttachment(firstImage!, "image"),
      downloadVoice: () => downloadAttachment(firstVoice!, "voice"),
      downloadDocument: async () => null,
    }, adapter);

    // Thread management: AI-powered intent classification (Discord-specific)
    if (isGuild && cleanContent.length < 200) {
      const intent = await classifyThreadIntent(cleanContent);
      if (intent && intent.action === "hire" && intent.names.length > 0) {
        const results: string[] = [];
        for (const threadName of intent.names) {
          try {
            const channel = await client!.channels.fetch(channelId);
            if (!channel?.isTextBased() || channel.isDMBased()) continue;
            const thread = await (channel as any).threads.create({
              name: threadName,
              type: ChannelType.PublicThread,
              autoArchiveDuration: 4320,
            }) as ThreadChannel;
            await thread.send(`\uD83E\uDDF5 Thread **${threadName}** created with independent session. Start chatting!`);
            results.push(`\u2705 **${threadName}** \u2192 <#${thread.id}>`);
            console.log(`[Discord] Thread created: ${thread.id} name="${threadName}" parent=${channelId}`);
          } catch (err) {
            results.push(`\u274C **${threadName}** \u2014 ${err instanceof Error ? err.message : err}`);
          }
        }
        await adapter.sendMessage(channelId, results.join("\n"));
        return;
      }

      if (intent && intent.action === "fire" && intent.names.length > 0) {
        const results: string[] = [];
        const channel = await client!.channels.fetch(channelId);
        if (channel?.isTextBased() && !channel.isDMBased() && "threads" in channel) {
          const activeThreads = await (channel as any).threads.fetchActive();
          for (const targetName of intent.names) {
            const targetLower = targetName.toLowerCase();
            const found = activeThreads.threads.find((t: ThreadChannel) => t.name.toLowerCase() === targetLower);
            if (found) {
              try {
                await removeSession(found.id);
                await found.delete();
                results.push(`\uD83D\uDDD1\uFE0F **${targetName}** \u2014 deleted`);
              } catch (err) {
                results.push(`\u274C **${targetName}** \u2014 ${err instanceof Error ? err.message : err}`);
              }
            } else {
              results.push(`\u274C **${targetName}** \u2014 not found`);
            }
          }
        }
        await adapter.sendMessage(channelId, results.join("\n"));
        return;
      }
    }

    // Session key: listenChannels use global session; guild channels/threads get their own
    const isListenChannel = config.listenChannels.includes(channelId);
    const sessionKey = (isGuild && !isListenChannel) ? channelId : undefined;

    // Shared message handling pipeline (auth, commands, skill, prompt, run, response, errors)
    await handleChatMessage(adapter, {
      chatId: channelId,
      userId,
      username: label,
      messageId: message.id,
      isDM,
      sessionKey,
      rawContent: cleanContent,
      ...attachments,
    }, {
      allowedUserIds: config.allowedUserIds,
      skipBuiltInCommands: true, // Discord handles built-ins via slash command interactions
      failures: attachments.failures,
    });
  });
}

// --- Interaction handler (slash commands + secretary buttons) ---

async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  const config = getSettings().discord;

  if (interaction.isChatInputCommand()) {
    const actorId = interaction.user.id;
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(actorId)) {
      await interaction.reply({ content: "Unauthorized.", ephemeral: true });
      return;
    }

    // Create a thin adapter that wraps interaction.reply as sendMessage
    // so we can reuse the shared built-in command handler
    let replied = false;
    const interactionAdapter: PlatformAdapter = {
      ...createAdapter(),
      async sendMessage(_chatId: string, text: string, _threadId?: string): Promise<void> {
        if (!replied) {
          await interaction.reply({ content: text });
          replied = true;
        } else {
          await interaction.followUp({ content: text });
        }
      },
    };

    const command = `/${interaction.commandName}`;

    // Special handling for /compact (needs deferred reply + edit)
    if (command === "/compact") {
      await interaction.reply({ content: "\u23F3 Compacting session..." });
      const result = await compactCurrentSession();
      await interaction.editReply({ content: result.message });
      return;
    }

    // Use shared built-in command handler for /start, /reset, /status, /context
    const chatId = interaction.channelId;
    const handled = await handleBuiltInCommand(command, interactionAdapter, chatId);
    if (!handled) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
    }
    return;
  }

  // Button interactions — secretary workflow
  if (interaction.isButton()) {
    const customId = interaction.customId;
    const secMatch = customId.match(/^sec_(yes|no)_([0-9a-f]{8})$/);
    if (secMatch) {
      const action = secMatch[1];
      const pendingId = secMatch[2];
      let responseText = "Server error";
      try {
        const resp = await fetch(`http://127.0.0.1:9999/confirm/${pendingId}/${action}`);
        const result = (await resp.json()) as { ok: boolean };
        responseText = action === "yes" && result.ok ? "Sent!" : result.ok ? "Dismissed" : "Not found";
      } catch { /* server not running */ }
      await interaction.reply({ content: responseText, ephemeral: true });
      return;
    }

    await interaction.reply({ content: "OK", ephemeral: true });
    return;
  }

  // Default ack
  if (interaction.isRepliable()) {
    await interaction.reply({ content: "OK", ephemeral: true });
  }
}

// --- Guild join handler ---

async function handleGuildCreate(guild: Guild): Promise<void> {
  const config = getSettings().discord;

  const channel = guild.systemChannel;
  if (!channel) return;

  // Skip guilds we were already in (GUILD_CREATE fires for existing guilds on READY)
  // discord.js Client fires guildCreate for new guilds only when using partials correctly
  // but we check guild.joinedAt as a heuristic
  const joinedAt = guild.joinedAt;
  if (joinedAt && Date.now() - joinedAt.getTime() > 30000) return;

  console.log(`[Discord] Joined guild: ${guild.name} (${guild.id})`);

  const eventPrompt =
    `[Discord system event] I was added to a guild.\n` +
    `Guild name: ${guild.name}\n` +
    `Guild id: ${guild.id}\n` +
    "Write a short first message for the server. Confirm I was added and explain how to trigger me (mention or reply).";

  try {
    const result = await run("discord", eventPrompt);
    if (result.exitCode !== 0) {
      await channel.send("I was added to this server. Mention me to start.");
      return;
    }
    await channel.send(result.stdout || "I was added to this server.");
  } catch {
    await channel.send("I was added to this server. Mention me to start.");
  }
}

// --- Slash command registration ---

async function registerSlashCommands(): Promise<void> {
  if (!client?.application) return;

  const commands = [
    { name: "start", description: "Show welcome message and usage instructions" },
    { name: "reset", description: "Reset the global session for a fresh start" },
    { name: "compact", description: "Compact session to reduce context size" },
    { name: "status", description: "Show current session status" },
    { name: "context", description: "Show context window usage" },
  ];

  await client.application.commands.set(commands);
  debugLog("Slash commands registered");
}

// --- Client lifecycle ---

function setupEventHandlers(): void {
  if (!client) return;

  client.on("ready", () => {
    console.log(`[Discord] Ready as ${client!.user?.username} (${client!.user?.id})`);
    registerSlashCommands().catch((err) =>
      console.error(`[Discord] Failed to register slash commands: ${err}`),
    );
  });

  client.on("messageCreate", (message) => {
    handleMessageCreate(message).catch((err) =>
      console.error(`[Discord] messageCreate unhandled:`, err),
    );
  });

  client.on("interactionCreate", (interaction) => {
    handleInteractionCreate(interaction).catch((err) =>
      console.error(`[Discord] interactionCreate unhandled:`, err),
    );
  });

  client.on("guildCreate", (guild) => {
    handleGuildCreate(guild).catch((err) =>
      console.error(`[Discord] guildCreate unhandled:`, err),
    );
  });

  // Thread cleanup on deletion/archival
  client.on("threadDelete", (thread) => {
    removeSession(thread.id).catch((err) =>
      console.error(`[Discord] Failed to cleanup session for deleted thread: ${err}`),
    );
    debugLog(`Thread deleted: ${thread.id}`);
  });

  client.on("threadUpdate", (oldThread, newThread) => {
    if (newThread.archived) {
      removeSession(newThread.id).catch((err) =>
        console.error(`[Discord] Failed to cleanup archived thread session: ${err}`),
      );
      debugLog(`Thread archived: ${newThread.id}`);
    }
  });
}

// --- Exports ---

/** Send a message to a specific channel (used by heartbeat forwarding). */
export async function sendMessage(
  _token: string,
  channelId: string,
  text: string,
  components?: unknown[],
): Promise<void> {
  const channel = await client?.channels.fetch(channelId);
  if (!channel?.isTextBased()) return;
  const normalized = text.replace(/\[react:[^\]\r\n]+\]/gi, "").trim();
  if (!normalized) return;
  const MAX_LEN = 2000;
  for (let i = 0; i < normalized.length; i += MAX_LEN) {
    await (channel as TextBasedChannel).send(normalized.slice(i, i + MAX_LEN));
  }
}

/** Send a DM to a user (used by heartbeat forwarding). */
export async function sendMessageToUser(
  _token: string,
  userId: string,
  text: string,
): Promise<void> {
  const user = await client?.users.fetch(userId);
  if (!user) return;
  const normalized = text.replace(/\[react:[^\]\r\n]+\]/gi, "").trim();
  if (!normalized) return;
  const MAX_LEN = 2000;
  for (let i = 0; i < normalized.length; i += MAX_LEN) {
    await user.send(normalized.slice(i, i + MAX_LEN));
  }
}

/** Stop client and clear state (used for token rotation/hot reload). */
export function stopGateway(): void {
  if (client) {
    client.destroy();
    client = null;
  }
}

/** Start discord.js client (called by start.ts when token is configured). */
export function startGateway(debug = false): void {
  discordDebug = debug;
  const config = getSettings().discord;

  if (client) stopGateway();

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel], // Required for DM support
  });

  setupEventHandlers();

  console.log("Discord bot started (discord.js)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (config.listenChannels.length > 0) {
    console.log(`  Listen channels: ${config.listenChannels.join(", ")}`);
  }
  if (discordDebug) console.log("  Debug: enabled");

  (async () => {
    await ensureProjectClaudeMd();
    await client!.login(config.token);
  })().catch((err) => {
    console.error(`[Discord] Fatal: ${err}`);
  });
}

process.on("SIGTERM", () => stopGateway());
process.on("SIGINT", () => stopGateway());

/** Standalone entry point (bun run src/index.ts discord). */
export async function discord() {
  await loadSettings();
  await ensureProjectClaudeMd();
  const config = getSettings().discord;

  if (!config.token) {
    console.error("Discord token not configured. Set discord.token in .claude/claudeclaw/settings.json");
    process.exit(1);
  }

  discordDebug = true;
  startGateway(true);
  await new Promise(() => {}); // Keep process alive
}
