import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
}

// Native <select> — accessible by default (keyboard, screen reader), styled to
// match the token set. Chevron drawn via background SVG so it themes cleanly.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-10 w-full appearance-none rounded border border-border bg-surface pl-3 pr-9 text-sm text-text",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
        "bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%235B6660%22><path d=%22M5.5 7.5L10 12l4.5-4.5%22 stroke=%22%235B6660%22 stroke-width=%221.5%22 fill=%22none%22/></svg>')]",
        className,
      )}
      {...props}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
});
