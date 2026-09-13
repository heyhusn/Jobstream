import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, fieldInputClass } from "@/components/ui/Field";
import { PublicHeader } from "@/components/layout/PublicHeader";

export function SignUpPage() {
  const { session, signUpWithPassword, signInWithGoogle } = useAuth();
  const [searchParams] = useSearchParams();
  // Minor m39: a referral link is just /sign-up?ref=CODE — carried
  // through to signUp() as user metadata, never written by the
  // client directly (see handle_new_user(), migration 0030).
  const referralCode = searchParams.get("ref");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  if (session) return <Navigate to="/onboarding" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signUpWithPassword(email, password, fullName, referralCode);
    setSubmitting(false);
    if (error) setError(error);
    else setCheckEmail(true);
  }

  if (checkEmail) {
    return (
      <div className="min-h-screen bg-paper">
        <PublicHeader />
        <div className="grid min-h-[calc(100vh-62px)] place-items-center px-6 py-12">
          <Card padding="lg" className="w-full max-w-sm text-center">
            <h1 className="text-2xl font-semibold">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-70">
              We sent a confirmation link to <strong className="text-ink">{email}</strong>. Click
              it to finish creating your account.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <div className="grid min-h-[calc(100vh-62px)] place-items-center px-6 py-12">
        <Card padding="lg" className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">Start with the nine, not the fourteen hundred</h1>
          <p className="mt-1.5 text-sm text-ink-70">Free to start. No card.</p>
          {referralCode && <p className="mt-2 text-xs text-live">You were referred by a friend.</p>}

          <form onSubmit={handleSubmit} className="mt-7 space-y-3">
            <Field label="Full name" htmlFor="fullName">
              <input
                id="fullName"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={fieldInputClass}
              />
            </Field>
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
            <Field label="Password" htmlFor="password" hint="At least 8 characters.">
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
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
              {submitting ? "Creating account…" : "Create account"}
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
            Already have an account?{" "}
            <Link to="/sign-in" className="font-medium text-ink underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
