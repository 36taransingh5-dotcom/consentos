/**
 * The Pixly features that need user data, and exactly what each one asks
 * ConsentOS for. Shared by the UI (copy) and the server (the actual request).
 */

export type FeatureId = "essential" | "recommendations" | "memories" | "training";

export interface ConsentAsk {
  dataType: string;
  purpose: string;
  retentionDays?: number;
  thirdPartySharing?: boolean;
}

export interface Feature {
  id: FeatureId;
  title: string;
  /** Mid-sentence phrase: "Pixly asked to use your photos for ___". */
  activity: string;
  /** The ConsentOS purpose, as shown in decision explanations. */
  purposeLabel: string;
  blurb: string;
  cta: string;
  ask: ConsentAsk;
  /** What Pixly says when ConsentOS allows it. */
  allowed: string;
  /** What Pixly says when ConsentOS blocks it. */
  blocked: string;
}

export const FEATURES: Record<FeatureId, Feature> = {
  essential: {
    id: "essential",
    title: "Account storage",
    activity: "your account",
    purposeLabel: "Essential processing",
    blurb: "Keep your account, uploads and settings.",
    cta: "Store my account",
    ask: { dataType: "account", purpose: "essential", thirdPartySharing: false },
    allowed: "Your account is set up.",
    blocked: "Pixly can't store your account.",
  },
  recommendations: {
    id: "recommendations",
    title: "Smart recommendations",
    activity: "smart recommendations",
    purposeLabel: "Personalisation",
    blurb: "Photos picked for you, based on what you upload. Pixly keeps the signals for 30 days.",
    cta: "Enable smart recommendations",
    ask: { dataType: "uploaded_images", purpose: "personalization", retentionDays: 30, thirdPartySharing: false },
    allowed: "Personal recommendations enabled.",
    blocked: "Pixly can't personalise your feed.",
  },
  memories: {
    id: "memories",
    title: "Pixly Memories",
    activity: "Pixly Memories",
    purposeLabel: "Personalisation",
    blurb: "Resurface photos from up to two years ago, on the day you took them.",
    cta: "Turn on Memories",
    ask: { dataType: "uploaded_images", purpose: "personalization", retentionDays: 730, thirdPartySharing: false },
    allowed: "Memories is on.",
    blocked: "Memories would need to keep your photos for two years.",
  },
  training: {
    id: "training",
    title: "Help train Pixly AI",
    activity: "training Pixly AI",
    purposeLabel: "Foundation-model training",
    blurb: "Let Pixly use your photos to improve its image model.",
    cta: "Help train Pixly AI",
    ask: { dataType: "uploaded_images", purpose: "foundation_model_training", retentionDays: 365, thirdPartySharing: false },
    allowed: "Thanks — your photos will help train Pixly AI.",
    blocked: "Your photos cannot be used for foundation-model training.",
  },
};

export const OPTIONAL_FEATURES: FeatureId[] = ["recommendations", "memories", "training"];

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FEATURES, value);
}
