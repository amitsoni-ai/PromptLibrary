"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api-client";

export function CopyButton({ text, promptId }: { text: string; promptId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          api.logActivity({ event: "copied", promptId }).catch(() => {});
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy prompt"}
    </Button>
  );
}
