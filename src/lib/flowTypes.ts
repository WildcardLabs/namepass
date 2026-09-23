export type FlowStatus =
  | "queued"
  | "confirming_deposit"
  | "checking_name"
  | "submitting_origin"
  | "waiting_origin"
  | "waiting_attestation"
  | "submitting_claim"
  | "waiting_claim"
  | "held"
  | "unclaimed"
  | "settled"
  | "cancelled"
  | "failed";
