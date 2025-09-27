// contentScript.js
console.log("[Bluebook Citer] Content script loaded!");

// -------------------------------
// Court Map (loaded dynamically)
// -------------------------------
let courtMap = {};
let latestData = {};

const courtMapLoaded = fetch(chrome.runtime.getURL("courtMap.json"))
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

function findFullDateFallback(root = document) {
  // Look for Month Day, Year with abbreviated or full months, case-insensitive
  const month = "(Jan\\.?|January|Feb\\.?|February|Mar\\.?|March|Apr\\.?|April|May|Jun\\.?|June|Jul\\.?|July|Aug\\.?|August|Sep\\.?|Sept\\.?|September|Oct\\.?|October|Nov\\.?|November|Dec\\.?|December)";
  const re = new RegExp(`${month}\\s+\\d{1,2},\\s*(19|20)\\d{2}`, "i");

  // Try obvious date-ish containers first
  const candidates = root.querySelectorAll('[class*="date"], [id*="date"], time, header, .SS_DocumentInfo');
  for (const el of candidates) {
    const t = (el.innerText || el.textContent || "").trim();
    const m = t && t.match(re);
    if (m) return m[0];
  }

  // As a last resort, scan a limited slice of the page text
  const bodyText = (document.body.innerText || "").slice(0, 20000); // cap for perf
  const m = bodyText.match(re);
  return m ? m[0] : "";
}


function parseCitationString(raw) {
  const parts = (raw || "").trim().split(/\s+/);
  if (parts.length >= 3) {
    return {
      volume: parts[0],
      reporter: parts[1],
      page: parts[2],
      pinpoint: parts[3] || ""
    };
  }
  return null;
}

