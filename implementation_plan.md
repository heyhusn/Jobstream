# Master Product Specification
## Two Platforms — One Vision: AI-Powered Opportunity Intelligence

---

> **Context:** You are building TWO separate but related products. This document covers both.
> 
> - **Platform A:** AI Job Intelligence Platform (JobSpy → Full SaaS)
> - **Platform B:** Verified Study Abroad Platform (Pakistan → Germany peer mentor marketplace)

---

# ═══════════════════════════════════════
# PLATFORM A: AI JOB INTELLIGENCE PLATFORM
# ═══════════════════════════════════════

## What Exists Now
A Python CLI scraper querying 8 job sources (Indeed, LinkedIn, Google, Glassdoor + Himalayas, Remotive, Arbeitnow, RemoteOK) with a rule-based keyword engine and a React/Vite/Tailwind frontend that visualizes CSV uploads.

**No API. No database. No auth. No real AI. Local only.**

## Target Stack
```
Backend:     FastAPI + SQLAlchemy async + asyncpg
Database:    PostgreSQL + pgvector (semantic search)
Queue:       Redis + Celery (background scrapers)
AI/LLM:      Gemini API / GPT-4o for generation tasks
Embeddings:  sentence-transformers / text-embedding-3-small
Auth:        Clerk.dev or Supabase Auth (JWT + Google OAuth)
Storage:     Cloudflare R2 / AWS S3 (resume uploads)
Deploy:      Railway.app (backend) + Vercel (frontend)
Monitoring:  Sentry + Flower + Uptime Robot
```

## 25 Major Features

### TIER 1 — CORE PLATFORM
1. **FastAPI REST Backend** — routes, async models, WebSocket streaming, replaces CLI
2. **PostgreSQL + pgvector** — persistent jobs, users, search sessions, vector embeddings
3. **AI Resume Parser** — PDF/DOCX → structured JSON profile via LLM
4. **Semantic Job Matching** — vector embeddings replace keyword scoring (cosine sim)
5. **Real-Time Scraping API** — Celery tasks + SSE streaming to frontend
6. **AI Cover Letter Generator** — resume + JD → editable, exportable cover letter
7. **User Auth System** — Google OAuth, JWT, rate limiting, role-based access
8. **Application Tracker (Kanban)** — Saved→Applied→Interview→Offer columns, notes, AI auto-fill
9. **AI Interview Prep Agent** — question generation, STAR templates, mock chat interview
10. **Smart Job Alert System** — Celery Beat cron, email/WhatsApp/push notifications
11. **Ghost Job Detector** — AI classifier flags stale/fake listings (date, URL, pattern analysis)
12. **Salary Intelligence Module** — Levels.fyi + Glassdoor + AI interpolation per listing
13. **Company Intelligence Cards** — tech stack, funding, Glassdoor rating, news, AI fit analysis
14. **Skill Gap Analyzer** — resume vs. JD → missing skills + learning roadmap
15. **AI Resume Optimizer** — ATS score, keyword suggestions, before/after diff

### TIER 2 — AI AGENTS
16. **Autonomous Auto-Apply Agent** — Playwright form-fill, tailored docs, daily quota, tracker sync
17. **Natural Language Job Search** — "Remote ML jobs $120k+ this week" → SQL + vector query
18. **Multi-Source Pipeline (15+ sources)** — Wellfound, Otta, Dice, Jora, StackOverflow Jobs, YC
19. **Real-Time Market Analytics** — hiring trends, skill demand, company velocity, remote vs. onsite
20. **ATS Resume Scanner** — test against Greenhouse, Lever, Workday, Taleo simulators
21. **Personalized Learning Path** — 4/8/12-week curriculum from skill gaps, with resource links
22. **Browser Extension** — match score overlay on LinkedIn/Indeed, one-click cover letter + save
23. **Recruiter Outreach AI Agent** — finds hiring managers, drafts 3-variant cold messages
24. **Multi-Language + Global Markets** — 10 languages, 10 markets, auto-translate JDs
25. **Subscription + Monetization** — Stripe, Free/Pro/Enterprise tiers, feature gates

