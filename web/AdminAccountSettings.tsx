import { useEffect, useRef, useState } from "react";
function AccountInclusion({ account, api, disabled, onChanged }: any) {
  const [checked, setChecked] = useState(account.included);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true),
    running = useRef(false);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  useEffect(() => {
    setChecked(account.included);
  }, [account.included]);
  async function save(included: boolean) {
    if (running.current || disabled) return;
    running.current = true;
    const previous = checked;
    setChecked(included);
    setSaving(true);
    setError("");
    setNotice("");
    let saved = false;
    try {
      await api(`/accounts/${encodeURIComponent(account.id)}/preferences`, {
        included,
      });
      saved = true;
      await onChanged(account.id, included);
      if (active.current) setNotice("Saved");
    } catch (e: any) {
      if (active.current) {
        if (!saved) setChecked(previous);
        setError(
          saved
            ? "Saved, but the page could not refresh. Reload to check the latest settings."
            : `Could not save. Try the checkbox again. ${e.message || ""}`,
        );
      }
    } finally {
      running.current = false;
      if (active.current) setSaving(false);
    }
  }
  return (
    <div className="account-setting-inclusion">
      <label className="account-inclusion">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || saving}
          aria-label={`Include ${account.name}${account.mask ? ` ending ${account.mask}` : ""} in budgeting`}
          onChange={(e) => void save(e.currentTarget.checked)}
        />
        <span>Include in budgeting</span>
      </label>
      <span className="account-setting-status" role="status">
        {saving ? "Saving…" : notice}
      </span>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export default function AdminAccountSettings({
  index,
  api,
  disabled,
  onChanged,
  renameInstitution,
}: any) {
  return (
    <div className="admin-account-settings">
      <div className="account-settings-intro">
        <h2>Account settings</h2>
        <p>
          Checked accounts contribute to bills and income analysis. Changes save
          automatically.
        </p>
        <p>
          {index.accounts.filter((a: any) => a.included).length} of{" "}
          {index.accounts.length} accounts included ·{" "}
          <a href="#accounts">View balances & activity</a>
        </p>
      </div>
      {!index.accounts.length && (
        <p>
          No accounts yet.{" "}
          <a className="back-link" href="#admin/data-access">
            Add a bank connection
          </a>{" "}
          to get started.
        </p>
      )}
      {index.institutions.map((institution: any) => {
        const accounts = index.accounts.filter(
          (a: any) => a.institutionId === institution.id,
        );
        if (!accounts.length) return null;
        return (
          <section
            className="institution-settings"
            key={institution.id}
            aria-labelledby={`settings-institution-${institution.id}`}
          >
            <div className="institution-settings-heading">
              <h3 id={`settings-institution-${institution.id}`}>
                {institution.provisional
                  ? `Institution not yet identified (${institution.name})`
                  : institution.name}
              </h3>
              <span>
                {accounts.length}{" "}
                {accounts.length === 1 ? "account" : "accounts"} ·{" "}
                {accounts.filter((a: any) => a.included).length} included
              </span>
            </div>
            <details className="institution-rename">
              <summary>Rename institution</summary>
              {renameInstitution(institution)}
            </details>
            <ul className="account-settings-list">
              {accounts.map((account: any) => (
                <li className="account-settings-row" key={account.id}>
                  <div className="account-setting-identity">
                    <strong>
                      {account.name}
                      {account.mask ? ` · ••${account.mask}` : ""}
                    </strong>
                    <span>
                      {account.subtype || account.type || "Type unknown"}
                      {account.stale ? " · Connection needs attention" : ""}
                    </span>
                    <a
                      className="account-settings-detail"
                      href={`#admin/accounts/${encodeURIComponent(account.id)}`}
                    >
                      Edit name & details
                    </a>
                  </div>
                  <AccountInclusion
                    account={account}
                    api={api}
                    disabled={disabled}
                    onChanged={onChanged}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
