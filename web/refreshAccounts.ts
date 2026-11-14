export function canRefreshSource(source: any) {
  return (
    !["historical", "revoke_required", "needs_authorization"].includes(
      source.status,
    ) &&
    !source.missingAccessCredential &&
    !source.recoveryOnly &&
    !source.replacementPending
  );
}
export async function refreshAccountSources(
  api: (path: string, body: any) => Promise<any>,
  sources: any[],
  active = () => true,
) {
  const refreshed: string[] = [],
    failed: { id: string; message: string }[] = [];
  const eligible = [
    ...new Map(sources.filter(canRefreshSource).map((s) => [s.id, s])).values(),
  ];
  for (const source of eligible) {
    if (!active()) break;
    try {
      await api(`/data-sources/${encodeURIComponent(source.id)}/sync`, {});
      refreshed.push(source.id);
    } catch (e: any) {
      failed.push({
        id: source.id,
        message: e.message || "Could not refresh this connection.",
      });
    }
  }
  return { refreshed, failed };
}
