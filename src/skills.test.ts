import { describe, it, expect } from "bun:test";
import { extractDescription } from "./skills";

describe("extractDescription", () => {
  it("extracts single-line frontmatter description", () => {
    const content = `---
description: A helpful skill
---
Body text here`;
    expect(extractDescription(content)).toBe("A helpful skill");
  });

  it("extracts quoted frontmatter description", () => {
    const content = `---
description: "Quoted description"
---
Body`;
    expect(extractDescription(content)).toBe("Quoted description");
  });

  it("extracts multi-line frontmatter description (indented continuation)", () => {
    const content = `---
description:
  This is a multi-line
  description value
---
Body`;
    expect(extractDescription(content)).toBe("This is a multi-line");
  });

  it("falls back to first body line when no frontmatter", () => {
    const content = "First line of text\nSecond line";
    expect(extractDescription(content)).toBe("First line of text");
  });

  it("skips headers when falling back to body", () => {
    const content = "# Header\nActual description";
    expect(extractDescription(content)).toBe("Actual description");
  });

  it("returns default for empty content", () => {
    expect(extractDescription("")).toBe("Claude Code skill");
  });

  it("returns default for content with only headers and frontmatter delimiters", () => {
    expect(extractDescription("---\n---\n# Header")).toBe("Claude Code skill");
  });
});
