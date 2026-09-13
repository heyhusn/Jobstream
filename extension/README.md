# JobSpy browser extension

Captures the job posting you're viewing, on any site, straight into your
JobSpy tracker (`saved` stage). No autofill, no auto-apply — this only
saves what you're looking at.

Separate build from the main app on purpose — see the plan in
`CLAUDE.md` for the full design (why `activeTab`-only, why JSON-LD
extraction, why email/password-only auth for v1).

## Build

```
cd extension
npm install
npm run build
```

Output lands in `extension/dist/`.

## Load into Chrome

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select `extension/dist/`
4. Click the JobSpy icon in the toolbar, sign in with your JobSpy account
5. Open a job posting anywhere, click the icon, review the extracted
   fields, click "Save to my tracker"

A right-click → "Save this job to JobSpy" context-menu entry does the same
thing without opening the popup (feedback via a toolbar badge, since no
icon assets exist yet for a notification).

## Known limitations (v1)

- Email/password sign-in only — no Google OAuth (needs `chrome.identity`,
  out of scope for this pass).
- No branded icons yet — Chrome shows its default extension icon.
- Not submitted to the Chrome Web Store — "Load unpacked" only. Store
  packaging/review is a manual follow-up step.
- Extraction relies on schema.org `JobPosting` JSON-LD where a site has it
  (LinkedIn, Indeed, every ATS this app ingests) and falls back to
  page title/meta description otherwise — always reviewable/editable
  before saving, never auto-submitted.
