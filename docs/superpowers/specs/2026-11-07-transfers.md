# Internal transfers

Approved scope: matching across any onboarded accounts, including hidden accounts and credit-card payments; strong matches automatic, ambiguity reviewed. Original transactions retained.

Posted transactions with nonempty equal currencies and exactly opposite numeric amounts on different account identities are candidates within five calendar days. Both descriptions must contain transfer/xfer/payment/pmt/autopay and dates must be within three days for automatic confirmation. Both legs must have exactly one candidate. Pair decisions persist by environment and fingerprint of both transactions; changed/deleted data invalidates decisions. Explicit confirmations reserve both transactions. Undo rejects a pair, preventing automatic reclassification of unchanged data; reconsider removes that decision. Matching is recomputed from stored history when state/bills are loaded, including after sync. No new bank fetch or Plaid flow changes.

Confirmed pairs are labeled in transactions and excluded from bill discovery (including saved bill history). There are currently no income/spending aggregate totals to adjust. UI provides Review/Confirmed/Rejected views and explains automatic versus manual decisions. Account filtering applies to transactions and Bills; the transfer review shows all onboarded accounts so both sides stay reviewable.

Limitations: heuristics can misclassify payment/refund coincidences; duplicate accounts onboarded through separate connections remain distinct and may create ambiguity. Fees, split transfers, foreign exchange and posting gaps longer than five days are not matched. Non-candidates are not manually pairable in this version. Full-history computation may need further optimization as history grows.

Verification: 21 tests pass, including ambiguity, pending/currency/date exclusions, visibility, undo, environment isolation, changed data, and bill exclusions; typecheck/build pass. HIG buttons reference consulted but text endpoint only supplied JS shell. Semantic browser buttons and existing 44px targets reused. Visual/large-text/VoiceOver verification outstanding; no accessibility conformance claim.

## Owner correction: debt payments

Loan and credit-card payments must remain payments/bills even when both accounts are onboarded. Matching now requires both accounts to have provider type `depository`. Missing account types are excluded conservatively until the next sync retrieves them. Account type metadata is persisted independently; existing data is migrated additively. Prior automatic/manual matches involving debt or unknown account types no longer qualify and cease excluding those transactions. The bill payee filter no longer drops credit-card payment descriptions categorically. This replaces the original credit-card-payment scope above.
