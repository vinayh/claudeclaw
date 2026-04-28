/**
 * Force-import all source modules so Bun's coverage reporter instruments them.
 * Without this, only files imported by actual tests appear in lcov output.
 *
 * Each import is wrapped in a no-op test so Bun treats this as a valid test file.
 * Modules with top-level side effects (index.ts) are excluded.
 */
import { describe, it } from "bun:test";

// Core modules
import "./paths";
import "./atomic-write";
import "./config";
import "./cron";
import "./jobs";
import "./jobsState";
import "./model-router";
import "./pid";
import "./replay";
import "./sessionManager";
import "./statusline";
import "./timezone";
import "./chat-utils";
import "./skills";
import "./web";
import "./runner";
import "./whisper";

// Command modules
import "./commands/clear";
import "./commands/discord";
import "./commands/send";
import "./commands/start";
import "./commands/status";
import "./commands/stop";
import "./commands/telegram";

// UI modules
import "./ui/constants";
import "./ui/http";
import "./ui/server";
import "./ui/types";

describe("coverage instrumentation", () => {
  it("all source modules are imported", () => {
    // This test exists solely to force Bun to instrument every source file.
  });
});