## 40 Minor Features
### UX
1. Dark/light mode | 2. Quick preview modal | 3. Saved filter presets | 4. Keyboard shortcuts
5. Infinite scroll + virtual list | 6. Column customizer | 7. Color-coded relevance badges
8. Onboarding tour | 9. Job comparison mode (3 side-by-side) | 10. Full mobile layout

### Data
11. Duplicate collapse (same job, 3 sources) | 12. Freshness indicator (posted X hours ago)
13. Company logo (Clearbit/Brandfetch) | 14. LinkedIn Easy Apply badge | 15. Skills tag cloud
16. Salary-disclosed filter | 17. H1B/visa sponsorship filter | 18. JD readability score
19. Glassdoor rating badge | 20. "Jobs like this" recommendations

### Analytics
21. Application funnel dashboard | 22. Best days to apply analysis | 23. Skill demand trend chart
24. Company hiring velocity | 25. Source quality scoring | 26. Weekly digest email | 27. Response rate by company size

### AI Micro
28. "Explain why this matches me" | 29. JD red flag detector (unpaid trial, rockstar ninja)
30. Auto-tag by type (startup/corporate/contract) | 31. Glassdoor review sentiment
32. Interview difficulty estimator | 33. Rejection email analyzer | 34. LinkedIn profile optimizer
35. "Is this job real?" fact-check (company website + LinkedIn + Crunchbase)

### Integrations
36. Notion integration | 37. Google Sheets live sync | 38. Telegram bot alerts
39. Google/Outlook Calendar sync | 40. Zapier/Make.com webhooks

## Build Priority — Job Platform
| Phase | Duration | Focus |
|---|---|---|
| 1 | Weeks 1–4 | FastAPI + PostgreSQL + Auth + Vercel/Railway deploy |
| 2 | Weeks 5–8 | Resume parser + Semantic matching + Cover letter generator |
| 3 | Weeks 9–12 | Agents (alerts, interview prep, auto-apply) + Kanban |
| 4 | Weeks 13–16 | Stripe + Browser extension + Analytics + 15+ sources |
| 5 | Ongoing | 40 minor features in batches |

---

# ══════════════════════════════════════════════════════
# PLATFORM B: VERIFIED STUDY ABROAD PLATFORM
# Pakistan → Germany Corridor | Peer Mentor Marketplace
# ══════════════════════════════════════════════════════

## Product Thesis
> A trusted, AI-powered study-abroad operating system whose wedge is a **verified marketplace of students who have already made the exact journey** the user is about to attempt.

**The gap:** 67% of students use AI for study research (Keystone, Aug 2025), but only 36% trust it. The real competitor is an unregulated Facebook/WhatsApp group — unverified, unesccrowed, no recourse. Pakistani consultancy fraud is documented at scale (Express Tribune: Lahore student paid Rs 1M, got nothing, filed FIA complaint).

**What survives:** Verified human who was physically there + escrow payment system + knowledge base that improves monthly.

---

## Competitor Limitations → Feature Responses

| Competitor | Documented Gap | Platform Response |
|---|---|---|
| Unibuddy / Ambassador | Institution-locked, conversion incentive not candour | Cross-university matching; mentors earn from session fees, not enrolment |
| ApplyBoard / IDP | Can't recommend non-partner universities | Revenue from sessions only; "Why Not This University" transparency panel |
| Leap Scholar / Yocket | Restricted university lists, wrong DS-160 visa guidance | Official/Experience/AI badge architecture; dispute console with encoded resolution |
| Studyportals / Keystone | Strong search, no verified human trust layer | People Like Me cohort engine layered onto every AI answer |
| Ambitio / GradRight | Strong pre-admission; nothing for visa/arrival | Application Command Center through Arrival Mode |
| Facebook / WhatsApp | No identity verification, no escrow, no recourse | Five-level verification + escrow + Compliance Guardrail Agent |

