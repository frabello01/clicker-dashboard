import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "online" | "offline" | "warning" | "error" | "neutral" | "accent";

const dotTone: Record<Tone, string> = {
  online: "bg-status-online shadow-[0_0_0_3px] shadow-status-online/15",
  offline: "bg-status-offline",
  warning: "bg-status-warning",
  error: "bg-status-error",
  neutral: "bg-fg-subtle",
  accent: "bg-accent",
};

const badgeTone: Record<Tone, string> = {
  online: "bg-status-online/10 text-status-online border-status-online/25",
  offline: "bg-fg-subtle/10 text-fg-muted border-border",
  warning: "bg-status-warning/10 text-status-warning border-status-warning/25",
  error: "bg-status-error/10 text-status-error border-status-error/25",
  neutral: "bg-bg-surface-2 text-fg-muted border-border",
  accent: "bg-accent/10 text-accent border-accent/25",
};

export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 rounded-full", dotTone[tone], className)}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium",
        badgeTone[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
