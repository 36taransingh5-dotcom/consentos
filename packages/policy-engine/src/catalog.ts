import type { PolicyRuleKey, Purpose } from "./types";

export interface PurposeInfo {
  purpose: Purpose;
  /** Policy field that governs this purpose. */
  ruleKey: PolicyRuleKey;
  /** Short label used in lists: "AI model training". */
  label: string;
  /** Formal name used in decision reasons: "Foundation-model training". */
  formal: string;
  /** Phrase that completes "…used for ___": "AI model training". */
  activity: string;
  description: string;
}

export const PURPOSE_CATALOG: Record<Purpose, PurposeInfo> = {
  essential: {
    purpose: "essential",
    ruleKey: "essential",
    label: "Essential account storage",
    formal: "Essential processing",
    activity: "essential account features",
    description: "Storing what a service needs to work at all — your account, your uploads, your settings.",
  },
  analytics: {
    purpose: "analytics",
    ruleKey: "analytics",
    label: "Product analytics",
    formal: "Analytics",
    activity: "product analytics",
    description: "Measuring how a product is used so it can be improved.",
  },
  personalization: {
    purpose: "personalization",
    ruleKey: "personalization",
    label: "Personalised recommendations",
    formal: "Personalisation",
    activity: "personalised recommendations",
    description: "Using your activity to tailor what you see inside the service.",
  },
  advertising: {
    purpose: "advertising",
    ruleKey: "advertising",
    label: "Targeted advertising",
    formal: "Targeted advertising",
    activity: "targeted advertising",
    description: "Using your data to choose which ads you are shown.",
  },
  foundation_model_training: {
    purpose: "foundation_model_training",
    ruleKey: "foundationModelTraining",
    label: "AI model training",
    formal: "Foundation-model training",
    activity: "AI model training",
    description: "Using your content to train general-purpose AI models.",
  },
  third_party_sharing: {
    purpose: "third_party_sharing",
    ruleKey: "thirdPartySharing",
    label: "Third-party sharing",
    formal: "Third-party data sharing",
    activity: "sharing with third parties",
    description: "Passing your data to other companies.",
  },
  precise_location: {
    purpose: "precise_location",
    ruleKey: "preciseLocation",
    label: "Precise location",
    formal: "Precise location tracking",
    activity: "precise location tracking",
    description: "Using your exact location rather than a city or region.",
  },
};

export interface RuleInfo {
  key: PolicyRuleKey;
  /** Label for the policy editor: "AI model training". */
  label: string;
  description: string;
}

/** Display order for the policy editor and the extension. */
export const RULE_CATALOG: RuleInfo[] = [
  {
    key: "essential",
    label: "Essential processing",
    description: "What a service needs to function: your account, uploads and settings.",
  },
  {
    key: "analytics",
    label: "Anonymous analytics",
    description: "Usage measurement, only when the data cannot identify you.",
  },
  {
    key: "personalization",
    label: "Personalised recommendations",
    description: "Tailoring what you see inside the service you are using.",
  },
  {
    key: "advertising",
    label: "Targeted advertising",
    description: "Using your data to decide which ads follow you.",
  },
  {
    key: "foundationModelTraining",
    label: "AI model training",
    description: "Feeding your photos, posts or messages into general-purpose AI models.",
  },
  {
    key: "thirdPartySharing",
    label: "Third-party data sharing",
    description: "Passing your data to companies you did not choose.",
  },
  {
    key: "preciseLocation",
    label: "Precise location",
    description: "Your exact position, rather than your city or region.",
  },
];

export interface DataTypeInfo {
  dataType: string;
  /** Noun phrase used in sentences: "uploaded images". */
  noun: string;
  label: string;
  /** Precise-location data is governed by the precise-location rule whatever the purpose. */
  preciseLocation?: boolean;
}

export const DATA_TYPE_CATALOG: Record<string, DataTypeInfo> = {
  uploaded_images: { dataType: "uploaded_images", noun: "uploaded images", label: "Uploaded photos" },
  profile: { dataType: "profile", noun: "profile information", label: "Profile" },
  account: { dataType: "account", noun: "account data", label: "Account data" },
  email_address: { dataType: "email_address", noun: "email address", label: "Email address" },
  usage_events: { dataType: "usage_events", noun: "usage activity", label: "Usage activity" },
  device_info: { dataType: "device_info", noun: "device information", label: "Device information" },
  contacts: { dataType: "contacts", noun: "contacts", label: "Contacts" },
  messages: { dataType: "messages", noun: "messages", label: "Messages" },
  coarse_location: { dataType: "coarse_location", noun: "approximate location", label: "Approximate location" },
  precise_location: {
    dataType: "precise_location",
    noun: "precise location",
    label: "Precise location",
    preciseLocation: true,
  },
};

export function isKnownPurpose(purpose: string): purpose is Purpose {
  return Object.prototype.hasOwnProperty.call(PURPOSE_CATALOG, purpose);
}

export function isKnownDataType(dataType: string): boolean {
  return Object.prototype.hasOwnProperty.call(DATA_TYPE_CATALOG, dataType);
}

/** Human label for a purpose, falling back to a readable form of unknown ids. */
export function purposeLabel(purpose: string): string {
  return isKnownPurpose(purpose) ? PURPOSE_CATALOG[purpose].label : humanize(purpose);
}

/** Phrase for use mid-sentence: "AI model training", "personalised recommendations". */
export function purposeActivity(purpose: string): string {
  return isKnownPurpose(purpose) ? PURPOSE_CATALOG[purpose].activity : humanize(purpose).toLowerCase();
}

export function dataTypeNoun(dataType: string): string {
  return isKnownDataType(dataType) ? DATA_TYPE_CATALOG[dataType]!.noun : humanize(dataType).toLowerCase();
}

export function dataTypeLabel(dataType: string): string {
  return isKnownDataType(dataType) ? DATA_TYPE_CATALOG[dataType]!.label : humanize(dataType);
}

function humanize(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}