---

## SECTION 3 — Common Platform Features

### Identity, Access & Localization
- Unified account (email/phone OTP, Google/Apple OAuth, mandatory 2FA above transaction threshold)
- Bilingual interface: English + Urdu, with German-term glossary (Sperrkonto, Ausländerbehörde, Aufenthaltstitel) as tooltips
- Low-bandwidth mode: text-light render path for async Q&A, document checklist, knowledge base

### Communication & Notifications
- **Masked in-platform messaging** pre-booking — no phone numbers/external handles until session confirmed + escrowed
- Multi-channel notifications: in-app + email + WhatsApp Business API (Meta Cloud API) — transactional one-way messages
- Deadline/change notifications targeted by student stage and destination

### Payments Infrastructure
> **Critical:** Card penetration in Pakistan <5%. JazzCash + Easypaisa = majority of digital transactions. Stripe/PayPal don't serve Pakistani residents (SBP FX/AML restriction, not technical).

- **Collection (students, Pakistan):** SBP-licensed PSP aggregator (PayFast/GoPayFast or Safepay-class) — JazzCash, Easypaisa, cards, Raast bank-to-bank via single checkout
- **Payout (mentors, EU):** SEPA as default for EU mentors; Payoneer + Wise as fallback
- Central escrow ledger: holds from booking → session completion → fixed post-session release window
- FX exposure dashboard: PKR collection → EUR payout spread tracked as explicit P&L line

### Trust & Safety Baseline
- Report/block from any profile, message, or session
- Automated message moderation: contact-detail sharing, off-platform payment solicitation, outcome-guarantee language
- **Document vault:** encryption at rest, per-session scoped sharing, default deletion windows

### Source Reliability Layer (Infrastructure, renders everywhere)
- **Official / Experience / AI badge architecture** — three types, never merged:
  - **Official:** carries issuing authority + verification date
  - **Experience:** attributed to named, verification-level-tagged mentor
  - **AI:** synthesis of the other two, labelled as such, never presented as independent source
- "Last verified" timestamp on every official fact + automatic staleness warning past review window

---

## SECTION 4 — AI Features (User-facing, always-on)

### 4.1 Source-Grounded AI Advisor
RAG over curated, versioned knowledge base (never open web) covering visa rules, funding thresholds, program requirements, work regulations. Every answer shows Official/Experience/AI badge + source + verification date. **Explicitly declines individualized legal/immigration advice** — redirects to mentor or official channel. (Prevents Air Canada chatbot-style liability; avoids UK IAA and German §20 RDG licensing requirements.)

### 4.2 Country Fit Score
Multi-factor scoring: academic fit, financial fit, visa predictability, language fit, career/post-study outcomes, scholarship availability → ranked shortlist of destinations with per-factor reasoning shown. Never a black-box number.

### 4.3 Application Readiness Engine ("Reality Check")
Six weighted components: academic eligibility, language readiness, financial readiness, documentation, university shortlist quality, visa readiness. Each explains its gap + points to next action or mentor category.

> **HARD BOUNDARY:** Reports readiness against stated requirements only. Never outputs admission probability or visa approval probability. Directly answers the "telling students what they want to hear" pattern documented in Leap Scholar/Yocket reviews.

### 4.4 Scholarship Match Engine
Structured matching (not keyword search) against: CGPA, field, nationality, financial need, intake. Sourced from DAAD official database + equivalent authoritative funders. Each result shows: funding type (fully funded/partial/tuition waiver/need-based/merit-based), eligibility, deadline, required documents.

### 4.5 "People Like Me" Cohort Matching
Anonymized outcome matching against students with similar academic + financial profile who completed the same corridor. "14 students with a profile like yours applied to Germany last cycle; here's where they were admitted." Converts platform's outcome dataset into a compounding advantage no scraped-data competitor can replicate.

