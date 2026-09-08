import { cn } from "@/lib/cn";

export function Card({
  as: As = "div",
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  interactive?: boolean;
}) {
  return (
    <As
      className={cn(
        "rounded-lg border border-border bg-surface shadow",
        interactive &&
          "transition-shadow hover:shadow-lg hover:border-border-strong focus-within:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-display text-base font-semibold leading-snug text-text", className)}
      {...props}
    />
  );
}
