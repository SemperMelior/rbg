// popup.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Bluebook Citer] popup opened');

  const longBox = document.getElementById('longForm');
  const shortBox = document.getElementById('shortForm');
  const debugBox = document.getElementById('debugLog');
  const copyLongBtn = document.getElementById('copyLong');
  const copyShortBtn = document.getElementById('copyShort');
  const generateBtn = document.getElementById('generate');

  const fieldIds = [
    'caseName', 'shortCaseName', 'volume', 'rawRptr', 'reporter', 'page',
    'pinpoint', 'court', 'year', 'docket', 'sourceUrl', 'fullDate'
  ];

  function getFormData() {
    const data = {};
    fieldIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) data[id] = el.value || '';
    });
    return data;
  }

  function abbreviateCaseName(fullCaseName) {
    if (!fullCaseName) return "";
    const parts = fullCaseName.split(/\s+v\.?\s+/i);
    let firstParty = parts[0] || "";
    firstParty = firstParty.trim().replace(/[.,]+$/, "");
    firstParty = firstParty.replace(/\b(Inc|Incorporated|Corp|Corporation|LLC|L\.L\.C\.|Ltd|Co)\.?$/i, "").trim();
    if (/^(United States|State of|People of|People|Commonwealth of|Ohio|Texas|Florida|California|[A-Z][a-z]+ Dep’t|[A-Z][a-z]+ Dept\.|Department of)/i.test(firstParty)) {
      return parts[1] ? parts[1].split(/\s+/)[0] : firstParty;
    }
    return firstParty;
  }

  function formatLongForm(data) {
    if (!data.caseName) return '';
    const isUnreported = /LEXIS|WL/i.test(data.reporter || "");

    if (isUnreported) {
      console.log('[Bluebook Citer] isUnreported TRUE');
      let citation = `<i>${data.caseName}</i>`;
      if (data.docket) citation += `, ${data.docket}`;
      if (data.year && data.reporter) citation += `, ${data.year} ${data.reporter}`;
      if (data.page) citation += ` ${data.page}`;
      if (data.pinpoint) citation += `, at *${data.pinpoint}`;
      if (data.court || data.fullDate) {
        citation += ` (${[data.court, data.fullDate || data.year].filter(Boolean).join(' ')})`;
      }
      return citation;
    }

    // Reported cases
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

    const isUnreported = /LEXIS|WL/i.test(data.reporter || "");
    let citation = `<i>${shortName}</i>`;
    if (isUnreported) {
      if (data.year && data.reporter && data.page) citation += `, ${data.year} ${data.reporter} ${data.page}`;
      if (data.pinpoint) citation += `, at *${data.pinpoint}`;
      return citation;
    }

    // Reported cases
    if (data.volume && data.reporter && data.page) {
      citation += `, ${data.volume} ${data.reporter} ${data.page}`;
    } else if (data.reporter) {
      citation += `, ${data.reporter}`;
    }
    if (data.pinpoint) {
      citation += `, at ${/LEXIS|WL/i.test(data.reporter || "") ? "*" : ""}${data.pinpoint}`;
    }
    return citation;
  }

  function copyToClipboard(text, msgEl) {
    navigator.clipboard.writeText(text).then(() => {
      if (msgEl) {
        msgEl.style.display = "inline";
        setTimeout(() => { msgEl.style.display = "none"; }, 1500);
      }
    }).catch(err => {
      console.error("[Bluebook Citer] Copy failed:", err);
      if (msgEl) {
        msgEl.textContent = "✖"; // red X if failed
        msgEl.style.color = "red";
        msgEl.style.display = "inline";
        setTimeout(() => { msgEl.style.display = "none"; msgEl.textContent = "✔"; msgEl.style.color = "green"; }, 2000);
      }
    });
  }

  function highlightMissingFields(data) {
    const missing = [];
    if (!data.caseName) missing.push('caseName');
    if (!data.court) missing.push('court');
    if (!data.year) missing.push('year');
    if (/LEXIS|WL/i.test(data.reporter || "")) {
      if (!data.docket) missing.push('docket');
    } else {
      if (!data.volume) missing.push('volume');
      if (!data.reporter) missing.push('reporter');
      if (!data.page) missing.push('page');
    }
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
    const btn = document.getElementById('generate');
    if (btn) {
      btn.classList.remove('spin'); // reset in case it’s mid-spin
      void btn.offsetWidth;         // trick to reflow & restart animation
      btn.classList.add('spin');    // trigger one-time spin
    }

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'extractCitation' }, response => {
        if (response && response.ok) {
          let data = response.data;
          fieldIds.forEach(id => {
            let el = document.getElementById(id);
            if (el) {
              if (id === 'shortCaseName') {
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

  generateCitation();

  if (generateBtn) {
    generateBtn.addEventListener('click', generateCitation);
  }

  const copyLongMsg = document.getElementById('copyLongMsg');
  const copyShortMsg = document.getElementById('copyShortMsg');

  copyLongBtn.addEventListener('click', () =>
    copyToClipboard(longBox.textContent || longBox.innerText, copyLongMsg)
  );

  copyShortBtn.addEventListener('click', () =>
    copyToClipboard(shortBox.textContent || shortBox.innerText, copyShortMsg)
  );

  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCitationsFromForm);
  });

  // Collapsible toggle for Extracted Data
  const toggleBtn = document.getElementById('toggleFields');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const dataSection = document.getElementById('extractedData');
      dataSection.classList.toggle('collapsed');
      toggleBtn.textContent = dataSection.classList.contains('collapsed') ? '▶' : '▼';
    });
  }

  // Collapsible toggle for Bug Report section
  const toggleBugBtn = document.getElementById('toggleBug');
  if (toggleBugBtn) {
    toggleBugBtn.addEventListener('click', () => {
      const bugSection = document.getElementById('bugSection');
      bugSection.classList.toggle('collapsed');
      toggleBugBtn.textContent = bugSection.classList.contains('collapsed') ? '▶' : '▼';
    });
  }

  // Bug report button with green checkmark message
  const bugBtn = document.getElementById('sendBugReport');
  if (bugBtn) {
    bugBtn.addEventListener('click', () => {
      const description = document.getElementById('bugDescription').value.trim();
      const debugInfo = debugBox.textContent || "(no debug info)";
      const sourceUrl = document.getElementById('sourceUrl')?.value || "";

      const subject = encodeURIComponent("Bluebook Citer Bug Report");
      const body = encodeURIComponent(
  `User description:
  ${description}

  Source URL:
  ${sourceUrl}

  Debug Info (expand if needed):
  -------------------------------
  ${debugInfo}`
      );

      // ✅ Show green checkmark immediately
      const sentMsg = document.getElementById('bugSentMsg');
      if (sentMsg) {
        sentMsg.style.display = "inline";
        setTimeout(() => { sentMsg.style.display = "none"; }, 2000);
      }

      // ✅ Open mailto in a new tab (popup stays alive)
      chrome.tabs.create({
        url: `mailto:ian.holmes@law.gwu.edu?subject=${subject}&body=${body}`
      });
    });
  }
});
