import { STATE_FILE } from "./paths";
import { atomicWriteFile } from "./atomic-write";

// Write state.json so the statusline script can read fresh data
export interface StateData {
  heartbeat?: { nextAt: number };
  jobs: { name: string; nextAt: number }[];
  security: string;
  telegram: boolean;
  discord: boolean;
  startedAt: number;
  web?: { enabled: boolean; host: string; port: number };
}

export async function writeState(state: StateData) {
  await atomicWriteFile(STATE_FILE, JSON.stringify(state) + "\n");
}
