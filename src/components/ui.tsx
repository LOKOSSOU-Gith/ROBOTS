import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("card", className)}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-4 py-4 sm:px-5", className)}>{children}</div>;
}

const TONE_CLASSES = {
  neutral: "border-border bg-white/5 text-muted",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
} as const;

export type Tone = keyof typeof TONE_CLASSES;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const valueTone =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-destructive"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums tracking-tight", valueTone)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs text-muted">{description}</p>
      {action}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
}) {
  const border =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10"
        : tone === "success"
          ? "border-success/40 bg-success/10"
          : "border-info/40 bg-info/10";
  return (
    <div className={cn("rounded-lg border px-3.5 py-3 text-xs leading-relaxed", border)}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-muted">{children}</div> : null}
    </div>
  );
}
