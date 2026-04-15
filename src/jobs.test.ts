import { describe, it, expect } from "bun:test";
import { parseFrontmatterValue, parseJobFile, stripScheduleFromContent } from "./jobs";

describe("parseFrontmatterValue", () => {
  it("strips double quotes", () => {
    expect(parseFrontmatterValue('"hello"')).toBe("hello");
  });

  it("strips single quotes", () => {
    expect(parseFrontmatterValue("'hello'")).toBe("hello");
  });

  it("trims whitespace", () => {
    expect(parseFrontmatterValue("  hello  ")).toBe("hello");
  });

  it("handles no quotes", () => {
    expect(parseFrontmatterValue("hello")).toBe("hello");
  });

  it("strips quotes after trimming", () => {
    expect(parseFrontmatterValue('  "hello"  ')).toBe("hello");
  });
});

describe("parseJobFile", () => {
  const validJob = `---
schedule: "0 9 * * *"
recurring: true
notify: error
---
Do the daily check`;

  it("parses a valid job file", () => {
    const job = parseJobFile("daily-check", validJob);
    expect(job).toEqual({
      name: "daily-check",
      schedule: "0 9 * * *",
      prompt: "Do the daily check",
      recurring: true,
      notify: "error",
    });
  });

  it("returns null for missing frontmatter delimiters", () => {
    expect(parseJobFile("bad", "no frontmatter here")).toBeNull();
    expect(parseJobFile("bad", "---\nschedule: * * * * *\nno closing")).toBeNull();
  });

  it("returns null when schedule is missing", () => {
    const content = `---
recurring: true
---
Some prompt`;
    expect(parseJobFile("no-schedule", content)).toBeNull();
  });

  it("parses recurring: true/yes/1", () => {
    const make = (val: string) => `---\nschedule: "* * * * *"\nrecurring: ${val}\n---\nprompt`;
    expect(parseJobFile("t", make("true"))!.recurring).toBe(true);
    expect(parseJobFile("t", make("yes"))!.recurring).toBe(true);
    expect(parseJobFile("t", make("1"))!.recurring).toBe(true);
    expect(parseJobFile("t", make("false"))!.recurring).toBe(false);
    expect(parseJobFile("t", make("no"))!.recurring).toBe(false);
  });

  it("supports legacy daily: alias for recurring", () => {
    const content = `---
schedule: "0 9 * * *"
daily: yes
---
prompt`;
    expect(parseJobFile("legacy", content)!.recurring).toBe(true);
  });

  it("defaults recurring to false", () => {
    const content = `---
schedule: "0 9 * * *"
---
prompt`;
    expect(parseJobFile("default", content)!.recurring).toBe(false);
  });

  it("parses notify values", () => {
    const make = (val: string) => `---\nschedule: "* * * * *"\nnotify: ${val}\n---\nprompt`;
    expect(parseJobFile("t", make("true"))!.notify).toBe(true);
    expect(parseJobFile("t", make("false"))!.notify).toBe(false);
    expect(parseJobFile("t", make("no"))!.notify).toBe(false);
    expect(parseJobFile("t", make("error"))!.notify).toBe("error");
  });

  it("defaults notify to true", () => {
    const content = `---
schedule: "0 9 * * *"
---
prompt`;
    expect(parseJobFile("default", content)!.notify).toBe(true);
  });

  it("trims prompt body whitespace", () => {
    const content = `---
schedule: "0 9 * * *"
---

  some prompt with whitespace
`;
    expect(parseJobFile("trim", content)!.prompt).toBe("some prompt with whitespace");
  });
});

describe("stripScheduleFromContent", () => {
  it("removes schedule line from frontmatter", () => {
    const content = `---
schedule: "0 9 * * *"
recurring: true
---
Do something`;
    const result = stripScheduleFromContent(content);
    expect(result).toBe(`---\nrecurring: true\n---\nDo something\n`);
  });

  it("removes multiple schedule lines", () => {
    const content = `---
schedule: "0 9 * * *"
recurring: true
schedule: "0 18 * * *"
---
prompt`;
    const result = stripScheduleFromContent(content);
    expect(result).toBe(`---\nrecurring: true\n---\nprompt\n`);
  });

  it("returns null for content without frontmatter", () => {
    expect(stripScheduleFromContent("no frontmatter")).toBeNull();
    expect(stripScheduleFromContent("---\nno closing")).toBeNull();
  });

  it("preserves frontmatter when no schedule line exists", () => {
    const content = `---
recurring: true
notify: error
---
prompt body`;
    const result = stripScheduleFromContent(content);
    expect(result).toBe(`---\nrecurring: true\nnotify: error\n---\nprompt body\n`);
  });

  it("preserves body content intact", () => {
    const content = `---
schedule: "* * * * *"
---
Multi-line
body content
here`;
    const result = stripScheduleFromContent(content);
    expect(result).toContain("Multi-line\nbody content\nhere");
  });
});
