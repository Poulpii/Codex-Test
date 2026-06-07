export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function unique(values: string[]) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.floor(bytes / 1024 / 1024)} Mo`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} Ko`;
  return `${bytes} octets`;
}
