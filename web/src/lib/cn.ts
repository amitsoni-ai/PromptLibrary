// Tiny classnames joiner (no dep). Filters falsy, joins with spaces.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
