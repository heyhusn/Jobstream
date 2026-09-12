import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";

export function SignInPage() {
  const { session, signInWithPassword, signInWithGoogle } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/matches";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signInWithPassword(email, password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="font-display text-lg font-bold tracking-tight">
          job<span className="text-live">spy</span>
        </Link>
        <h1 className="mt-8 text-2xl font-semibold">Welcome back</h1>
        <p className="mt-1.5 text-sm text-ink-70">Sign in to see today's matches.</p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-3">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm text-ink-70">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-app border-[1.5px] border-rule bg-raised px-3 py-2.5 text-sm outline-none focus:border-ink"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm text-ink-70">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-app border-[1.5px] border-rule bg-raised px-3 py-2.5 text-sm outline-none focus:border-ink"
            />
          </div>

          {error && (
            <p className="rounded-app border border-ghost/40 bg-ghost-wash px-3 py-2 text-sm text-ghost">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-ink-45">
          <div className="h-px flex-1 bg-rule" />
          or
          <div className="h-px flex-1 bg-rule" />
        </div>

        <Button variant="ghost" className="w-full" onClick={() => signInWithGoogle()}>
          Continue with Google
        </Button>

        <p className="mt-6 text-center text-sm text-ink-70">
          New here?{" "}
          <Link to="/sign-up" className="font-medium text-ink underline underline-offset-2">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-center text-sm text-ink-70">
          <Link to="/demo" className="underline underline-offset-2">
            See a demo first
          </Link>
        </p>
      </div>
    </div>
  );
}
