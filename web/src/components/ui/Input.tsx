import { forwardRef } from "react";
import { cn } from "@/lib/cn";

const field =
  "h-10 w-full rounded border border-border bg-surface px-3 text-sm text-text " +
  "placeholder:text-text-faint focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-0 focus-visible:outline-accent focus-visible:border-accent " +
  "disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(field, className)} {...props} />;
  },
);
