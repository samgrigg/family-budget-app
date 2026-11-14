import type { ReviewLedger, Contribution } from "../shared/paycheckReview";
export { projectReview as previewReview } from "../shared/paycheckProjection";
export function updateContribution(
  l: ReviewLedger,
  c: Contribution,
): ReviewLedger {
  return {
    ...l,
    contributions: [...l.contributions.filter((v) => v.id !== c.id), c],
  };
}
export function draftChanges(before: ReviewLedger, after: ReviewLedger) {
  const changes: {
    collection: string;
    action: "upsert" | "remove";
    id: string;
    record?: unknown;
  }[] = [];
  for (const collection of [
    "sources",
    "paychecks",
    "obligations",
    "contributions",
    "settlements",
    "reviews",
  ] as const) {
    const id = (r: any) => (collection === "reviews" ? r.paycheckId : r.id);
    for (const r of after[collection])
      if (
        JSON.stringify(before[collection].find((v) => id(v) === id(r))) !==
        JSON.stringify(r)
      )
        changes.push({ collection, action: "upsert", id: id(r), record: r });
    for (const r of before[collection])
      if (!after[collection].some((v) => id(v) === id(r)))
        changes.push({ collection, action: "remove", id: id(r) });
  }
  return changes;
}
