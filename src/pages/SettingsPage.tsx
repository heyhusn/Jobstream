import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDeleteAccount, useExportMyData } from "@/hooks/useDataRights";
import { useProfile } from "@/hooks/useProfile";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";
import { computeCompleteness } from "@/hooks/useProfileCompleteness";
import { useBlockedCompanies, useUnblockCompany } from "@/hooks/useCompanyBlocklist";
import {
  useNegativeKeywords,
  useAddNegativeKeyword,
  useRemoveNegativeKeyword,
} from "@/hooks/useNegativeKeywords";
import { Button } from "@/components/ui/Button";

/**
 * Data rights (roadmap M25 / minor m38): export everything this app
 * holds about you, or delete your account outright. Both are real —
 * export pulls from `export_my_data()`, deletion calls a real Edge
 * Function that cascades through every user-owned table — not
 * placeholders.
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

      <ProfileSection />

      <SearchFiltersSection />

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

/**
 * Minors m05 (GitHub/portfolio link) and m06 (completeness meter),
 * plus the first post-onboarding edit path for the rest of the
 * profile — without it, m05/m06 would have nowhere for their fields
 * to actually be edited.
 */
function ProfileSection() {
  const { data: profile, isPending } = useProfile();
  const update = useUpdateProfile();

  const [skillsText, setSkillsText] = useState("");
  const [years, setYears] = useState("");
  const [remotePreference, setRemotePreference] = useState<
    "remote" | "hybrid" | "onsite" | "no_preference"
  >("no_preference");
  const [salaryFloor, setSalaryFloor] = useState("");
  const [salaryCurrency, setSalaryCurrency] = useState("USD");
  const [workAuth, setWorkAuth] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const skills = Array.isArray(profile.parsed?.skills) ? (profile.parsed.skills as string[]) : [];
    setSkillsText(skills.join(", "));
    setYears(profile.years_experience != null ? String(profile.years_experience) : "");
    setRemotePreference((profile.remote_preference as typeof remotePreference) ?? "no_preference");
    setSalaryFloor(profile.salary_floor != null ? String(profile.salary_floor) : "");
    setSalaryCurrency(profile.salary_currency ?? "USD");
    setWorkAuth(profile.work_authorisation ?? "");
    setGithubUrl(profile.github_url ?? "");
    setPortfolioUrl(profile.portfolio_url ?? "");
  }, [profile]);

  const { percent, checks } = computeCompleteness(profile);

  function handleSave() {
    const skills = skillsText.split(",").map((s) => s.trim()).filter(Boolean);
    update.mutate(
      {
        skills,
        years_experience: years ? Number(years) : null,
        remote_preference: remotePreference,
        salary_floor: salaryFloor ? Number(salaryFloor) : null,
        salary_currency: salaryCurrency,
        work_authorisation: workAuth.trim() || null,
        github_url: githubUrl.trim() || null,
        portfolio_url: portfolioUrl.trim() || null,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  if (isPending) {
    return (
      <div className="mt-8 h-64 animate-pulse rounded-app bg-raised" aria-hidden="true" />
    );
  }

  return (
    <section className="mt-8 rounded-app border border-rule bg-raised px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Profile</h2>
        <span className="tabular text-xs font-medium text-ink-70">{percent}% complete</span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-rule">
        <span
          className="block h-full rounded-full bg-live transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {checks.some((c) => !c.done) && (
        <ul className="mt-2.5 space-y-1 text-xs text-ink-70">
          {checks
            .filter((c) => !c.done)
            .map((c) => (
              <li key={c.label}>• {c.label}</li>
            ))}
        </ul>
      )}

      <div className="mt-4 space-y-3.5">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-70">Skills</label>
          <textarea
            rows={2}
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            placeholder="python, fastapi, postgresql…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-70">Years of experience</label>
            <input
              type="number"
              min={0}
              max={50}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-70">Work arrangement</label>
            <select
              value={remotePreference}
              onChange={(e) => setRemotePreference(e.target.value as typeof remotePreference)}
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            >
              <option value="no_preference">No strong preference</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-70">Salary floor</label>
            <input
              type="number"
              min={0}
              value={salaryFloor}
              onChange={(e) => setSalaryFloor(e.target.value)}
              placeholder="e.g. 90000"
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-70">Currency</label>
            <input
              type="text"
              value={salaryCurrency}
              onChange={(e) => setSalaryCurrency(e.target.value.toUpperCase().slice(0, 3))}
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-70">Work authorisation</label>
          <input
            type="text"
            value={workAuth}
            onChange={(e) => setWorkAuth(e.target.value)}
            placeholder="e.g. US citizen, needs sponsorship, EU work permit…"
            className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-70">GitHub</label>
            <input
              type="url"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/you"
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-70">Portfolio</label>
            <input
              type="url"
              value={portfolioUrl}
              onChange={(e) => setPortfolioUrl(e.target.value)}
              placeholder="https://you.dev"
              className="w-full rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save profile"}
        </Button>
        {saved && <span className="text-xs text-live">Saved.</span>}
        {update.isError && <span className="text-xs text-ghost">Couldn't save. Try again.</span>}
      </div>
    </section>
  );
}

/**
 * Minors m17 (exclude-companies blocklist) and m18 (negative keyword
 * filters) — the management view for both. The exclusion itself
 * happens on Matches/Search; this is just where the lists get edited
 * once "Hide this company" has been clicked a few times and someone
 * wants to see or undo what's hidden.
 */
function SearchFiltersSection() {
  const { data: blockedCompanies } = useBlockedCompanies();
  const unblock = useUnblockCompany();

  const { data: keywords } = useNegativeKeywords();
  const addKeyword = useAddNegativeKeyword();
  const removeKeyword = useRemoveNegativeKeyword();
  const [keywordInput, setKeywordInput] = useState("");

  function handleAddKeyword() {
    const trimmed = keywordInput.trim();
    if (!trimmed) return;
    addKeyword.mutate(trimmed, { onSuccess: () => setKeywordInput("") });
  }

  return (
    <section className="mt-6 rounded-app border border-rule bg-raised px-5 py-4">
      <h2 className="text-sm font-semibold">Search filters</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-70">
        Companies and keywords hidden from Matches and Search — applied automatically, no need to
        re-hide them each time.
      </p>

      <div className="mt-4">
        <h3 className="text-xs font-medium text-ink-70">Blocked companies</h3>
        {!blockedCompanies || blockedCompanies.length === 0 ? (
          <p className="mt-1.5 text-xs text-ink-45">
            None yet — use "Hide this company" on a job row to add one.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {blockedCompanies.map((c) => (
              <li key={c.company_id} className="flex items-center justify-between gap-3 text-sm">
                <span>{c.canonical_name}</span>
                <button
                  type="button"
                  onClick={() => unblock.mutate(c.company_id)}
                  className="text-xs text-ink-45 underline hover:text-ink"
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-medium text-ink-70">Negative keywords</h3>
        <p className="mt-1 text-xs text-ink-45">
          Hides any posting whose title or description contains one of these — e.g. "clearance
          required", "no sponsorship".
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddKeyword();
              }
            }}
            placeholder="e.g. clearance required"
            className="flex-1 rounded-app border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={handleAddKeyword}
            disabled={addKeyword.isPending || !keywordInput.trim()}
            className="rounded-app border border-ink px-3 py-1.5 text-sm font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {keywords && keywords.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span
                key={k.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-paper py-1 pl-2.5 pr-1.5 text-xs text-ink-70"
              >
                {k.keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword.mutate(k.id)}
                  className="rounded-full px-1 text-ink-45 hover:text-ghost"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
