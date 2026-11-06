/**
 * Reasoning tier vocabulary shared by the composer picker and the Providers
 * page's default-thinking setting. Kept free of React and storage so neither
 * surface has to import the other (a cycle would evaluate the default during
 * module init).
 */
export type ReasoningEffort =
  | "auto"
  | "none"
  | "max"
  | "ultra"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "auto";

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "none" || value === "max" || value === "ultra" || value === "auto" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : DEFAULT_REASONING_EFFORT;
}

/** Every tier in slider order; "auto" first and "none" (Off) second. */
export const REASONING_EFFORT_ORDER: readonly ReasoningEffort[] = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
