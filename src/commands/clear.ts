import { backupDefaultSession } from "../sessionManager";
import { checkExistingDaemon } from "../pid";
import { stop } from "./stop";

export async function clear() {
  const backup = await backupDefaultSession();

  if (backup) {
    console.log(`Session backed up → ${backup}`);
  } else {
    console.log("No active session to back up.");
  }

  // If daemon is running, stop it so the next start gets a fresh session
  const pid = await checkExistingDaemon();
  if (pid) {
    console.log("Stopping daemon so next start creates a fresh session...");
    await stop();
  } else {
    console.log("No daemon running. Next start will create a new session.");
    process.exit(0);
  }
}
