// popup.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Bluebook Citer] popup opened');

  const longBox = document.getElementById('longForm');
  const shortBox = document.getElementById('shortForm');
  const debugBox = document.getElementById('debugLog');
  const copyLongBtn = document.getElementById('copyLong');
  const copyShortBtn = document.getElementById('copyShort');
  const generateBtn = document.getElementById('generate');

  // All editable fields
  const fieldIds = [
    'caseName', 'shortCaseName', 'volume', 'reporter', 'page',
    'pinpoint', 'court', 'year', 'docket', 'sourceUrl'
  ];

  function getFormData() {
    const data = {};
    fieldIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) data[id] = el.value || '';
    });
    return data;
  }

  // Utility to create Bluebook short-form case name
function abbreviateCaseName(fullCaseName) {
  if (!fullCaseName) return "";

  // Split at " v. " (case-insensitive, handles "vs." too)
  const parts = fullCaseName.split(/\s+v\.?\s+/i);
  let firstParty = parts[0] || "";

  // Strip leading/trailing whitespace & punctuation
  firstParty = firstParty.trim().replace(/[.,]+$/, "");

  // Remove common corporate suffixes
  firstParty = firstParty.replace(/\b(Inc|Incorporated|Corp|Corporation|LLC|L\.L\.C\.|Ltd|Co)\.?$/i, "").trim();

  // Skip common government entities
  if (/^(United States|State of|People of|People|Commonwealth of|Ohio|Texas|Florida|California|[A-Z][a-z]+ Dep’t|[A-Z][a-z]+ Dept\.|Department of)/i.test(firstParty)) {
    // Fallback: just use firstParty anyway if we can't find better
    return parts[1] ? parts[1].split(/\s+/)[0] : firstParty;
  }

  return firstParty;
}

function formatLongForm(data) {
  if (!data.caseName) return '';
  let citation = `<i>${data.caseName}</i>`;
  if (data.volume && data.reporter && data.page) {
    citation += `, ${data.volume} ${data.reporter} ${data.page}`;
    if (data.pinpoint) citation += `, ${data.pinpoint}`;
  } else if (data.reporter) {
    citation += `, ${data.reporter}`;
  }
  if (data.court || data.year) {
    citation += ` (${[data.court, data.year].filter(Boolean).join(' ')})`;
  }
  return citation;
}

function formatShortForm(data) {
  if (!data.caseName) return '';
  const shortName = data.shortCaseName && data.shortCaseName.trim()
    ? data.shortCaseName.trim()
    : abbreviateCaseName(data.caseName);
  let citation = `<i>${shortName}</i>`;
  if (data.volume && data.reporter && data.page) {
    citation += `, ${data.volume} ${data.reporter} ${data.page}`;
  } else if (data.reporter) {
    citation += `, ${data.reporter}`;
  }
  if (data.pinpoint) { // TODO: add override for public-domain states like OH, paragraph symbol
    citation += `, at ${data.pinpoint}`;
  }
  return citation;
}

function copyToClipboard(text, msgEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (msgEl) {
      msgEl.textContent = "Copied!";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 1500);
    }
  }).catch(err => {
    console.error("[Bluebook Citer] Copy failed:", err);
    if (msgEl) {
      msgEl.textContent = "Copy failed";
      msgEl.style.display = "inline";
      msgEl.style.color = "red";
      setTimeout(() => { msgEl.style.display = "none"; }, 2500);
    }
  });
}

function highlightMissingFields(data) {
  const missing = [];
  if (!data.caseName) missing.push('caseName');
  if (!data.volume) missing.push('volume');
  if (!data.reporter) missing.push('reporter');
  if (!data.page) missing.push('page');
  if (!data.court) missing.push('court');
  if (!data.year) missing.push('year');
  if (!data.docket) missing.push('docket');

  if (missing.length) {
    debugBox.style.color = 'red';
    debugBox.textContent += `\n\n⚠ Missing fields: ${missing.join(', ')}`;
  } else {
    debugBox.style.color = '#555';
  }
}

function updateCitationsFromForm() {
  const data = getFormData();
  longBox.innerHTML = formatLongForm(data);
  shortBox.innerHTML = formatShortForm(data);
  debugBox.textContent = JSON.stringify(data, null, 2);
  highlightMissingFields(data);
}

function generateCitation() {
  console.log('[Bluebook Citer] generateCitation called');

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) {
      console.warn('[Bluebook Citer] no active tab found');
      return;
    }
    console.log('[Bluebook Citer] sending extractCitation to tab', tabs[0].id);

    chrome.tabs.sendMessage(tabs[0].id, { type: 'extractCitation' }, response => {
      console.log('[Bluebook Citer] got response from content script:', response);

      if (response && response.ok) {
        let data = response.data;

        // Fill extracted fields
        fieldIds.forEach(id => {
          let el = document.getElementById(id);
          if (el) {
            if (id === 'shortCaseName') {
              // Auto-fill with default short name if none set
              el.value = data.shortCaseName && data.shortCaseName.trim()
                ? data.shortCaseName.trim()
                : abbreviateCaseName(data.caseName || "");
            } else {
              el.value = data[id] || '';
            }
          }
        });

        updateCitationsFromForm();
      } else {
        longBox.textContent = '';
        shortBox.textContent = '';
        debugBox.style.color = 'red';
        debugBox.textContent = response?.error || 'No data extracted';
      }
    });
  });
}

// -------------------------------
// Auto-generate on popup open
// -------------------------------
generateCitation();

// Manual generate button
if (generateBtn) {
  generateBtn.addEventListener('click', generateCitation);
}

// Copy buttons
const copyLongMsg = document.getElementById('copyLongMsg');
const copyShortMsg = document.getElementById('copyShortMsg');

copyLongBtn.addEventListener('click', () => 
  copyToClipboard(longBox.textContent || longBox.innerText, copyLongMsg)
);

copyShortBtn.addEventListener('click', () => 
  copyToClipboard(shortBox.textContent || shortBox.innerText, copyShortMsg)
);

// Auto-update as user edits fields
fieldIds.forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateCitationsFromForm);
});
});
