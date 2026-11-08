# Bills Overview

Approved: separate page showing confirmed bills across an abstract calendar month, usual payment day, typical/range amounts, source account, currency-separated monthly estimates, and separate less frequent bills. Uses existing saved bill history; no extra bank fetching.

Implemented at /#bills-overview. Monthly timing uses median posting day, with a majority of dates within two days of month end displayed at month end. Short months map day 31 to their final day. Weekly/biweekly positioning is an explicitly illustrative phase based on the latest recorded payment; cost totals use 52/12 and 26/12 payments per month rather than the illustrated occurrence count. Quarterly/semiannual/yearly bills appear separately and do not contribute to monthly totals. Irregular or empty-history bills appear unscheduled. Hidden accounts remain excluded through the existing bills API. Transaction descriptions are labeled as descriptions rather than verified recipients. History remains expandable.

Web adaptations: semantic navigation links, ordered timeline, browser details controls, system type, relative sizes and existing 44px targets. The sparse two-column day/list layout adapts to phone widths and wraps long text. Relevant current HIG layout/typography pages were requested; the fetcher returned their JS shells. VoiceOver, enlarged text and interactive browser verification remain outstanding; no accessibility conformance claim.

Validation: projection tests cover month end, ordering, currency separation, irregular/less frequent schedules, and normalized weekly/biweekly totals. Existing tests retained. Estimates are historical patterns, not contractual due dates, forecasts for a selected real month, or guarantees of future amounts.
