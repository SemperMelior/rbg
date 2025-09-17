// contentScript.js
console.log("[Bluebook Citer] Content script loaded!");

// -------------------------------
// Court Map (loaded dynamically)
// -------------------------------
let courtMap = {};
fetch(chrome.runtime.getURL("courtMap.json"))
  .then(r => r.json())
  .then(json => {
    courtMap = json;
    console.log("[Bluebook Citer] courtMap loaded", Object.keys(courtMap).length, "entries");
  })
  .catch(err => console.error("[Bluebook Citer] Failed to load courtMap.json:", err));

// -------------------------------
// Utilities
// -------------------------------
function getVisibleText(el) {
  try {
    return (el && (el.innerText || el.textContent) || "").trim();
  } catch (e) {
    return "";
  }
}
function safeTrim(s) {
  return (s || "").trim();
}

// -------------------------------
// Core extractor
// -------------------------------
function extractFromLexis() {
  console.log("[Bluebook Citer] extractFromLexis running...");

  // Case name
  let caseName = "";
  const caseEl = document.querySelector("#SS_DocumentTitle");
  console.log("[Bluebook Citer] caseEl:", caseEl);
  if (caseEl) caseName = getVisibleText(caseEl);

  // Reporter (volume reporter page) expected in .SS_Rptr
let volume = "", reporter = "", page = "", pinpoint = "";
try {
  const rptrEl = document.querySelector(".SS_Rptr");
  console.log("[Bluebook Citer] rptrEl:", rptrEl);
  if (rptrEl) {
    let raw = getVisibleText(rptrEl);
    raw = raw.replace(/\*\*/g, "").replace(/\u00A0/g, " ").trim();
    console.log("[Bluebook Citer] reporter raw text:", JSON.stringify(raw));

    // More forgiving regex: allows digits in reporter, optional dash, and no requirement to stop at end
    const citationRegex = /^(\d+)\s+([A-Za-z0-9.\-]+)\s+(\d+)(?:,\s*(\d+))?/;
    const m = raw.match(citationRegex);

    if (m) {
      volume   = m[1];
      reporter = m[2];
      page     = m[3];
      pinpoint = m[4] || "";
      console.log("[Bluebook Citer] reporter parsed via regex:", { volume, reporter, page, pinpoint });
    } else {
      console.warn("[Bluebook Citer] regex failed, trying fallback parseCitationString");
      const fallbackParsed = parseCitationString(raw);
      if (fallbackParsed) {
        volume   = fallbackParsed.volume   || volume;
        reporter = fallbackParsed.reporter || reporter;
        page     = fallbackParsed.page     || page;
        pinpoint = fallbackParsed.pinpoint || pinpoint;
        console.log("[Bluebook Citer] reporter parsed via fallback parse:", fallbackParsed);
      }
    }
  }
} catch (e) {
  console.warn("[Bluebook Citer] error reading .SS_Rptr", e);
}

  // Document info (court, year, docket)
  let court = "", year = "", docket = "";
  const infoEls = document.querySelectorAll(".SS_DocumentInfo");
  console.log("[Bluebook Citer] infoEls count:", infoEls.length);
  infoEls.forEach(el => {
    const txt = safeTrim(getVisibleText(el));
    console.log("[Bluebook Citer] info text:", txt);
    if (/No\./i.test(txt)) docket = txt.replace(/^No\.\s*/, "");
    else if (/\d{4}/.test(txt)) {
      const m = txt.match(/\b(19|20)\d{2}\b/);
      if (m) year = m[0];
    } else if (courtMap[txt]) {
      court = courtMap[txt];
    }
  });

  const result = { caseName, volume, reporter, page, pinpoint, court, year, docket, sourceUrl: location.href };
  console.log("[Bluebook Citer] extractFromLexis result:", result);
  return result;
}

// -------------------------------
// Fallback extractor (heuristic)
// -------------------------------
function heuristicExtractAll() {
  console.log("[Bluebook Citer] Using heuristic fallback extraction...");
  const title = document.querySelector("h1, h2");
  const caseName = title ? getVisibleText(title) : "";
  return { caseName, sourceUrl: location.href };
}

// -------------------------------
// State + Observer
// -------------------------------
let latestData = {};

function runExtraction() {
  let data = extractFromLexis();
  // If no useful fields found, try heuristic
  if (!data.caseName && !data.reporter && !data.court) {
    console.warn("[Bluebook Citer] Lexis extractor incomplete — using heuristic fallback");
    data = heuristicExtractAll();
  }
  latestData = data;
  console.log("[Bluebook Citer] Snapshot stored:", latestData);
}

const observer = new MutationObserver(() => {
  const caseEl = document.querySelector("#SS_DocumentTitle");
  if (caseEl) {
    console.log("[Bluebook Citer] Case content detected, extracting...");
    runExtraction();
    observer.disconnect();
  }
});
observer.observe(document.documentElement || document.body, { childList: true, subtree: true });

// -------------------------------
// Message listener for popup
// -------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "extractCitation") {
    console.log("[Bluebook Citer] Received extractCitation request from popup");
    sendResponse({ ok: true, data: latestData });
    return true;
  }
});
