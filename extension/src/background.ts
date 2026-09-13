import { supabase } from "./lib/supabaseClient";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-jobspy",
    title: "Save this job to JobSpy",
    contexts: ["page", "selection", "link"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-to-jobspy" && tab && tab.id) {
    const { data } = await supabase.auth.getSession();
    
    if (!data.session) {
      // Open popup or a new tab to prompt sign in
      chrome.action.openPopup();
      return;
    }

    try {
      // We don't have a UI here to edit, so we just run extraction and save directly.
      // But we can just open the popup instead of silently failing or saving with empty fields.
      chrome.action.openPopup();
    } catch (e) {
      console.error("Failed to open popup:", e);
    }
  }
});
