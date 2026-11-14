import type { FundingSource, ReviewLedger } from "../shared/paycheckReview";
export async function saveIncomeSource(
  api: (path: string, body?: any) => Promise<any>,
  data: { ledger: ReviewLedger; evidence: { digest: string } },
  draft: ReviewLedger,
  source: FundingSource,
) {
  const result = await api("/paycheck-review", {
    expectedRevision: data.ledger.revision,
    evidenceDigest: data.evidence.digest,
    changes: [
      {
        collection: "sources",
        action: "upsert",
        id: source.id,
        record: source,
      },
    ],
  });
  return {
    data: result,
    ledger: {
      ...draft,
      revision: result.ledger.revision,
      sources: result.ledger.sources,
    } as ReviewLedger,
  };
}
