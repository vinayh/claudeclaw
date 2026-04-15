import { describe, it, expect } from "bun:test";
import { classifyTask, selectModel } from "./model-router";
import type { AgenticMode } from "./config";

const PLANNING_MODE: AgenticMode = {
  name: "planning",
  model: "opus",
  keywords: ["plan", "design", "architect", "research", "analyze"],
  phrases: ["how should i", "what's the best way to", "help me decide"],
};

const IMPLEMENTATION_MODE: AgenticMode = {
  name: "implementation",
  model: "sonnet",
  keywords: ["implement", "code", "write", "build", "fix", "deploy"],
  phrases: undefined,
};

const DEFAULT_MODES = [PLANNING_MODE, IMPLEMENTATION_MODE];

describe("classifyTask", () => {
  describe("phrase matching", () => {
    it("matches phrases with 0.95 confidence", () => {
      const result = classifyTask("how should i structure this API?", DEFAULT_MODES, "implementation");
      expect(result.mode).toBe("planning");
      expect(result.model).toBe("opus");
      expect(result.confidence).toBe(0.95);
    });

    it("phrases take priority over keywords", () => {
      // "how should i implement" has both a planning phrase and an implementation keyword
      const result = classifyTask("how should i implement this?", DEFAULT_MODES, "implementation");
      expect(result.mode).toBe("planning");
      expect(result.confidence).toBe(0.95);
    });
  });

  describe("keyword scoring", () => {
    it("scores implementation keywords higher", () => {
      const result = classifyTask("implement and deploy this feature", DEFAULT_MODES, "implementation");
      expect(result.mode).toBe("implementation");
      expect(result.model).toBe("sonnet");
    });

    it("scores planning keywords higher", () => {
      const result = classifyTask("analyze and research the design", DEFAULT_MODES, "implementation");
      expect(result.mode).toBe("planning");
      expect(result.model).toBe("opus");
    });

    it("confidence increases with score difference", () => {
      const result1 = classifyTask("implement this", DEFAULT_MODES, "implementation"); // 1 keyword
      const result2 = classifyTask("implement build deploy code write fix", DEFAULT_MODES, "implementation"); // 6 keywords
      expect(result2.confidence).toBeGreaterThan(result1.confidence);
    });
  });

  describe("question mark boost", () => {
    it("boosts modes that have phrases", () => {
      // "fix?" - "fix" is an implementation keyword, but "?" boosts planning (which has phrases)
      const result = classifyTask("fix?", DEFAULT_MODES, "implementation");
      // Planning gets 0 keywords + 0.5 question boost = 0.5
      // Implementation gets 1 keyword = 1
      // Implementation still wins, but planning gets boosted
      expect(result.mode).toBe("implementation");
    });
  });

  describe("tie-breaking", () => {
    it("prefers defaultMode among tied candidates", () => {
      // Empty prompt matches no keywords in either mode
      // Both score 0, but with question marks they could tie at >0
      const modeA: AgenticMode = {
        name: "alpha",
        model: "model-a",
        keywords: ["shared"],
        phrases: ["common phrase"],
      };
      const modeB: AgenticMode = {
        name: "beta",
        model: "model-b",
        keywords: ["shared"],
        phrases: ["common phrase"],
      };
      const result = classifyTask("shared", [modeA, modeB], "beta");
      expect(result.mode).toBe("beta");
      expect(result.confidence).toBe(0.6);
    });
  });

  describe("fallback", () => {
    it("falls back to defaultMode with 0.5 confidence when no matches", () => {
      const result = classifyTask("something completely unrelated", DEFAULT_MODES, "implementation");
      expect(result.mode).toBe("implementation");
      expect(result.confidence).toBe(0.5);
    });

    it("falls back to first mode if defaultMode not found", () => {
      const result = classifyTask("unrelated", DEFAULT_MODES, "nonexistent");
      expect(result.mode).toBe("planning");
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("edge cases", () => {
    it("returns unknown with 0 confidence for empty modes", () => {
      const result = classifyTask("anything", [], "implementation");
      expect(result.mode).toBe("unknown");
      expect(result.model).toBe("");
      expect(result.confidence).toBe(0);
    });

    it("is case-insensitive", () => {
      const result = classifyTask("IMPLEMENT THIS CODE", DEFAULT_MODES, "implementation");
      expect(result.mode).toBe("implementation");
    });
  });
});

describe("selectModel", () => {
  it("returns model, taskType, and reasoning", () => {
    const result = selectModel("implement this", DEFAULT_MODES, "implementation");
    expect(result.model).toBe("sonnet");
    expect(result.taskType).toBe("implementation");
    expect(typeof result.reasoning).toBe("string");
  });
});
