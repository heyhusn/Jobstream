import { Link } from "react-router-dom";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { DonutRing } from "@/components/ui/DonutRing";

interface SampleMatch {
  title: string;
  company: string;
  location: string;
  salary: string;
  score: number;
  riskLabel: string;
  riskTone: "live" | "neutral";
  breakdown: { label: string; delta: number; pass: boolean }[];
}

// Hand-written, clearly fictional — never sourced from a real
// ingested job or a real user's data. This is the one page in the
// app that does not touch Supabase at all.
const SAMPLE_MATCHES: SampleMatch[] = [
  {
    title: "Senior Backend Engineer",
    company: "Northwind Data",
    location: "Remote, EU",
    salary: "EUR 85K–110K",
    score: 91,
    riskLabel: "Looks real",
    riskTone: "live",
    breakdown: [
      { label: "Semantic similarity score: 82%", delta: 82, pass: true },
      { label: "Work arrangement matches your preference", delta: 12, pass: true },
      { label: "Salary range meets your stated floor", delta: 10, pass: true },
    ],
  },
  {
    title: "Platform Engineer, Infrastructure",
    company: "Rivermark",
    location: "Berlin, hybrid",
    salary: "EUR 90K–120K",
    score: 84,
    riskLabel: "Worth a second look",
    riskTone: "neutral",
    breakdown: [
      { label: "Semantic similarity score: 74%", delta: 74, pass: true },
      { label: "Reposted 4× — worth a closer look", delta: -10, pass: false },
      { label: "Salary range meets your stated floor", delta: 10, pass: true },
    ],
  },
  {
    title: "Machine Learning Engineer",
    company: "Aldermere Labs",
    location: "Remote",
    salary: "USD 130K–160K",
    score: 78,
    riskLabel: "Looks real",
    riskTone: "live",
    breakdown: [
      { label: "Semantic similarity score: 71%", delta: 71, pass: true },
      { label: "Not your preferred work arrangement (onsite)", delta: -10, pass: false },
    ],
  },
];

/**
 * Minor m32: demo mode with sample data, no signup required. This
 * page deliberately never calls Supabase — it's static, hand-written
 * sample data replicating the real Matches page's layout, not a
 * "demo user" account or a real query with fake auth. Anyone can
 * open it from the sign-in/sign-up pages to see what the product
 * looks like before creating an account.
 */
export function DemoPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-[62px] max-w-[1100px] items-center gap-6 px-6">
          <span className="mr-auto font-display text-lg font-bold tracking-tight">
            job<span className="text-live">spy</span>
          </span>
          <Badge tone="neutral" className="rounded-full">Demo — sample data, not live</Badge>
          <Link
            to="/sign-up"
            className="rounded-app border-[1.5px] border-ink bg-ink px-3.5 py-1.5 text-sm font-semibold text-paper hover:bg-black"
          >
            Create a free account
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 py-10">
        <h1 className="text-2xl font-semibold">Your matches</h1>
        <p className="mt-1 text-sm text-ink-70">
          3 sample jobs cleared the bar. This is fictional data so you can see how the real page
          looks and works — <Link to="/sign-up" className="underline">sign up</Link> to see your
          own.
        </p>

        <Card padding="none" className="mt-5 px-4">
          {SAMPLE_MATCHES.map((m, i) => (
            <div key={m.title} className={i > 0 ? "border-t border-rule-soft" : ""}>
              <div className="flex items-start gap-3 px-1 py-4">
                <Avatar name={m.company} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{m.title}</span>
                    <Badge tone={m.riskTone}>{m.riskLabel}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-ink-45">
                    {m.company} — {m.location} — {m.salary}
                  </div>
                </div>
                <div className="shrink-0 pt-0.5">
                  <DonutRing value={m.score} />
                </div>
              </div>
              <div className="mb-4 rounded-app border border-rule-soft bg-raised px-4 py-3">
                <ul className="space-y-2">
                  {m.breakdown.map((s, j) => (
                    <li key={j} className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="flex items-baseline gap-2">
                        <span className={s.pass ? "font-bold text-live" : "font-bold text-ghost"}>
                          {s.pass ? "+" : "−"}
                        </span>
                        {s.label}
                      </span>
                      <span className={`tabular shrink-0 ${!s.pass ? "text-ghost" : "text-ink-45"}`}>
                        {s.delta > 0 ? "+" : ""}
                        {s.delta}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </Card>

        <p className="mt-6 text-center text-sm text-ink-70">
          Ready to see your own matches?{" "}
          <Link to="/sign-up" className="font-medium text-ink underline underline-offset-2">
            Create a free account
          </Link>
        </p>
      </main>
    </div>
  );
}
