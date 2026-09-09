import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  // Don't redirect on the first render just because the session
  // hasn't resolved yet — that would bounce a signed-in person to
  // the sign-in page for a flash on every hard refresh.
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-ink-70"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
