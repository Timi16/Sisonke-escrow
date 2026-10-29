/** Display helpers: ids, addresses, hashes, dates and durations. */

/** 42n → "#0042" (ids above 9999 keep every digit). */
export const padId = (id: bigint | number | string) => `#${String(id).padStart(4, "0")}`;

/** GCX4…7QPA */
export const shortAddress = (address: string) =>
  address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;

/** 7c1e…a90b */
export const shortHash = (hash: string) => (hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Seconds → "in 6d 23h", "in 21h 40m", "in 3m 05s"; "passed" at or below zero. */
export function countdown(seconds: number): string {
  let s = Math.floor(seconds);
  if (s <= 0) return "passed";
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3_600);
  s -= h * 3_600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  if (d > 0) return `in ${d}d ${pad2(h)}h`;
  if (h > 0) return `in ${h}h ${pad2(m)}m`;
  return `in ${m}m ${pad2(sec)}s`;
}

/** 3600 → "1 hour", 90 → "1 minute 30 seconds", 86400 → "1 day". */
export function duration(seconds: number): string {
  const parts: string[] = [];
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  let s = Math.max(0, Math.floor(seconds));
  for (const [size, name] of units) {
    const n = Math.floor(s / size);
    if (n > 0) {
      parts.push(`${n} ${name}${n === 1 ? "" : "s"}`);
      s -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.length ? parts.join(" ") : "0 seconds";
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (sec: number) =>
  new Intl.DateTimeFormat("en-GB", opts).format(new Date(sec * 1000));

/** "24 Oct 2026, 10:14" (local time). */
export const formatWhen = (sec: number) =>
  `${fmt({ day: "numeric", month: "short", year: "numeric" })(sec)}, ${fmt({ hour: "2-digit", minute: "2-digit", hour12: false })(sec)}`;

/** "7 Nov 2026, 14:00 WAT" (local time with the zone). */
export const formatWhenZone = (sec: number) =>
  `${formatWhen(sec)} ${fmt({ timeZoneName: "short" })(sec).split(" ").pop() ?? ""}`.trim();

/** "7 Nov 2026" */
export const formatDay = fmt({ day: "numeric", month: "short", year: "numeric" });

/** "Saturday 7 November, 14:00" */
export const formatLong = (sec: number) =>
  `${fmt({ weekday: "long", day: "numeric", month: "long" })(sec)}, ${fmt({ hour: "2-digit", minute: "2-digit", hour12: false })(sec)}`;

/** Unix seconds → a `datetime-local` value in local time. */
export function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 5442580 → "5,442,580" without locale data. */
export const groupInt = (n: number | bigint) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
