import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useProfile } from "@/hooks/useProfile";

/**
 * A profile with no confirmed parse behind it produces matches
 * that mean nothing — this is the guard that makes the parse
 * confirmation step impossible to skip, not just discouraged.
 */
export function OnboardingGate() {
  const { data: profile, isPending } = useProfile();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-ink-70"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!profile?.onboarded_at && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
