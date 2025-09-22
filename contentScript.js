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

function parseCitationString(raw) {
  const parts = raw.split(/\s+/);
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

// -------------------------------
// Lexis Extractor
// -------------------------------
function extractFromLexis() {
  console.log("[Bluebook Citer] extractFromLexis running...");

  let caseName = "";
  const caseEl = document.querySelector("#SS_DocumentTitle");
  if (caseEl) caseName = getVisibleText(caseEl);

  let volume = "", reporter = "", page = "", pinpoint = "";
  try {
    const rptrEl = document.querySelector(".SS_Rptr");
    if (rptrEl) {
      let raw = getVisibleText(rptrEl);
      raw = raw.replace(/\*\*/g, "").replace(/\u00A0/g, " ").trim();

      const citationRegex = /^(\d+)\s+([A-Za-z0-9.\-]+)\s+(\d+)(?:,\s*(\d+))?/;
      const m = raw.match(citationRegex);

      if (m) {
        volume   = m[1];
        reporter = m[2];
        page     = m[3];
        pinpoint = m[4] || "";
      } else {
        const fallbackParsed = parseCitationString(raw);
        if (fallbackParsed) {
          volume   = fallbackParsed.volume   || volume;
          reporter = fallbackParsed.reporter || reporter;
          page     = fallbackParsed.page     || page;
          pinpoint = fallbackParsed.pinpoint || pinpoint;
        }
      }
    }
  } catch (e) {
    console.warn("[Bluebook Citer] error reading .SS_Rptr", e);
  }

  let court = "", year = "", docket = "";
  const infoEls = document.querySelectorAll(".SS_DocumentInfo");
  infoEls.forEach(el => {
    const txt = safeTrim(getVisibleText(el));
    if (/No\./i.test(txt)) {
      docket = txt.replace(/^No\.\s*/, "");
    } else if (/\d{4}/.test(txt)) {
      const m = txt.match(/\b(19|20)\d{2}\b/);
      if (m) year = m[0];
    } else if (courtMap[txt]) {
      court = courtMap[txt];
    }
  });

  return { caseName, volume, reporter, page, pinpoint, court, year, docket, sourceUrl: location.href };
}

// -------------------------------
// Westlaw Extractor
// -------------------------------
function extractWestlaw() {
  console.log("[Bluebook Citer] extractWestlaw running...");

  const caseName = getVisibleText(
    document.querySelector('#co_docHeader_caseName, .co_caseName, h1')
  );

  // Court
  let court = "";
  const courtEl = document.querySelector('#co_document_0 .co_courtBlock');
  if (courtEl) {
    let rawCourt = courtEl.innerText.replace(/\s+/g, " ").trim();
    console.log("[Bluebook Citer] rawCourt (before cleanup):", rawCourt);

    rawCourt = rawCourt.replace(/,\s*[^,]*County\.?$/i, ""); // remove county
    rawCourt = rawCourt.replace(/^[,.\s]+|[,.\s]+$/g, "");   // trim punctuation

    console.log("[Bluebook Citer] rawCourt (after cleanup):", rawCourt);

    if (courtMap[rawCourt]) {
      court = courtMap[rawCourt];
    } else {
      console.log("[Bluebook Citer] Court not found in courtMap:", rawCourt);
      court = rawCourt; // fallback
    }
  }

  const date = getVisibleText(
    document.querySelector('.co_docHeader_date, .co_date')
  );
 // Docket number
  let docket = getVisibleText(
    document.querySelector('.co_docHeader_docket, .co_docket')
  );

  if (!docket) {
    // Fallback: Westlaw docket block
    const docketEl = document.querySelector('.co_docketBlock');
    if (docketEl) {
      docket = getVisibleText(docketEl);
      // Strip "No." prefix and trailing period if present
      docket = docket.replace(/\.$/, "");
    }
  }

  const citationRaw = getVisibleText(
    document.querySelector('.co_cites')
  );

  let volume = "", reporter = "", page = "";
  const citationMatch = citationRaw.match(/^(\d+)\s+(.+?)\s+(\d+)$/);
  if (citationMatch) {
    volume = citationMatch[1];
    reporter = citationMatch[2];
    page = citationMatch[3];
  }

  const yearMatch = date.match(/\b(\d{4})\b/);
  const year = yearMatch ? yearMatch[1] : "";

  return {
    caseName,
    volume,
    reporter,
    page,
    pinpoint: "",
    court,
    year,
    docket,
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

    if (latestData.caseName && (latestData.reporter || latestData.court)) {
      observer.disconnect();
      console.log("[Bluebook Citer] Observer disconnected (sufficient data found)");
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
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