### 4.6 Real-Time Translation
In-session live translation (LiveKit Agents real-time media pipeline) for mentor-student pairs comfortable in Urdu, German, or English at different conversation points.

### 4.7 Conversational Profile Builder
Natural-language onboarding: "I have a 3.5 CGPA in software engineering and want an AI master's in Germany on a tight budget" → extracts + confirms structured fields. Form fallback exists but is not default path.

---

## SECTION 5 — AI Agents (Multi-step, semi-autonomous, explicit trigger/output/guardrail)

### Agent 1: Onboarding Concierge Agent
- **Trigger:** New student signup
- **Action:** Converts free-form description → structured profile schema (4.7). Asks only for 2-3 fields it couldn't confidently extract. Never guesses CGPA scale or budget — asks rather than assumes.

### Agent 2: Ask-a-Verified-Student Matching Agent
- **Trigger:** Natural-language mentor search ("MSc AI in Germany, visa interview in 6 weeks")
- **Action:** Parses → stage/corridor/topic filters → ranks available mentors → returns each with one-line evidence-based reason ("did the Islamabad embassy interview in March 2026"). Ranking logic exposed to user — never a silent black box.

### Agent 3: Knowledge Freshness / Source-Watcher Agent
- **Trigger:** Scheduled crawl of official source registry
- **Polls:** Hochschulkompass, DAAD scholarship DB, Make it in Germany, Federal Foreign Office, embassy pages (per-source cadence)
- **Action:** Diffs new content against last-approved version → routes only changed passage to human reviewer (not full page = throughput unlock). On approval: stamps new verification date, **invalidates every cached AI answer that cited the old figure**, triggers targeted-notification agent.
- **This is the platform's core technical moat.**

### Agent 4: Targeted Change-Notification Agent
- **Trigger:** Approved knowledge-base change
- **Action:** Identifies every student whose stage + destination makes the change relevant → pushes ONE notification, once. Not a broadcast. (e.g., revised blocked-account amount reaches only students targeting Germany at pre-visa stage)

### Agent 5: Document Intake & Checklist Agent
- **Trigger:** Document upload
- **Action:** OCR + field extraction from passports, transcripts, financial statements → auto-updates checklist status, flags expiry dates. Never makes authoritative eligibility decision — flags for human/mentor review when field looks inconsistent.

### Agent 6: Session Co-Pilot Agent
- **Trigger:** Live video session starts
- **Action:** Joins LiveKit room as silent participant. Produces live transcript, generates structured post-session artifact (summary, action items, resource links) for mentor review + send. Offers real-time translation on request.
- Recording/transcription: opt-in per session, both parties' explicit consent, short fixed retention schedule.

### Agent 7: Application Deadline Orchestrator Agent
- **Trigger:** Profile stage or target list change
- **Action:** Maintains personalized timeline across every university + scholarship tracked. Recalculates when a deadline shifts upstream. Proactively nudges when a task is at risk of being missed — doesn't wait for student to open dashboard.

### Agent 8: Compliance Guardrail Agent
- **Trigger:** Any AI or mentor-chat message in progress
- **Action:** Runs in background of AI advisor + mentor session chat. Detects drift toward individualized legal/immigration advice or outcome-guarantee language. AI case: inserts scoped-advice reminder. Mentor case: flags for mentor; if repeated, flags for Admin.
- **This is the highest-leverage risk control.** Directly answers UK IAA enforcement pattern + German §20 RDG restriction.

### Agent 9: Trust & Fraud Signal Agent
- **Trigger:** Continuous, across messages/bookings/verification events
- **Action:** Surfaces leakage patterns (contact-detail sharing, off-platform payment requests), verification anomalies, login-country irregularities → Admin fraud console as prioritized signals. **Flags, doesn't auto-suspend.**

