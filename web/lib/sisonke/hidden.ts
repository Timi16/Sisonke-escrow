/** Per-address hidden escrow ids, in localStorage. A view preference only. */
const key = (address: string) => `sisonke:hidden:${address}`;

export function readHidden(address: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key(address));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && /^\d{1,15}$/.test(x)) : []);
  } catch {
    return new Set();
  }
}

export function writeHidden(address: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(key(address), JSON.stringify([...ids]));
  } catch {
    /* storage unavailable: hiding lasts for this page view only */
  }
}
