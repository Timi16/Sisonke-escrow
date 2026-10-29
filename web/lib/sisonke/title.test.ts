import { describe, expect, test } from "vitest";
import { checkTitle, displayTitle, titleBytes } from "./title";

describe("checkTitle", () => {
  test("byte limit counts UTF-8 bytes, not characters", () => {
    expect(checkTitle("a".repeat(64)).ok).toBe(true);
    expect(checkTitle("a".repeat(65))).toEqual({ ok: false, error: "Keep it to 64 bytes. Emoji count as up to 4." });
    expect(titleBytes("é")).toBe(2);
    expect(checkTitle("é".repeat(32)).ok).toBe(true);
    expect(checkTitle("é".repeat(32) + "a").ok).toBe(false);
    expect(titleBytes("😀")).toBe(4);
    expect(checkTitle("😀".repeat(16)).ok).toBe(true);
    expect(checkTitle("😀".repeat(16) + "a").ok).toBe(false);
  });
  test("empty is allowed and ends are trimmed", () => {
    expect(checkTitle("")).toEqual({ ok: true, title: "" });
    expect(checkTitle("  Logo  ")).toEqual({ ok: true, title: "Logo" });
    expect(checkTitle("a  b")).toEqual({ ok: true, title: "a  b" });
  });
  test.each(["line\nbreak", "tab\there", "nul\u0000", "del\u007f", "bell\u0007"])("refuses control characters: %j", (t) => {
    expect(checkTitle(t)).toEqual({ ok: false, error: "Remove line breaks and tabs." });
  });
  test.each(["‮evil", "a⁦b", "zero​width", "joiner‍", "bom﻿", "mark‎", "rtl‏", "iso⁩"])(
    "refuses hidden formatting at input: %j",
    (t) => {
      expect(checkTitle(t)).toEqual({ ok: false, error: "Remove hidden formatting characters." });
    },
  );
  test("checking is repeatable (no stateful global regex)", () => {
    for (let i = 0; i < 3; i++) expect(checkTitle("x‮y").ok).toBe(false);
  });
});

describe("displayTitle", () => {
  test("strips bidi and zero-width characters and says so", () => {
    expect(displayTitle("PAID‮ tnemyap")).toEqual({ text: "PAID tnemyap", stripped: true, empty: false });
    expect(displayTitle("​‌‍﻿⁦⁩")).toEqual({ text: "", stripped: true, empty: true });
  });
  test("leaves ordinary text alone", () => {
    expect(displayTitle("Logo for the café 😀")).toEqual({ text: "Logo for the café 😀", stripped: false, empty: false });
    expect(displayTitle("   ").empty).toBe(true);
  });
});
