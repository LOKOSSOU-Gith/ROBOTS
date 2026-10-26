/** Formatage d'affichage ; aucun calcul financier ne repose sur ces fonctions. */

export function formatMoney(value: string | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatSigned(value: string | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const formatted = formatMoney(value, currency);
  return numeric > 0 ? `+${formatted}` : formatted;
}

export function pnlTone(value: string | null | undefined): "success" | "danger" | "neutral" {
  if (!value) return "neutral";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "neutral";
  return numeric > 0 ? "success" : "danger";
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

export function formatAgo(value: Date | null | undefined): string {
  if (!value) return "jamais";
  const seconds = Math.max(0, Math.round((Date.now() - value.getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`;
  return `il y a ${Math.floor(seconds / 86400)} j`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function humanTimeframe(value: string): string {
  return value.replace("M", "M").replace("H", "H");
}
