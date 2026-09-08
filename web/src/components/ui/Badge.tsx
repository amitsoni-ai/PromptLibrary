import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "warn" | "danger" | "blue";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-muted border-border",
  accent: "bg-accent-soft text-accent-strong border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  blue: "bg-good-blue-soft text-good-blue border-transparent",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
