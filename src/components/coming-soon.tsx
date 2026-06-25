import { cn } from "@/lib/utils";

export function ComingSoon({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-[1100px] px-8 py-8", className)}>
      <p className="section-eyebrow mb-1.5">{eyebrow}</p>
      <h1 className="display mb-3 text-[28px] font-semibold">{title}</h1>
      <p className="max-w-prose text-[14px] text-fg-muted">{description}</p>
      <div className="mt-8 inline-flex items-center gap-2 rounded border border-dashed border-border-strong bg-bg-surface px-3 py-2 text-[12px] text-fg-subtle">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Not built yet — coming in a later phase.
      </div>
    </div>
  );
}
