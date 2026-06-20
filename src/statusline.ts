import { STATE_FILE } from "./paths";
import { atomicWriteFile } from "./atomic-write";

// Write state.json so the statusline script can read fresh data
export interface StateData {
  heartbeat?: { nextAt: number };
  jobs: {
    name: string;
    nextAt: number;
    /** Outcome of the most recent run. Absent until the job has run at least once. */
    lastResult?: "ok" | "error";
    /** Unix timestamp (ms) of the most recent completion. Absent until first run. */
    lastRanAt?: number;
  }[];
  security: string;
  telegram: boolean;
  discord: boolean;
  startedAt: number;
}

export async function writeState(state: StateData) {
  await atomicWriteFile(STATE_FILE, JSON.stringify(state) + "\n");
}
