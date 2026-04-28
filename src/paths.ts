import { join } from "path";

export const CLAUDE_DIR = join(process.cwd(), ".claude");
export const HEARTBEAT_DIR = join(CLAUDE_DIR, "claudeclaw");
export const LOGS_DIR = join(HEARTBEAT_DIR, "logs");
export const JOBS_DIR = join(HEARTBEAT_DIR, "jobs");
export const SESSIONS_DIR = join(HEARTBEAT_DIR, "sessions");
export const SETTINGS_FILE = join(HEARTBEAT_DIR, "settings.json");
export const SESSIONS_FILE = join(HEARTBEAT_DIR, "sessions.json");
export const JOBS_STATE_FILE = join(HEARTBEAT_DIR, "jobs-state.json");
export const STATE_FILE = join(HEARTBEAT_DIR, "state.json");
export const PID_FILE = join(HEARTBEAT_DIR, "daemon.pid");
export const STATUSLINE_FILE = join(CLAUDE_DIR, "statusline.cjs");
export const CLAUDE_SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");
