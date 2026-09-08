// ─────────────────────────────────────────────────────────────────────────────
// Framework-level derivation — a 1:1 TS port of src/part_framework.js
// (deriveFrameworkLevel + fwStatus + FRAMEWORK.levels). Regexes copied verbatim.
// The legacy app computes this client-side and never persists it; we compute it
// server-side (cache/seed build) so V2 badges match the legacy app exactly.
// ─────────────────────────────────────────────────────────────────────────────

type Component = { detect: RegExp; soft: RegExp };

const COMPONENTS: Record<string, Component> = {
  role: {
    detect:
      /\b(act as|acting as|you are (an?|my|acting)|as an? (experienced|senior|expert|professional|seasoned|world[- ]class)|role\s*[:=]|imagine you(?:'re| are)|play the role of|take on the role|assume the role|you'?re an? \w+ (expert|specialist|strategist|analyst|manager|consultant|coach))/i,
    soft: /\b(as an? (marketer|engineer|designer|writer|lawyer|teacher|recruiter|founder|manager|analyst|consultant|coach|strategist|advisor))\b/i,
  },
  context: {
    detect:
      /\b(context\s*[:=]|background\s*[:=]|the situation is|currently we|we are|we're a|our (company|team|product|audience|customers|users|clients|org)|my (company|team|role|manager|client)|for (my|our) (team|company|org|audience)|the audience is|target audience|given that|based on the|here'?s (the|what)|to give you context)/i,
    soft: /\[[A-Za-z][A-Za-z0-9 _/'-]{1,40}\]|\b(because|since|so far|last (quarter|month|week|year))\b/i,
  },
  goal: {
    detect:
      /\b(goal\s*[:=]|the (goal|objective|aim|outcome) is|so that (i|we)|in order to|success looks like|the (result|output|answer) should (help|let|enable)|i want to be able to|end goal|desired outcome|what i'?m trying to achieve)/i,
    soft: /\b(objective|outcome|so we can|to help (me|us)|ultimately)\b/i,
  },
  task: {
    detect:
      /\b(task\s*[:=]|your task is|please (write|draft|create|produce|analy|compare|summar|list|design|build|plan|review|rewrite|generate|outline|explain|evaluate)|^\s*(write|draft|create|produce|analy[sz]e|compare|summari[sz]e|list|design|build|plan|review|rewrite|generate|outline|explain|evaluate)\b|step 1[:.)]|^\s*1[.)]\s)/im,
    soft: /\b(help me (write|draft|create|build|plan|make|analy)|i need (a|an|to|help)|can you (write|make|help|create|draft|give))\b/i,
  },
  constraints: {
    detect:
      /\b(constraint|limit(ed)? to|no more than|under \d|within \d|at most \d|word count|keep it (short|brief|concise|under|to)|tone\s*[:=]|in a \w+ tone|avoid|do not|don'?t|must not|only use|no jargon|stay under|maximum of|minimum of)/i,
    soft: /\b(concise|brief|short|formal|informal|professional tone|friendly tone|no filler)\b/i,
  },
  examples: {
    detect:
      /\b(example\s*[:=]|for example|e\.g\.|for instance|such as|sample (input|output|answer|response)|like this\s*[:=]|here'?s an example|as an example|reference example|model it on)/i,
    soft: /["“][^"”]{12,}["”]/,
  },
  format: {
    detect:
      /\b(format\s*[:=]|as a (table|list|bulleted list|numbered list|checklist)|bullet points?|numbered list|in \d+ (words|sentences|paragraphs|bullets)|markdown|json|as headings|in sections|use headings|a template|word count|respond with (a|only)|structure(d)? as|output\s*[:=])/i,
    soft: /\b(table|list|bullets?|sections?|headings?|steps?|template|columns?)\b/i,
  },
  verification: {
    detect:
      /\b(verif|double.?check|check your (work|answer|response|facts)|review your (answer|work|response|draft)|self.?review|self.?check|flag (any|anything|any claim)|list (any )?assumptions|state your assumptions|cite (your )?sources|show your (working|reasoning)|make sure (you|the|everything)|confirm that|sanity.?check your)/i,
    soft: /\b(accuracy|accurate|check for errors|before you finish)\b/i,
  },
  validation: {
    detect:
      /\b(validat|pressure.?test|stress.?test|test (it|this|the (answer|result|output|draft)) against|would this (actually )?work|does this hold up|edge case|in practice|real.?world|from the (customer|reader|user|buyer|board)'?s (point of view|perspective|angle)|red.?team|poke holes|where (it|this) (breaks|falls down))/i,
    soft: /\b(realistic|would a \w+ (accept|buy|believe)|practical(ity)?)\b/i,
  },
};

export const LEVELS = [
  { level: 1, code: "R-C-T-F", componentKeys: ["role", "context", "task", "format"] },
  {
    level: 2,
    code: "R-C-T-F-V-V",
    componentKeys: ["role", "context", "task", "format", "verification", "validation"],
  },
  {
    level: 3,
    code: "R-C-G-T-C-E-F-V-V",
    componentKeys: [
      "role",
      "context",
      "goal",
      "task",
      "constraints",
      "examples",
      "format",
      "verification",
      "validation",
    ],
  },
] as const;

const KEYS_ALL = LEVELS[2].componentKeys;

type Status = "strong" | "weak" | "missing";

function fwStatus(key: string, text: string): Status {
  const c = COMPONENTS[key];
  if (!c || !text) return "missing";
  if (c.detect.test(text)) return "strong";
  if (c.soft.test(text)) return "weak";
  return "missing";
}

export interface FrameworkResult {
  frameworkLevel: 1 | 2 | 3 | null;
  frameworkCode: string | null;
  frameworkComponents: string[];
}

export function deriveFrameworkLevel(originalPrompt: string | null | undefined): FrameworkResult {
  const text = String(originalPrompt || "");
  const map: Record<string, Status> = {};
  for (const k of KEYS_ALL) map[k] = fwStatus(k, text);
  const present = KEYS_ALL.filter((k) => map[k] !== "missing");
  const covered = (keys: readonly string[]) =>
    keys.filter((k) => map[k] !== "missing").length / keys.length;

  let level: 1 | 2 | 3 | null = null;
  if (covered(LEVELS[2].componentKeys) >= 0.78) level = 3;
  else if (covered(LEVELS[1].componentKeys) >= 0.8) level = 2;
  else if (covered(LEVELS[0].componentKeys) >= 0.75 || (map.task !== "missing" && present.length >= 3))
    level = 1;

  return {
    frameworkLevel: level,
    frameworkCode: level ? (LEVELS[level - 1]?.code ?? null) : null,
    frameworkComponents: present,
  };
}

/** Legacy badge label: "L2 · R-C-T-F-V-V". */
export function frameworkBadge(level: number | null): string {
  if (!level) return "";
  const L = LEVELS[level - 1];
  return L ? `L${level} · ${L.code}` : "";
}
