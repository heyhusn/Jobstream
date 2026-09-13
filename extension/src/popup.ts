import { supabase } from "./lib/supabaseClient";
import type { ExtractedJob } from "./content-extract";

const views = {
  loading: document.getElementById("loading-view")!,
  auth: document.getElementById("auth-view")!,
  review: document.getElementById("review-view")!,
  success: document.getElementById("success-view")!,
};

const elements = {
  logoutBtn: document.getElementById("logout-btn")!,
  loginBtn: document.getElementById("login-btn") as HTMLButtonElement,
  emailInput: document.getElementById("email") as HTMLInputElement,
  passwordInput: document.getElementById("password") as HTMLInputElement,
  authError: document.getElementById("auth-error")!,
  
  saveBtn: document.getElementById("save-btn") as HTMLButtonElement,
  titleInput: document.getElementById("job-title") as HTMLInputElement,
  companyInput: document.getElementById("job-company") as HTMLInputElement,
  locationInput: document.getElementById("job-location") as HTMLInputElement,
  descriptionInput: document.getElementById("job-description") as HTMLTextAreaElement,
  saveError: document.getElementById("save-error")!,
  
  successMessage: document.getElementById("success-message")!,
  viewTrackerBtn: document.getElementById("view-tracker-btn")!,
};

let currentJobUrl = "";
let currentSession: any = null;
let currentSalaryMin: number | null = null;
let currentSalaryMax: number | null = null;
let currentSalaryCurrency: string | null = null;

function showView(viewName: keyof typeof views) {
  Object.values(views).forEach(v => v.classList.add("hidden"));
  views[viewName].classList.remove("hidden");
  
  if (viewName === "auth" || viewName === "loading") {
    elements.logoutBtn.classList.add("hidden");
  } else {
    elements.logoutBtn.classList.remove("hidden");
  }
}

async function init() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  
  if (!currentSession) {
    showView("auth");
  } else {
    await extractAndShowReview();
  }
}

async function extractAndShowReview() {
  showView("loading");
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) {
    elements.saveError.textContent = "Cannot read this tab.";
    elements.saveError.classList.remove("hidden");
    showView("review");
    return;
  }
  
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
    elements.saveError.textContent = "Cannot save extension pages.";
    elements.saveError.classList.remove("hidden");
    showView("review");
    return;
  }

  currentJobUrl = tab.url;

  try {
    // Relative to the loaded extension's root, which is dist/ itself
    // (see vite.config.ts) — "dist/content-extract.js" only worked if
    // "Load unpacked" pointed at extension/ instead of extension/dist/,
    // which manifest.json's own paths don't agree with. Found while
    // testing this build.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-extract.js"]
    });

    const job = results[0]?.result as ExtractedJob | null;
    if (job) {
      elements.titleInput.value = job.title || "";
      elements.companyInput.value = job.company || "";
      elements.locationInput.value = job.location || "";
      elements.descriptionInput.value = job.description || "";
      currentSalaryMin = job.salaryMin;
      currentSalaryMax = job.salaryMax;
      currentSalaryCurrency = job.salaryCurrency;
    }
  } catch (err) {
    console.error("Extraction failed:", err);
    // Ignore extraction errors and just let user fill it manually
  }

  showView("review");
}

elements.loginBtn.addEventListener("click", async () => {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;
  
  if (!email || !password) {
    elements.authError.textContent = "Please enter email and password.";
    elements.authError.classList.remove("hidden");
    return;
  }

  elements.loginBtn.disabled = true;
  elements.loginBtn.textContent = "Signing in...";
  elements.authError.classList.add("hidden");
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error) {
    elements.authError.textContent = error.message;
    elements.authError.classList.remove("hidden");
    elements.loginBtn.disabled = false;
    elements.loginBtn.textContent = "Sign in";
  } else {
    currentSession = data.session;
    await extractAndShowReview();
  }
});

elements.logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  currentSession = null;
  elements.emailInput.value = "";
  elements.passwordInput.value = "";
  elements.authError.classList.add("hidden");
  showView("auth");
});

elements.saveBtn.addEventListener("click", async () => {
  const title = elements.titleInput.value.trim();
  const description = elements.descriptionInput.value.trim();
  
  if (!title || !description) {
    elements.saveError.textContent = "Title and description are required.";
    elements.saveError.classList.remove("hidden");
    return;
  }

  elements.saveBtn.disabled = true;
  elements.saveBtn.textContent = "Saving...";
  elements.saveError.classList.add("hidden");

  try {
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-job`;
    
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${currentSession.access_token}`
      },
      body: JSON.stringify({
        url: currentJobUrl,
        title,
        company: elements.companyInput.value.trim(),
        location: elements.locationInput.value.trim(),
        description,
        salaryMin: currentSalaryMin,
        salaryMax: currentSalaryMax,
        salaryCurrency: currentSalaryCurrency
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Server returned ${res.status}`);
    }

    if (data.already_tracked) {
      elements.successMessage.textContent = `You already saved this job (stage: ${data.stage}).`;
    } else {
      elements.successMessage.textContent = "This job is now in your tracker.";
    }
    
    showView("success");
  } catch (err: any) {
    elements.saveError.textContent = err.message;
    elements.saveError.classList.remove("hidden");
  } finally {
    elements.saveBtn.disabled = false;
    elements.saveBtn.textContent = "Save to Tracker";
  }
});

elements.viewTrackerBtn.addEventListener("click", () => {
  // There's no hosted production frontend yet (per CLAUDE.md — only
  // the Supabase backend is deployed; the web app runs via `npm run
  // dev`), so the honest link today is the local dev server's default
  // port, not a fabricated production domain. Update this once/if the
  // frontend is actually deployed somewhere.
  chrome.tabs.create({ url: "http://localhost:5173/tracker" });
});

// Start
document.addEventListener("DOMContentLoaded", init);
