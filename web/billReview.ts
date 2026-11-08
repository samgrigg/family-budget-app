type ReviewEntry = { id: string; status: string; kind: string };
export function nextBillToReview(
  records: ReviewEntry[],
  currentId: string,
): string | null {
  const current = records.findIndex((r) => r.id === currentId);
  const following = [
    ...records.slice(current + 1),
    ...records.slice(0, Math.max(0, current)),
  ];
  return (
    following.find(
      (r) => r.id !== currentId && r.status === "review" && r.kind === "bill",
    )?.id ?? null
  );
}
