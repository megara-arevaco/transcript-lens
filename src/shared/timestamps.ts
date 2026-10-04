export function parseTimestamp(value: string): number | null {
  const clean = value.trim().replace(/[\[\]]/g, "");
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(clean)) return null;
  const parts = clean.split(":").map(Number);
  if (parts.slice(1).some((n) => n >= 60)) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}
export function formatTimestamp(seconds: number): string {
  const n = Math.floor(seconds);
  const h = Math.floor(n / 3600);
  const m = Math.floor(n / 60) % 60;
  const s = n % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(s).padStart(2, "0")}`;
}
