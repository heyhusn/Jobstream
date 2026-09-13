import { Link } from "react-router-dom";

/**
 * Header for logged-out surfaces only (sign in/up, demo, status, 404) — the
 * JobHunt/Jobfolio reference's public nav minus every employer-facing link
 * ("Post a Job", "For Employers"), since JobSpy has no employer side.
 */
export function PublicHeader() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-[62px] max-w-[1100px] items-center gap-6 px-6">
        <Link to="/" className="mr-auto font-display text-lg font-bold tracking-tight">
          job<span className="text-live">spy</span>
        </Link>
        <Link to="/demo" className="hidden text-sm text-ink-70 transition-colors hover:text-ink sm:inline">
          See a demo
        </Link>
        <Link to="/status" className="hidden text-sm text-ink-70 transition-colors hover:text-ink sm:inline">
          Status
        </Link>
        <Link to="/sign-in" className="text-sm font-medium text-ink-70 transition-colors hover:text-ink">
          Log in
        </Link>
        <Link
          to="/sign-up"
          className="rounded-app border-[1.5px] border-ink bg-ink px-4 py-1.5 text-sm font-semibold text-paper transition-colors hover:bg-black"
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}
