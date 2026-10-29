/** Escrow titles: validated at input, sanitised for display (WEB_PLAN §6.8, §8.3). */
import { MAX_TITLE_BYTES } from "../config";

/** Bidi overrides and isolates, zero-width characters, marks and the BOM. */
const HIDDEN = /[‪-‮⁦-⁩​-‍‎‏﻿]/g;
const CONTROL = /[\u0000-\u001F\u007F]/;

export const titleBytes = (t: string) => new TextEncoder().encode(t).length;

export type TitleCheck = { ok: true; title: string } | { ok: false; error: string };

export function checkTitle(raw: string): TitleCheck {
  const t = raw.trim();
  if (CONTROL.test(t)) return { ok: false, error: "Remove line breaks and tabs." };
  // Checked on the raw text: trim() would silently drop a leading or trailing BOM.
  if (new RegExp(HIDDEN.source).test(raw)) return { ok: false, error: "Remove hidden formatting characters." };
  if (titleBytes(t) > MAX_TITLE_BYTES) return { ok: false, error: "Keep it to 64 bytes. Emoji count as up to 4." };
  return { ok: true, title: t };
}

/** For display: hidden characters stripped, and whether any were. */
export function displayTitle(raw: string): { text: string; stripped: boolean; empty: boolean } {
  const text = raw.replace(HIDDEN, "");
  return { text, stripped: text.length !== raw.length, empty: text.trim().length === 0 };
}