### Agent 10: Mentor Knowledge-Drafting Agent
- **Trigger:** Mentor submits voice note or bullet list
- **Action:** Converts rough input → polished, tagged public Q&A post for knowledge inventory. Mentor reviews and approves before anything publishes. **Agent drafts, never publishes autonomously.**

---

## SECTION 6 — Student Panel Features

### 6.1 Onboarding & Profile
- Progressive, stage-aware profile: nationality, institution, CGPA (with grading scale), target country/degree/field/intake, language test status, budget band, application stage
- **Stage axis:** Exploring / Shortlisting / Applying / Admitted / Visa / Arriving — everything else organizes around this
- Privacy controls: what mentor sees per booking vs. what stays private

### 6.2 Discovery & Intelligence
- Country Fit Score + University/Program shortlisting (Strong Match / Possible / Reach)
- **"Why Not This University"** — every excluded option shows exclusion reason (tuition, GPA threshold, deadline passed, language requirement)
- Country Intelligence pages split: Official rules vs. Experience reports per topic (admission, tuition, blocked account, visa, health insurance, accommodation, part-time work, taxes, post-study permits, cost of living)
- Application Readiness / Reality Check on home dashboard

### 6.3 Scholarship Discovery
- Match-scored scholarship engine (4.4)
- Deadline calendar spanning IELTS + university applications + scholarship cycles in one view
- DAAD scholarship cycles start ~1 year ahead of intake — generic trackers miss this

### 6.4 AI Advisor & Verified-Student Marketplace
- Source-grounded AI chat (4.1) as first stop
- "Ask a Verified Student" (Agent 2) as primary discovery interaction — NL query in, ranked mentor shortlist out
- "People Like Me" (4.5) cohort view, linkable from readiness score

### 6.5 Marketplace & Booking
| Service | Format |
|---|---|
| General Consultation | 30/60-min open call |
| University Shortlist Review | Mentor reviews shortlist against lived experience |
| SOP / LOR Review | AI structural ($1–3) / Peer verified student ($5–15) / Expert ($20–50+) |
| Mock Interview | Visa/scholarship/university — always framed as experience-based practice |
| Accommodation & Arrival | City-specific, from someone living there now |
| Career / Alumni Session | Post-study work paths from graduate/working alumnus |

- **Async "Ask a Student":** written answer to one question, $2–3, within published response SLA — lowest-friction first purchase, primary liquidity generator
- **Live 1:1 sessions** (30/60 min) — timezone-aware (PKT↔CET inc. DST), escrow at booking, shared in-room agenda
- **Group sessions** (1 mentor, 8–15 students, $2–3 each) + webinars (live then on-demand)
- **Post-session artifact** auto-delivered (Agent 6) — summary, action items, resource links
- Reviews gated to completed, paid sessions only

### 6.6 Application Command Center
- Per-university tracker (status, doc completeness, SOP/LOR state, deadline countdown)
- Document vault (missing/uploaded/needs review/verified), encrypted, per-booking scoped sharing
- Personalized auto-recalculating timeline (Agent 7) covering attestation chains, embassy windows, blocked-account funding lead time

### 6.7 Community & Social Proof
- Structured communities scoped to corridor/university/intake year/scholarship (not one undifferentiated forum)
- Verified-answer badges on mentor responses
- "My Journey" profiles — mentor-authored optional public timeline (applications, acceptances, scholarship, visa, current city)
- Mentor AMAs tied to specific communities

### 6.8 Arrival Mode
- Dedicated post-landing view: 30-day settle checklist
- Items: SIM, transport, address registration, bank account, health insurance, enrolment, residence permit, longer-term housing, part-time work
- Each item: official source link + mentors currently living in that specific city

