interface LinkContext {
  environment: string;
  phase: "link" | "verify";
  linkToken?: string;
  expiresAt: number;
}
export type LinkAction = LinkContext &
  (
    | { mode: "new"; sourceId?: never; operationId?: never }
    | {
        mode: "repair" | "select_accounts";
        sourceId: string;
        operationId?: never;
      }
    | { mode: "replacement"; sourceId: string; operationId: string }
  );
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = "budget_plaid_action";
export function saveLinkAction(storage: SessionStorage, action: LinkAction) {
  storage.setItem(key, JSON.stringify(action));
}
export function cancelLinkAction(storage: SessionStorage) {
  storage.removeItem(key);
}
export function readLinkAction(
  storage: SessionStorage,
  environment: string,
): LinkAction | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  let action: LinkAction;
  try {
    action = JSON.parse(raw);
  } catch {
    cancelLinkAction(storage);
    throw Error(
      "Authorization session expired. Start the action again in Manage data access.",
    );
  }
  if (
    !action ||
    !["new", "repair", "select_accounts", "replacement"].includes(
      action.mode,
    ) ||
    !["link", "verify"].includes(action.phase) ||
    (action.mode !== "new" && typeof action.sourceId !== "string") ||
    (action.mode === "replacement" &&
      (typeof action.operationId !== "string" || !action.operationId))
  ) {
    cancelLinkAction(storage);
    throw Error(
      "Authorization session expired. Start the action again in Manage data access.",
    );
  }
  if (action.environment !== environment) {
    cancelLinkAction(storage);
    throw Error(
      "Authorization environment changed. Start the action again in Manage data access.",
    );
  }
  if (
    action.phase === "link" &&
    (!action.linkToken ||
      !Number.isFinite(action.expiresAt) ||
      action.expiresAt < Date.now())
  ) {
    cancelLinkAction(storage);
    throw Error(
      "Authorization session expired. Start the action again in Manage data access.",
    );
  }
  return action;
}
export async function completeLinkAction(
  storage: SessionStorage,
  action: LinkAction,
  publicToken: string,
  api: (path: string, body: any) => Promise<any>,
) {
  if (action.mode === "replacement") {
    // On a lost response the server operation, not a cached public token, tells us what saved.
    cancelLinkAction(storage);
    return api(
      `/source-replacements/${encodeURIComponent(action.operationId!)}/exchange`,
      { public_token: publicToken },
    );
  }
  if (action.mode === "new") {
    // Public tokens are never persisted, including when exchange fails.
    cancelLinkAction(storage);
    return api("/connect", { public_token: publicToken });
  }
  const pending: LinkAction = {
    ...action,
    phase: "verify",
    linkToken: undefined,
  };
  saveLinkAction(storage, pending);
  const result = await api(
    `/data-sources/${encodeURIComponent(action.sourceId!)}/authorization-complete`,
    {},
  );
  cancelLinkAction(storage);
  return result;
}
