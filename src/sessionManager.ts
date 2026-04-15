import { join } from "path";
import { unlink, readdir } from "fs/promises";
import * as paths from "./paths";

/** Key for the shared session used by heartbeat, cron, telegram, web UI, etc. */
export const DEFAULT_SESSION_KEY = "default";

export interface Session {
  sessionId: string;
  key: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  compactWarned: boolean;
}

interface SessionsData {
  sessions: Record<string, Session>;
}

let sessionsCache: SessionsData | null = null;

async function loadSessions(): Promise<SessionsData> {
  if (sessionsCache) return sessionsCache;
  try {
    const raw = await Bun.file(paths.SESSIONS_FILE).json();
    // Migrate from legacy "threads"/"threadId" format
    if (raw.threads && !raw.sessions) {
      raw.sessions = {};
      for (const [k, v] of Object.entries(raw.threads)) {
        const entry = v as any;
        raw.sessions[k] = { ...entry, key: entry.threadId ?? entry.key ?? k };
        delete raw.sessions[k].threadId;
      }
      delete raw.threads;
    }
    sessionsCache = raw;
    return sessionsCache!;
  } catch {
    sessionsCache = { sessions: {} };
    return sessionsCache;
  }
}

async function saveSessions(data: SessionsData): Promise<void> {
  sessionsCache = data;
  await Bun.write(paths.SESSIONS_FILE, JSON.stringify(data, null, 2) + "\n");
}

/** Get session by key. Returns null if no session exists yet. */
export async function getSession(
  key: string,
): Promise<{ sessionId: string; turnCount: number; compactWarned: boolean } | null> {
  const data = await loadSessions();
  const session = data.sessions[key];
  if (!session) return null;

  if (typeof session.turnCount !== "number") session.turnCount = 0;
  if (typeof session.compactWarned !== "boolean") session.compactWarned = false;

  session.lastUsedAt = new Date().toISOString();
  await saveSessions(data);

  return {
    sessionId: session.sessionId,
    turnCount: session.turnCount,
    compactWarned: session.compactWarned,
  };
}

/** Create a new session after Claude outputs a session_id. */
export async function createSession(key: string, sessionId: string): Promise<void> {
  const data = await loadSessions();
  data.sessions[key] = {
    sessionId,
    key,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false,
  };
  await saveSessions(data);
}

/** Remove a session (e.g., on channel/thread delete or archive). */
export async function removeSession(key: string): Promise<void> {
  const data = await loadSessions();
  if (!data.sessions[key]) return;
  delete data.sessions[key];
  await saveSessions(data);
}

/** Increment turn counter for a session. */
export async function incrementTurn(key: string): Promise<number> {
  const data = await loadSessions();
  const session = data.sessions[key];
  if (!session) return 0;
  if (typeof session.turnCount !== "number") session.turnCount = 0;
  session.turnCount += 1;
  await saveSessions(data);
  return session.turnCount;
}

/** Mark compact warning sent for a session. */
export async function markCompactWarned(key: string): Promise<void> {
  const data = await loadSessions();
  const session = data.sessions[key];
  if (!session) return;
  session.compactWarned = true;
  await saveSessions(data);
}

/** List all active sessions. */
export async function listSessions(): Promise<Session[]> {
  const data = await loadSessions();
  return Object.values(data.sessions);
}

/** @internal Reset in-memory cache (for testing only). */
export function _resetCache(): void {
  sessionsCache = null;
}

/** Peek at a session without updating lastUsedAt. */
export async function peekSessionEntry(key: string): Promise<Session | null> {
  const data = await loadSessions();
  return data.sessions[key] ?? null;
}

// ---------------------------------------------------------------------------
// Default session helpers (replacing legacy sessions.ts)
// ---------------------------------------------------------------------------

/** Peek at the default session without mutating lastUsedAt. */
export async function peekDefaultSession(): Promise<Session | null> {
  return peekSessionEntry(DEFAULT_SESSION_KEY);
}

/** Remove the default session entry (equivalent to legacy resetSession). */
export async function resetDefaultSession(): Promise<void> {
  await removeSession(DEFAULT_SESSION_KEY);
  // Also clean up the legacy session.json if it exists
  try { await unlink(paths.SESSION_FILE); } catch { /* already gone */ }
}

/** Back up the default session to a numbered .backup file and remove the active entry. */
export async function backupDefaultSession(): Promise<string | null> {
  const session = await peekSessionEntry(DEFAULT_SESSION_KEY);
  if (!session) return null;

  // Find next backup index
  let files: string[];
  try {
    files = await readdir(paths.HEARTBEAT_DIR);
  } catch {
    files = [];
  }
  const indices = files
    .filter((f) => /^session_\d+\.backup$/.test(f))
    .map((f) => Number(f.match(/^session_(\d+)\.backup$/)![1]));
  const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

  const backupName = `session_${nextIndex}.backup`;
  const backupPath = join(paths.HEARTBEAT_DIR, backupName);

  // Write session data as the backup file
  await Bun.write(backupPath, JSON.stringify(session, null, 2) + "\n");

  // Remove from active sessions
  await removeSession(DEFAULT_SESSION_KEY);

  // Also clean up legacy session.json if it exists
  try { await unlink(paths.SESSION_FILE); } catch { /* already gone */ }

  return backupName;
}