### 6.9 Pricing Tiers
| Tier | Includes |
|---|---|
| **Free** | Country rules with sources, program search, basic scholarship matching, limited AI queries, mentor discovery, public Q&A archive. Safety-critical official info always free. |
| **Plus (~PKR 800–1,500/mo)** | Full scholarship matching, Readiness Engine, personalized timeline, document checklist, deadline alerts, higher AI limits |
| **Premium** | Priority matching, discounted session rates, document-review credits |
| **Marketplace** | Per-session, escrow-held, pay-as-used — no subscription needed to book |

---

## SECTION 7 — Mentor Panel Features

> **Supply, not demand, is the binding constraint. The mentor panel is a recruiting and retention product, not an admin form.**

### 7.1 Verification & Trust Architecture (5 Levels)
| Level | Name | Evidence |
|---|---|---|
| 0 | Registered | Email/phone verified |
| 1 | Identity Verified | Government ID + liveness check via IDV vendor ($0.80–$1.85/check). Pakistan CNIC: Verisys-integration partner (NADRA requires formal onboarding, not direct API) |
| 2 | University Verified | Institutional email or registrar-verification provider (domain-only checks have >35% abuse rates) |
| 3 | Enrollment Verified | Current enrolment document + human review |
| 4 | Trusted Mentor | Automatic on session count + rating + clean dispute record |
| 5 | Expert Mentor | High volume + verified outcome contributions to knowledge base |

- **Verification expiry:** "Current Student, verified until March 2027" → auto-transitions to "Graduate, Verified" at expiry
- **Four separate scores:** profile completeness / verification level / reputation (ratings+disputes) / expertise (topic tags + outcome contributions) — intentionally un-merged (conflating is how trust systems get gamed)

### 7.2 Profile & Expertise
- Structured expertise tags (visa experience, accommodation, specific university/program, scholarship type, city)
- "My Journey" timeline (optional, Agent 10-assisted drafting)

### 7.3 Service Catalog & Dynamic Pricing
- **Scoped listing templates** (never free-text "Visa Consultation" — legal control):
  - "My application journey"
  - "Life at my university"
  - "City & accommodation"
  - "Interview experience — what I was asked"
- Mentor-set, market-determined pricing per format
- Group session + webinar hosting with seat-based pricing, recording, on-demand resale

### 7.4 Availability, Booking & Delivery
- Calendar with buffers + bulk blackout dates (exam periods = no-show risk spike)
- Automatic cancellation/no-show policy: free cancellation >24h; partial charge inside window; full refund + ranking penalty on mentor no-show — encoded, not manually adjudicated
- In-session: LiveKit video, shared agenda, Session Co-Pilot Agent

### 7.5 Earnings & Commission
| Benchmark | Structure | Verdict |
|---|---|---|
| Preply | 18–33% sliding by hours taught | Declining tier worth copying. 100%-of-trial rule: not applicable (one-shot sessions ≠ recurring lessons) |
| Aspiraway (direct competitor) | Flat 20%, mentor keeps 80% | Platform recommendation: 18–20% declining toward ~10–12% at volume — at/below this bar |

- **Transparent split display:** gross, commission, net, payout date — shown before price is set, not after
- Multi-rail payout: SEPA (EU mentors), Payoneer/Wise (elsewhere)
- Tax/invoice document generation per payout (German mentors need these records)

### 7.6 Knowledge Inventory
- Mentors publish structured, tagged Q&A answers (Agent 10-drafted, mentor-approved before publish)
- Becomes: public discovery surface + Experience-badged AI retrieval source + optional micro-royalty income when reused
- Turns dead time between sessions into income; builds the corpus that differentiates AI from a generic model

### 7.7 Compliance & Guardrails
> UK Immigration Advice Authority: criminal offence to give immigration advice without registration (civil fines to £15,000). Germany §20 RDG (Jan 2025): unlicensed legal advice is an administrative offence. A mentor marketplace that doesn't build this boundary in is building the exact liability it's supposed to be safer than.

- Mandatory training module + quiz before first listing goes live (experience-vs-advice line with concrete examples)
- In-session Compliance Guardrail Agent (Agent 8)
- Standing disclaimer on every listing: experience sharing, not immigration or legal advice

