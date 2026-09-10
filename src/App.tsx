import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { OnboardingGate } from "@/components/layout/OnboardingGate";
import { AppShell } from "@/components/layout/AppShell";

// Route-level code splitting: signing in shouldn't pay for the
// matches virtualizer, and browsing matches shouldn't pay for the
// PDF-parsing onboarding flow.
const SignInPage = lazy(() => import("@/pages/SignInPage").then((m) => ({ default: m.SignInPage })));
const SignUpPage = lazy(() => import("@/pages/SignUpPage").then((m) => ({ default: m.SignUpPage })));
const OnboardingPage = lazy(() =>
  import("@/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage }))
);
const MatchesPage = lazy(() => import("@/pages/MatchesPage").then((m) => ({ default: m.MatchesPage })));
const TrackerPage = lazy(() => import("@/pages/TrackerPage").then((m) => ({ default: m.TrackerPage })));
const SkillsPage = lazy(() => import("@/pages/SkillsPage").then((m) => ({ default: m.SkillsPage })));
const InterviewPrepPage = lazy(() =>
  import("@/pages/InterviewPrepPage").then((m) => ({ default: m.InterviewPrepPage }))
);
const CompaniesIndexPage = lazy(() =>
  import("@/pages/CompaniesIndexPage").then((m) => ({ default: m.CompaniesIndexPage }))
);
const CompanyPage = lazy(() => import("@/pages/CompanyPage").then((m) => ({ default: m.CompanyPage })));
const SalaryIntelligencePage = lazy(() =>
  import("@/pages/SalaryIntelligencePage").then((m) => ({ default: m.SalaryIntelligencePage }))
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const BillingPage = lazy(() =>
  import("@/pages/BillingPage").then((m) => ({ default: m.BillingPage }))
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RouteFallback() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-ink-70"
        aria-label="Loading"
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/matches" replace />} />
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/sign-up" element={<SignUpPage />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding" element={<OnboardingPage />} />

                <Route element={<OnboardingGate />}>
                  <Route element={<AppShell />}>
                    <Route path="/matches" element={<MatchesPage />} />
                    <Route path="/tracker" element={<TrackerPage />} />
                    <Route path="/skills" element={<SkillsPage />} />
                    <Route path="/interview/:sessionId" element={<InterviewPrepPage />} />
                    <Route path="/companies" element={<CompaniesIndexPage />} />
                    <Route path="/companies/:companyId" element={<CompanyPage />} />
                    <Route path="/salary" element={<SalaryIntelligencePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/billing" element={<BillingPage />} />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
