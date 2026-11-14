# Paycheck review: agreed use case

## Purpose

When a paycheck arrives, understand what work that money must do before
replenishment, decide its contribution to shared credit card obligations,
and see what remains safe to spend. This round concerns task completion
and clarity; aesthetic refinement comes later.

This records the owner's agreed use case. It is not an implementation
design or authorization for a particular screen or calculation model.

## Review context

- Canyons income goes to MACU; Adobe income goes to Etrade.
- Each institution funds different expenses.
- Reviews happen separately as each paycheck arrives.
- Each source has its own next payday and funding review. Defining a
  general pay-period engine is outside this discovery work.
- Credit card payments may be split between both institutions. Splits
  currently vary; no automatic allocation policy has been agreed.
- A surplus at one institution does not automatically fund the other.

## Funding order

1. Reserve for predictable commitments due before that income source's
   next paycheck.
2. Fund card payments due before replenishment, accounting for explicit
   contributions from either income source.
3. Reserve remaining current-paycheck cash for card purchases already
   made whose payments are due later.
4. Show the remaining current-paycheck amount as safe to spend.

Future paychecks help fund past card purchases only as needed. This is
possible but discouraged, and the review must make the reliance visible.

## Answers the review must provide

### Safe to spend now

The amount remaining from this paycheck after obligations and card
reservations. Card purchases already made reduce this amount even when
their statement is not yet due. Future paychecks never increase it.

Earlier paychecks' leftovers remain separate. The review must make a
positive remainder easy to identify for putting toward a financial goal;
goal management and automatic transfers are outside this round.

### Payments due before replenishment

Show whether predictable commitments and credit card payments due before
the next payday are covered. Insufficient funding for payments due is a
payment shortfall; money held separately from earlier paychecks is not
silently used to hide it.

An explicitly assigned contribution from the other employer's upcoming
paycheck may help cover a card payment if it arrives before that payment
is due. Until received, it must remain distinguishable as planned future
funding rather than cash reserved now.

### Credit card coverage

Distinguish the unpaid last statement from purchases going onto a future
statement. Show existing reservations from both income sources and any
remaining funding need without counting either money or obligations twice.

Assess whether purchases already made can be covered by cash reserved now
plus paychecks arriving before payment is due, accounting for those
paychecks' other commitments and allocations. The same future income
cannot be promised to multiple obligations.

Insufficient current cash for a card balance due later does not itself
constitute a payment shortfall. Distinguish cash-backed purchases,
reliance on future paychecks, and amounts still uncovered by the due date.

## Intended task flow

1. Identify the arrived paycheck and its institution.
2. Review predictable commitments before that source's next payday.
3. Review shared card obligations and existing funding contributions.
4. Explicitly choose or adjust this paycheck's contribution.
5. See safe to spend, payment shortfalls, and future-paycheck reliance,
   with an understandable explanation of the amounts.

Contributions must carry forward between reviews so that the next review
recognizes what has already been reserved or assigned.

## Current-app context

The repository contains income-source review and historical projections,
planned commitments and monthly payment records, transactions, transfers,
and Money Flow. These are ingredients, not an existing paycheck review.
The README explicitly notes that current card-payment support does not
retrieve balances or statements. No new provider capability or live
financial data was checked during this discovery.

## Decisions for the next design discussion

- How the owner enters or verifies statement balances, due dates, and
  purchases assigned to the next statement when data is unavailable.
- How current-paycheck spending, reservations, and actual card payments
  reconcile without reducing available money twice.
- How to present and persist adjustable contributions across reviews.
- How incomplete information affects whether an answer can be shown.
- How contributions from different institutions reach the paying account
  in time, including any required transfer or payment processing time.
- Whether a systematic split can be recommended after the manual review
  flow is understood. No percentage or optimization rule is assumed.

Expected discretionary spending, goal management, and an aesthetic pass
remain outside this use case. Current HIG review and mobile, keyboard,
large-text, and VoiceOver verification belong to the subsequent UI work;
this document makes no accessibility conformance claim.

## Review status

Checked against the owner's decisions in this conversation. The owner
waived the separate-model requirement for this round. Both Ninth House
review voices were generated with the current model.

- Gideon: keep promised future contributions distinct from cash already
  reserved, and avoid counting purchases again when card payments occur.
- Harrow: coverage requires money to reach the paying account before the
  due date; explicitly resolve transfer timing alongside statement data
  and payment reconciliation in the implementation design.

Verdict: proceed with the agreed use case. These design questions remain
explicit; this is not a completed implementation design.