### 7.8 Performance Dashboard
- Sessions delivered, repeat-booking rate, response-time percentile
- Conversion: profile view → booking
- Current commission tier + distance to next tier

---

## SECTION 8 — Admin Panel Features

> **"This is where the business is won or lost, and in most study-abroad platform post-mortems it is the panel built last and worst."**

### 8.1 Verification Operations Console
- Reviewer workspace: submitted documents side-by-side with automated IDV results, authenticity signals, risk flags
- One-click approve / request-more / reject with structured reason codes (builds fraud taxonomy)
- **Published 48-hour SLA** — verification latency is the leading cause of mentor onboarding drop-off
- Re-verification triggers: enrolment expiry, semester rollover, dispute threshold, login-country anomaly

### 8.2 Knowledge & Source Management
- Source registry: URL, issuing authority, jurisdiction, topic, crawl frequency, last-verified date, owning reviewer
- Covers: Hochschulkompass, DAAD, Make it in Germany, Federal Foreign Office, BAMF, embassy pages
- **Diff queue:** only shows changed passage (not full page) — makes daily monitoring realistic for small team
- Versioning with rollback + full audit log
- Staleness dashboard: every fact past review window, ranked by how many active students depend on it
- **Automatic cache invalidation:** when source figure changes, every AI answer citing old value is retired immediately

### 8.3 Trust & Safety / Moderation Console
- Automated moderation: contact-detail sharing, off-platform payment solicitation, **guaranteed-outcome claims** ("guaranteed visa", "100% admission") — held for review automatically
- Report/flag case management with full mentor conduct history visible to reviewers

### 8.4 Dispute & Refund Console
- Every case bundles: booking record + session artifact + message thread + (consent-based) recording/transcript
- **Encoded resolution paths** with fixed windows:
  - No-show
  - Technical failure
  - Scope violation (mentor gave prohibited individualized advice)
  - Quality complaint
  - Non-delivery of async answer
- Resolved by policy, not ad hoc discretion
- Escrow release: funds hold 48–72h post-session, auto-release absent open dispute

### 8.5 Payments, Payouts & Compliance Ledger
- Daily-reconciled ledger across all collection rails (JazzCash, Easypaisa, cards, Raast) and payout rails (SEPA, Payoneer, Wise)
- Per-rail cost visibility + failed-payout retry queue
- FX exposure dashboard: PKR-collection → EUR-payout spread as explicit P&L line
- Mentor tax + invoice generation; fee configuration by cohort (no code deploy needed)

### 8.6 Content & Catalog Management
- Curation tools for university + scholarship databases
- Promoted/featured placements clearly labelled, never allowed to outrank accuracy/relevance (integrity rule, not default assumption)

### 8.7 Analytics & Business Intelligence
| Metric | Why It Matters |
|---|---|
| Search → booking conversion by corridor | Measures actual liquidity, not traffic |
| Mentor activation (verified → first session) + 90-day retention | Whether supply side compounds or churns |
| Dispute rate per 100 sessions | Single biggest lever on unit-economic margin |
| Leakage signal rate (off-platform contact per 100 conversations) | Platform integrity signal |
| Knowledge staleness % | Proxy for regulatory and reputational risk exposure |
| Outcome capture rate | % students reporting admission/visa results — input to People Like Me |
| **North star:** Successful student journeys | Discovery → application → admission → arrival. Not signups. |

### 8.8 Fraud & Risk Console
- Guaranteed-outcome claim detector (from 8.3) with case history
- IDV vendor selected for deepfake/injection-aware presentation-attack defence (commodity attack tool as of 2026)
- Verification-expiry sweep on schedule, not on demand

### 8.9 B2B & Partnership Management
- University ambassador-network licensing
- Referral-partner dashboards for accommodation, insurance, financing partners
- **Build only after core marketplace has liquidity — not before**

