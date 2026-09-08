"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui";
import { CopyButton } from "./CopyButton";
import { useSaved } from "./useSaved";

// Client actions for the prompt detail: logs `opened` on mount, renders Copy +
// Save. Kept out of the RSC page so the page stays server-rendered.
export function PromptDetailActions({ promptId, copyText }: { promptId: string; copyText: string }) {
  const saved = useSaved();
  useEffect(() => {
    api.logActivity({ event: "opened", promptId }).catch(() => {});
  }, [promptId]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyButton text={copyText} promptId={promptId} />
      <Button
        variant="secondary"
        aria-pressed={saved.isSaved(promptId)}
        onClick={() => saved.toggle(promptId)}
      >
        {saved.isSaved(promptId) ? "★ Saved" : "☆ Save"}
      </Button>
    </div>
  );
}
