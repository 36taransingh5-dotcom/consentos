import { dataTypeNoun, isKnownPurpose, PURPOSE_CATALOG } from "./catalog";
import type { Decision } from "./types";

/**
 * One-sentence account of a decision, from the user's point of view:
 *   "Pixly tried to use uploaded images for AI model training."
 *   "Pixly can use uploaded images for personalised recommendations."
 */
export function describeDecision(input: {
  serviceName: string;
  dataType: string;
  purpose: string;
  decision: Decision;
}): string {
  const activity = isKnownPurpose(input.purpose)
    ? PURPOSE_CATALOG[input.purpose].activity
    : input.purpose.replace(/[_-]+/g, " ");
  const data = dataTypeNoun(input.dataType);
  switch (input.decision) {
    case "ALLOW":
      return `${input.serviceName} can use your ${data} for ${activity}.`;
    case "DENY":
      return `${input.serviceName} tried to use your ${data} for ${activity}.`;
    case "REQUIRE_USER":
      return `${input.serviceName} is asking to use your ${data} for ${activity}.`;
  }
}

export function decisionLabel(decision: Decision): "ALLOWED" | "BLOCKED" | "NEEDS YOU" {
  switch (decision) {
    case "ALLOW":
      return "ALLOWED";
    case "DENY":
      return "BLOCKED";
    case "REQUIRE_USER":
      return "NEEDS YOU";
  }
}