function normalizeCourtName(raw) {
  let court = String(raw || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  court = court.replace(/,\s*[^,]*County\.?$/i, "");
  const districtPattern = /,\s*([A-Za-z]+)\s+(?:Appellate\s+)?Dist(?:rict)?\b\.?/i;
  court = court.replace(districtPattern, (_, word) => `, ${word} District`);
  return court;
}

// Always normalize docket strings to start with "No. " and drop trailing period.
function normalizeDocket(txt) {
  if (!txt) return "";
  return txt
    .replace(/^(Case\s+No\.?|No\.)\s*/i, "No. ")
    .replace(/\.$/, "");
}

// -------------------------------
// Shared citation parser
// Handles reported (e.g., "158 N.E.3d 124, 126")
// and unreported (e.g., "2023 U.S. Dist. LEXIS 191762", "2007 WL 103230")
// -------------------------------
function parseCitation(raw) {
  if (!raw) return { volume: "", reporter: "", page: "", pinpoint: "", year: "" };

  const citationRegex = /^(\d{4}|\d+)\s+([A-Za-z][A-Za-z0-9.\s\-]*?)\s+(\d+)(?:,\s*(\d+))?/;
  const m = raw.match(citationRegex);

  if (m) {
    if (m[1].length === 4) {
      // Unreported: first token is a year
      return {
        volume: "",
        reporter: (m[2] || "").trim(),
        page: m[3] || "",   // WL/LEXIS ID
        pinpoint: m[4] || "",
        year: m[1]
      };
    }
    // Reported: first token is a volume
    return {
      volume: m[1],
      reporter: (m[2] || "").trim(),
      page: m[3] || "",
      pinpoint: m[4] || "",
      year: ""
    };
  }

  // Fallback — treat whole string as reporter
  return {
    volume: "",
    reporter: raw.trim(),
    page: "",
    pinpoint: "",
    year: ""
  };
}

// -------------------------------
// Lexis Extractor
// -------------------------------
function extractFromLexis() {
  console.log("[Bluebook Citer] extractFromLexis running...]");

  let caseName = "";
  const caseEl = document.querySelector("#SS_DocumentTitle");
  if (caseEl) caseName = getVisibleText(caseEl);

  // Declare ALL fields up-front so we can safely assign later.
  let volume = "", reporter = "", page = "", pinpoint = "";
  let court = "", year = "", docket = "", fullDate = "";

  try {
    const rptrEl = document.querySelector(".SS_ActiveRptr, .SS_Rptr");
    if (rptrEl) {
      let raw = getVisibleText(rptrEl);
      raw = raw.replace(/\*\*/g, "").replace(/\u00A0/g, " ").trim();
      console.log("[Bluebook Citer] Raw rptrEl:", raw);

      const parsed = parseCitation(raw);
      volume = parsed.volume;
      reporter = parsed.reporter;
      page = parsed.page;
      pinpoint = parsed.pinpoint;
      if (parsed.year) year = parsed.year;
    }
  } catch (e) {
    console.warn("[Bluebook Citer] error reading .SS_Rptr", e);
  }

  const infoEls = document.querySelectorAll(".SS_DocumentInfo");
  infoEls.forEach(el => {
    let txt = safeTrim(getVisibleText(el));
    if (/^(Case\s+No\.?|No\.)/i.test(txt)) {
      docket = normalizeDocket(txt);
    } else if (/\b(19|20)\d{2}\b/.test(txt)) {
      // Keep the entire string as full date (e.g., "Oct. 11, 2023")
      const m = txt.match(/\b(19|20)\d{2}\b/);
      if (m) year = year || m[0];
      fullDate = txt;
    } else if (txt) {
      txt = normalizeCourtName(txt);
      court = courtMap[txt] || court || txt;
    }
  });

  if (!fullDate) {
    const fb = findFullDateFallback();
    if (fb) {
      fullDate = fb;
      // set year if we never found it
      const ym = fb.match(/\b(19|20)\d{2}\b/);
      if (ym && !year) year = ym[0];
    }
  }

  return { caseName, volume, reporter, page, pinpoint, court, year, docket, fullDate, sourceUrl: location.href };
}

// -------------------------------
// Westlaw Extractor
// -------------------------------
function extractWestlaw() {
  console.log("[Bluebook Citer] extractWestlaw running...]");

  const caseName = getVisibleText(
    document.querySelector('#co_docHeader_caseName, .co_caseName, h1')
  );

  let court = "";
  const courtEl = document.querySelector('#co_document_0 .co_courtBlock');
  if (courtEl) {
    let rawCourt = courtEl.innerText.replace(/\s+/g, " ").trim();
    rawCourt = rawCourt.replace(/,\s*[^,]*County\.?$/i, "");
    rawCourt = rawCourt.replace(/^[,.\s]+|[,.\s]+$/g, "");
    court = courtMap[rawCourt] || rawCourt;
  }

  const date = getVisibleText(
    document.querySelector('.co_docHeader_date, .co_date')
  );
  let year = "";
  const yearMatch = date.match(/\b(\d{4})\b/);
  if (yearMatch) year = yearMatch[1];
  const fullDate = date || "";

  let docket = getVisibleText(
    document.querySelector('.co_docHeader_docket, .co_docket')
  );
  if (docket) {
    docket = normalizeDocket(docket);
  } else {
    const docketEl = document.querySelector('.co_docketBlock');
    if (docketEl) {
      docket = normalizeDocket(getVisibleText(docketEl));
    }
  }

  const citationRaw = getVisibleText(document.querySelector('.co_cites'));

  let volume = "", reporter = "", page = "", pinpoint = "";
  if (citationRaw) {
    const parsed = parseCitation(citationRaw);
    volume = parsed.volume;
    reporter = parsed.reporter;
    page = parsed.page;
    pinpoint = parsed.pinpoint;
    if (parsed.year) year = parsed.year || year;
  }

  return {
    caseName,
    volume,
    reporter,
    page,
    pinpoint,
    court,
    year,
    docket,
    fullDate,
    sourceUrl: window.location.href
  };
}

// -------------------------------
// Fallback extractor
// -------------------------------
function heuristicExtractAll() {
  console.log("[Bluebook Citer] heuristicExtractAll running...");
  const title = document.querySelector("h1, h2");
  const caseName = title ? getVisibleText(title) : "";
  return { caseName, sourceUrl: location.href };
}

// -------------------------------
// Run Extraction
// -------------------------------
function runExtraction(extractFunction) {
  let data = extractFunction();
  if (!data.caseName && !data.reporter && !data.court) {
    console.warn("[Bluebook Citer] Extraction incomplete — using heuristic fallback");
    data = heuristicExtractAll();
  }
  latestData = data;
  console.log("[Bluebook Citer] Snapshot stored:", latestData);
}

// -------------------------------
// Observer (started after courtMap loads)
// -------------------------------
courtMapLoaded.then(() => {
  console.log("[Bluebook Citer] Starting observer now that courtMap is ready");

  const observer = new MutationObserver(() => {
    if (document.querySelector("#SS_DocumentTitle")) {
      console.log("[Bluebook Citer] Lexis case detected");
      runExtraction(extractFromLexis);
    } else if (document.querySelector('#co_document_0')) {
      console.log("[Bluebook Citer] Westlaw case detected");
      runExtraction(extractWestlaw);
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });
});

// -------------------------------
// Message listener
// -------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "extractCitation") {
    console.log("[Bluebook Citer] Received extractCitation request from popup");
    sendResponse({ ok: true, data: latestData });
    return true;
  }
});
