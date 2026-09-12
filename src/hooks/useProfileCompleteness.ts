export interface CompletenessCheck {
  label: string;
  done: boolean;
}

export interface ProfileForCompleteness {
  parsed: Record<string, unknown> | null;
  years_experience: number | null;
  salary_floor: number | null;
  work_authorisation: string | null;
  github_url: string | null;
  portfolio_url: string | null;
}

/**
 * Minor m06: a completeness meter with specific next actions, not
 * just a bare percentage. Every check here maps to a real editable
 * field on the profile section directly above it — nothing on this
 * list is something the person has no way to act on.
 */
export function computeCompleteness(profile: ProfileForCompleteness | null | undefined): {
  percent: number;
  checks: CompletenessCheck[];
} {
  const skills = Array.isArray(profile?.parsed?.skills) ? (profile!.parsed!.skills as unknown[]) : [];

  const checks: CompletenessCheck[] = [
    { label: "List at least one skill", done: skills.length > 0 },
    { label: "Set years of experience", done: (profile?.years_experience ?? 0) > 0 },
    { label: "Set a salary floor", done: profile?.salary_floor != null },
    { label: "Add your work authorisation", done: !!profile?.work_authorisation?.trim() },
    {
      label: "Add a GitHub or portfolio link",
      done: !!(profile?.github_url?.trim() || profile?.portfolio_url?.trim()),
    },
  ];

  const percent = Math.round((checks.filter((c) => c.done).length / checks.length) * 100);
  return { percent, checks };
}
