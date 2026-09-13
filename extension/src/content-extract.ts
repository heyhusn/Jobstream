export interface ExtractedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

function extractFromJsonLd(): Partial<ExtractedJob> | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      
      // Handle both single objects and arrays of objects
      const items = Array.isArray(data) ? data : [data];
      const jobPosting = items.find((item: any) => 
        item && item["@type"] === "JobPosting"
      );

      if (jobPosting) {
        let location = "";
        const jobLoc = jobPosting.jobLocation;
        if (Array.isArray(jobLoc)) {
          location = jobLoc.map(l => l?.address?.addressLocality || l?.address?.name || "").join(", ");
        } else if (jobLoc?.address?.addressLocality) {
          location = jobLoc.address.addressLocality;
          if (jobLoc.address.addressRegion) {
            location += `, ${jobLoc.address.addressRegion}`;
          }
        }

        let salaryMin = null;
        let salaryMax = null;
        let salaryCurrency = null;

        const baseSalary = jobPosting.baseSalary;
        if (baseSalary && baseSalary.value) {
          if (baseSalary.value.minValue !== undefined) {
            salaryMin = baseSalary.value.minValue;
            salaryMax = baseSalary.value.maxValue;
          } else if (baseSalary.value.value !== undefined) {
            salaryMin = baseSalary.value.value;
            salaryMax = baseSalary.value.value;
          }
          salaryCurrency = baseSalary.currency || null;
        }

        // Clean up description HTML or return plain text
        const tmp = document.createElement("div");
        tmp.innerHTML = jobPosting.description || "";
        const description = tmp.textContent || tmp.innerText || "";

        return {
          title: jobPosting.title || "",
          company: jobPosting.hiringOrganization?.name || "",
          location,
          description: description.trim(),
          salaryMin,
          salaryMax,
          salaryCurrency,
        };
      }
    } catch (e) {
      // JSON parse error, ignore and continue
    }
  }
  return null;
}

function extractFromMeta(): Partial<ExtractedJob> {
  const titleMeta = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
  let title = titleMeta?.content || document.title;
  
  // often titles are like "Job Title at Company Name"
  let company = "";
  const siteNameMeta = document.querySelector('meta[property="og:site_name"]') as HTMLMetaElement;
  company = siteNameMeta?.content || "";

  if (!company && title.includes(" at ")) {
    const parts = title.split(" at ");
    company = parts[parts.length - 1].trim();
    title = parts.slice(0, -1).join(" at ").trim();
  } else if (!company && title.includes(" | ")) {
    const parts = title.split(" | ");
    company = parts[parts.length - 1].trim();
    title = parts.slice(0, -1).join(" | ").trim();
  } else if (!company && title.includes(" - ")) {
    const parts = title.split(" - ");
    company = parts[parts.length - 1].trim();
    title = parts.slice(0, -1).join(" - ").trim();
  }

  const descMeta = document.querySelector('meta[property="og:description"]') as HTMLMetaElement;
  const descMeta2 = document.querySelector('meta[name="description"]') as HTMLMetaElement;
  const description = descMeta?.content || descMeta2?.content || "";

  return {
    title: title.trim(),
    company: company.trim(),
    description: description.trim()
  };
}

export function extractJobDetails(): ExtractedJob {
  const jsonLd = extractFromJsonLd();
  const meta = extractFromMeta();

  return {
    title: jsonLd?.title || meta.title || "",
    company: jsonLd?.company || meta.company || "",
    location: jsonLd?.location || "",
    description: jsonLd?.description || meta.description || "",
    salaryMin: jsonLd?.salaryMin ?? null,
    salaryMax: jsonLd?.salaryMax ?? null,
    salaryCurrency: jsonLd?.salaryCurrency ?? null,
    url: window.location.href,
  };
}

// Ensure the module works both when imported (in tests/background) 
// and when executed by chrome.scripting.executeScript (returns value of last statement)
extractJobDetails();
