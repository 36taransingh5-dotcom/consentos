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

/** Why a request is waiting for the user, addressed to the user. */
export function pendingReason(reasonCode: string, serviceName: string): string {
  switch (reasonCode) {
    case "PURPOSE_REQUIRES_CONFIRMATION":
    case "PRECISE_LOCATION_REQUIRES_CONFIRMATION":
    case "THIRD_PARTY_SHARING_REQUIRES_CONFIRMATION":
      return "Your rules say to ask you first.";
    case "UNKNOWN_PURPOSE":
      return "ConsentOS doesn't recognise this purpose, so the decision is yours.";
    case "UNKNOWN_DATA_TYPE":
      return "ConsentOS doesn't recognise this kind of data, so the decision is yours.";
    case "RETENTION_UNSPECIFIED":
      return `${serviceName} didn't say how long it would keep the data, so the decision is yours.`;
    default:
      return "Your rules couldn't decide this on their own, so the decision is yours.";
  }
}
