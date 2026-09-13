import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, fieldInputClass } from "@/components/ui/Field";
import { PublicHeader } from "@/components/layout/PublicHeader";

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
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <div className="grid min-h-[calc(100vh-62px)] place-items-center px-6 py-12">
        <Card padding="lg" className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1.5 text-sm text-ink-70">Sign in to see today's matches.</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-3">
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldInputClass}
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldInputClass}
              />
            </Field>

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
        </Card>
      </div>
    </div>
  );
}
