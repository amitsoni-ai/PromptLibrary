"use client";

import { Select, Input } from "@/components/ui";
import type { CategoryCount } from "@/contracts/categories";

export interface FilterState {
  q: string;
  category: string;
  difficulty: string;
  level: string;
  template: boolean;
  savedOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  q: "",
  category: "",
  difficulty: "",
  level: "",
  template: false,
  savedOnly: false,
};

export function Filters({
  value,
  onChange,
  categories,
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  categories: CategoryCount[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <span className="sr-only">Search prompts</span>
        <Input
          type="search"
          placeholder="Search prompts…"
          value={value.q}
          onChange={(e) => onChange({ q: e.target.value })}
          aria-label="Search prompts"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-[180px] flex-1">
          <Select
            aria-label="Category"
            placeholder="All categories"
            value={value.category}
            onChange={(e) => onChange({ category: e.target.value })}
            options={[
              { value: "", label: "All categories" },
              ...categories.map((c) => ({ value: c.category, label: `${c.category} (${c.count})` })),
            ]}
          />
        </div>
        <div className="w-[150px]">
          <Select
            aria-label="Difficulty"
            value={value.difficulty}
            onChange={(e) => onChange({ difficulty: e.target.value })}
            options={[
              { value: "", label: "Any difficulty" },
              { value: "Beginner", label: "Beginner" },
              { value: "Intermediate", label: "Intermediate" },
              { value: "Advanced", label: "Advanced" },
            ]}
          />
        </div>
        <div className="w-[150px]">
          <Select
            aria-label="Framework level"
            value={value.level}
            onChange={(e) => onChange({ level: e.target.value })}
            options={[
              { value: "", label: "Any level" },
              { value: "1", label: "L1 · Clear" },
              { value: "2", label: "L2 · Reliable" },
              { value: "3", label: "L3 · Expert" },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-text-muted">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--accent)]"
            checked={value.template}
            onChange={(e) => onChange({ template: e.target.checked })}
          />
          Templates only
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--accent)]"
            checked={value.savedOnly}
            onChange={(e) => onChange({ savedOnly: e.target.checked })}
          />
          Saved only
        </label>
      </div>
    </div>
  );
}
