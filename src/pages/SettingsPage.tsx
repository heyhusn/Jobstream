import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDeleteAccount, useExportMyData } from "@/hooks/useDataRights";
import { Button } from "@/components/ui/Button";

/**
 * Data rights (roadmap M25 / minor m38): export everything this app
 * holds about you, or delete your account outright. Both are real —
 * export pulls from `export_my_data()`, deletion calls a real Edge
 * Function that cascades through every user-owned table — not
 * placeholders. Profile editing/resume versions (the rest of what
 * this page's old stub promised) aren't built yet; onboarding is
 * still the only way to edit the profile.
 */
export function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const exportData = useExportMyData();
  const deleteAccount = useDeleteAccount();

  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function handleDelete() {
    await deleteAccount.mutateAsync(confirmText);
    await signOut();
    navigate("/sign-in", { replace: true });
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-ink-70">Signed in as {user?.email}.</p>

      <section className="mt-8 rounded-app border border-rule bg-raised px-5 py-4">
        <h2 className="text-sm font-semibold">Export your data</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-70">
          Downloads everything this app holds about you — profile, resumes, applications,
          matches, cover letters, interview sessions, notifications, and usage history — as one
          JSON file.
        </p>
        <Button
          className="mt-3"
          onClick={() => exportData.mutate()}
          disabled={exportData.isPending}
        >
          {exportData.isPending ? "Preparing…" : "Download my data"}
        </Button>
        {exportData.isError && (
          <p role="alert" className="mt-2 text-xs text-ghost">
            Couldn't export your data. Try again.
          </p>
        )}
      </section>

      <section className="mt-6 rounded-app border border-ghost/40 bg-ghost-wash px-5 py-4">
        <h2 className="text-sm font-semibold text-ghost">Delete your account</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-70">
          Permanently deletes your account and everything tied to it — resumes, applications,
          cover letters, interview sessions, everything. This cannot be undone.
        </p>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 text-sm font-semibold text-ghost underline"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-3 space-y-2.5">
            <label className="block text-xs font-medium text-ink-70">
              Type your email ({user?.email}) to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={user?.email ?? ""}
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-ghost"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={
                  deleteAccount.isPending ||
                  confirmText.trim().toLowerCase() !== (user?.email ?? "").toLowerCase()
                }
                className="rounded-app border-[1.5px] border-ghost bg-ghost px-3.5 py-2 text-sm font-semibold text-paper transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteAccount.isPending ? "Deleting…" : "Permanently delete my account"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                }}
                className="text-sm text-ink-70 hover:text-ink"
              >
                Cancel
              </button>
            </div>
            {deleteAccount.isError && (
              <p role="alert" className="text-xs text-ghost">
                {deleteAccount.error instanceof Error
                  ? deleteAccount.error.message
                  : "Couldn't delete the account."}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
