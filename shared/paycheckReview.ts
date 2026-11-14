// shared/paycheckReview.ts
export type FundingSource = {
  id: string;
  name: string;
  accountId: string;
  incomeKey: string | null;
};
export type Paycheck = {
  id: string;
  sourceId: string;
  transactionId: string | null;
  state: "received" | "expected";
  amountMinor: number;
  currency: string;
  date: string;
  nextPayday: string;
  commitmentsConfirmed: boolean;
};
export type Obligation = {
  transactionIds?: string[];
  id: string;
  kind: "commitment" | "statement" | "unbilled";
  name: string;
  accountId: string;
  fundingSourceId: string | null;
  planId: string | null;
  statementKey: string | null;
  amountMinor: number | null;
  currency: string;
  dueDate: string | null;
  neededBy: string | null;
  basis: "manual" | "plan" | "provider";
  confirmed: boolean;
};
export type Contribution = {
  id: string;
  paycheckId: string;
  obligationId: string;
  amountMinor: number;
  paymentAccountId: string;
  neededBy: string;
};
export type Settlement = {
  id: string;
  obligationId: string | null;
  paycheckId: string;
  contributionId: string | null;
  amountMinor: number;
  transactionIds: string[];
  confirmed: boolean;
};
export type Review = {
  paycheckId: string;
  completedAt: string | null;
  evidenceDigest: string;
};
export type ReviewLedger = {
  revision: number;
  sources: FundingSource[];
  paychecks: Paycheck[];
  obligations: Obligation[];
  contributions: Contribution[];
  settlements: Settlement[];
  reviews: Review[];
};
export type ReviewProjection = {
  paycheckId: string;
  safeToSpendMinor: number | null;
  paymentShortfallMinor: number;
  futureRelianceMinor: number;
  unassignedCardMinor: number;
  leftoverMinor: number | null;
  issues: { code: string; recordId: string; message: string }[];
  obligationCoverage: {
    obligationId: string;
    cashMinor: number;
    futureMinor: number;
    paidMinor: number;
    uncoveredMinor: number | null;
  }[];
};
