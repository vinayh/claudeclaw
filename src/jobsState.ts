import { existsSync } from "fs";
import * as paths from "./paths";
import { atomicWriteFile } from "./atomic-write";

/**
 * Persisted per-job scheduler state. Currently records `lastFiredAt` so the
 * cron loop can replay missed fires across daemon restarts and avoid same-
 * minute double fires.
 */
interface JobsStateData {
  /** Map of job name → ISO timestamp of the last fire we *intended* to run. */
  lastFiredAt: Record<string, string>;
}

let cache: JobsStateData | null = null;

async function load(): Promise<JobsStateData> {
  if (cache) return cache;
  try {
    const raw = await Bun.file(paths.JOBS_STATE_FILE).json();
    if (raw && typeof raw === "object" && raw.lastFiredAt && typeof raw.lastFiredAt === "object") {
      cache = { lastFiredAt: { ...raw.lastFiredAt } };
      return cache;
    }
  } catch (err) {
    if (existsSync(paths.JOBS_STATE_FILE)) {
      console.warn(`[JobsState] State file exists but failed to parse, starting fresh:`, err);
    }
  }
  cache = { lastFiredAt: {} };
  return cache;
}

async function save(data: JobsStateData): Promise<void> {
  try {
    await atomicWriteFile(paths.JOBS_STATE_FILE, JSON.stringify(data, null, 2) + "\n");
    cache = data;
  } catch (err) {
    cache = null;
    throw err;
  }
}

/** Get the recorded `lastFiredAt` for a job, or null if never fired. */
export async function getLastFired(name: string): Promise<Date | null> {
  const data = await load();
  const iso = data.lastFiredAt[name];
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Record `lastFiredAt = at` for a job. Atomically persisted. */
export async function setLastFired(name: string, at: Date): Promise<void> {
  const data = await load();
  data.lastFiredAt[name] = at.toISOString();
  await save(data);
}

/** Drop a job's recorded state. Called when a job is deleted. */
export async function forgetJob(name: string): Promise<void> {
  const data = await load();
  if (!(name in data.lastFiredAt)) return;
  delete data.lastFiredAt[name];
  await save(data);
}

/** @internal Reset in-memory cache (for testing only). */
export function _resetCache(): void {
  cache = null;
}
