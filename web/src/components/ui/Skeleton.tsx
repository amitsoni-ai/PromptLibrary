import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-surface-2", className)}
      {...props}
    />
  );
}

// A card-shaped skeleton row used by the Library grid while data streams in.
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
    </div>
  );
}
