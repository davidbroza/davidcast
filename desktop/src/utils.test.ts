import { describe, expect, it } from "vitest";
import {
  fmtKind,
  fmtMs,
  fmtPct,
  fmtSize,
  relativeTime,
} from "./utils";

describe("fmtPct", () => {
  it("formats fractions as integer percentages", () => {
    expect(fmtPct(0.5)).toBe("50%");
    expect(fmtPct(0.123)).toBe("12%");
    expect(fmtPct(1)).toBe("100%");
    expect(fmtPct(0)).toBe("0%");
  });
  it("returns em-dash for nullish", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
  });
});

describe("fmtMs", () => {
  it("uses milliseconds below 1s", () => {
    expect(fmtMs(0)).toBe("0 ms");
    expect(fmtMs(12)).toBe("12 ms");
    expect(fmtMs(999)).toBe("999 ms");
  });
  it("uses seconds with one decimal between 1s and 1min", () => {
    expect(fmtMs(1000)).toBe("1.0 s");
    expect(fmtMs(2500)).toBe("2.5 s");
    expect(fmtMs(59_999)).toBe("60.0 s");
  });
  it("uses minutes (and seconds) above 1min", () => {
    expect(fmtMs(60_000)).toBe("1m");
    expect(fmtMs(125_000)).toBe("2m 5s");
  });
  it("returns em-dash for nullish", () => {
    expect(fmtMs(null)).toBe("—");
    expect(fmtMs(undefined)).toBe("—");
  });
});

describe("fmtKind", () => {
  it("capitalizes the first letter only", () => {
    expect(fmtKind("app")).toBe("App");
    expect(fmtKind("snippet")).toBe("Snippet");
    expect(fmtKind("URL")).toBe("URL"); // already-uppercase preserved
  });
  it("handles empty input", () => {
    expect(fmtKind("")).toBe("");
  });
});

describe("relativeTime", () => {
  const now = 10_000_000_000;
  it("collapses sub-minute deltas to 'just now'", () => {
    expect(relativeTime(now - 0, now)).toBe("just now");
    expect(relativeTime(now - 59_000, now)).toBe("just now");
  });
  it("renders minutes for under an hour", () => {
    expect(relativeTime(now - 60_000, now)).toBe("1m ago");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 59 * 60_000, now)).toBe("59m ago");
  });
  it("renders hours for under a day", () => {
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1h ago");
    expect(relativeTime(now - 23 * 3_600_000, now)).toBe("23h ago");
  });
  it("renders days otherwise", () => {
    expect(relativeTime(now - 24 * 3_600_000, now)).toBe("1d ago");
    expect(relativeTime(now - 365 * 86_400_000, now)).toBe("365d ago");
  });
});

describe("fmtSize", () => {
  it("formats across KB/MB/GB boundaries", () => {
    expect(fmtSize(0)).toBe("0 B");
    expect(fmtSize(1023)).toBe("1023 B");
    expect(fmtSize(1024)).toBe("1.0 KB");
    expect(fmtSize(1536)).toBe("1.5 KB");
    expect(fmtSize(1024 * 1024)).toBe("1.0 MB");
    expect(fmtSize(1024 * 1024 * 1024)).toBe("1.00 GB");
  });
});