---

## SECTION 9 — Monetization Architecture

| Stream | Mechanism | Notes |
|---|---|---|
| Mentor session commission | ~15–20%, declining with volume | Primary revenue; at/below Aspiraway's 20% and below free alternative's 0% |
| Subscription (Plus/Premium) | ~PKR 800–1,500+/mo | Secondary; expect slow early conversion — Phase 2, not launch dependency |
| Document review marketplace | Commission on AI/peer/expert review tiers | High-margin once core marketplace has liquidity |
| Group sessions & webinars | Commission on seat/ticket sales | Increases avg revenue per mentor without raising per-student price |
| University lead generation (B2B) | Per qualified lead or subscription | Phase 3+; requires established trusted student base first |
| Accommodation/insurance/financing referrals | Affiliate commission | Phase 3+; disclose referral relationships to students plainly |

### Unit Economics Reality
- $10 session × 18–20% commission = ~$1.80–$2.00 gross margin per session
- Identity verification (~$1–2, one-time per mentor) = trivial amortized, expensive if mentor churns early
- **One human support interaction on a dispute can exceed the margin on 10 sessions** — encoded resolution paths (8.4) are a margin lever, not just operations

---

## SECTION 10 — Build Priority (Study Abroad Platform)

| Priority | Includes | Rationale |
|---|---|---|
| **P0 — Launch** | Student/mentor profiles with stage; verification L0–L3; async Q&A; live 1:1 booking with escrow; masked chat + moderation; session artifact; reviews; multi-rail payments/payouts; ~40 hand-curated source-stamped knowledge entries; Admin verification queue, dispute console, payments ledger | Nothing else matters if marketplace has no liquidity. Proves Pakistani student will pay verified German student for guidance. |
| **P1 — Early Growth** | AI Advisor (4.1); Readiness Engine (4.3); Scholarship Match (4.4); Country Fit Score (4.2); group sessions; Knowledge Freshness Agent (5.3); mentor Knowledge Inventory (7.6) | Converts marketplace trust into scale and compounding knowledge-base moat. |
| **P2 — Retention & Depth** | Arrival Mode (6.8); structured communities + My Journey (6.7); People Like Me (4.5); document review marketplace; second corridor (reuse either origin or destination, never change both at once) | Extends platform across full student lifecycle; starts outcome-data flywheel. |
| **P3 — Scale** | Accommodation/jobs/insurance/financing referrals; B2B university licensing (8.9) | Monetizes the network built in P0–P2; premature before then. |

---

## SECTION 11 — The Moat (Why This Is Hard to Copy)

No individual technology in this spec is defensible alone. What compounds:

1. **Verified mentor network** — expensive and slow to build (requires real identity + enrolment verification, not a database license)
2. **Reputation and dispute history** — only gets more reliable with time and volume
3. **Proprietary outcome dataset** (admissions, scholarships, visa results) — powers People Like Me and every future matching improvement; no scraped-data competitor holds this
4. **Source-grounded knowledge base with live change-detection pipeline** — the specific answer to the one number every competitor in this research got approximately, and sometimes exactly, wrong

> **The instruction that should outlast every individual feature:** Prove the marketplace first. If a Pakistani student will not pay a verified student in Germany for first-hand guidance, and enough verified students are not willing to supply it, no amount of AI, scholarship data, or community tooling will save the business. If that core transaction works, everything else here is the plan for building around it.

---

## Three Platform Principles (Apply to Both Platforms)

1. The platform **never predicts admission or visa outcomes** — only readiness against stated requirements
2. **Official regulation and personal experience are always visually and structurally separated**
3. **Safety-critical information** (visa rules, funding thresholds, work-hour limits) is **never paywalled**

---

*Document compiled: September 2026 | Sources: Your existing codebase analysis (JobSpy) + Study Abroad Platform Feature Specification PDF (18 pages, 41,572 chars)*
