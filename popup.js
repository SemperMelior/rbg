// popup.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Bluebook Citer] popup opened');

  const longBox = document.getElementById('longForm');
  const shortBox = document.getElementById('shortForm');
  const debugBox = document.getElementById('debugLog');
  const generateBtn = document.getElementById('generate');
  const copyLongBtn = document.getElementById('copyLong');
  const copyShortBtn = document.getElementById('copyShort');

  function getFormData() {
    return {
      caseName: document.getElementById('caseName').value.trim(),
      volume: document.getElementById('volume').value.trim(),
      reporter: document.getElementById('reporter').value.trim(),
      page: document.getElementById('page').value.trim(),
      pinpoint: document.getElementById('pinpoint').value.trim(),
      court: document.getElementById('court').value.trim(),
      year: document.getElementById('year').value.trim(),
      docket: document.getElementById('docket').value.trim(),
      sourceUrl: document.getElementById('sourceUrl').value.trim(),
    };
  }

  function formatLongForm(data) {
    if (!data.caseName) return '';
    let citation = `${data.caseName}`;
    if (data.volume && data.reporter && data.page) {
      citation += `, ${data.volume} ${data.reporter} ${data.page}`;
      if (data.pinpoint) citation += `, ${data.pinpoint}`;
    }
    if (data.court || data.year) {
      citation += ` (${[data.court, data.year].filter(Boolean).join(' ')})`;
    }
    if (data.docket) {
      citation += ` (No. ${data.docket})`;
    }
    return citation;
  }

  function formatShortForm(data) {
    if (!data.caseName) return '';
    const shortName = data.caseName.split(' v. ')[0];
    let citation = `${shortName}`;
    if (data.reporter && (data.pinpoint || data.page)) {
      citation += `, ${data.reporter} at ${data.pinpoint || data.page}`;
    }
    return citation;
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(err => {
      alert('Copy failed: ' + err);
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

  function generateCitation() {
    const editedData = getFormData();
    longBox.textContent = formatLongForm(editedData);
    shortBox.textContent = formatShortForm(editedData);
    debugBox.textContent = JSON.stringify(editedData, null, 2);
    highlightMissingFields(editedData);
  }

  function fetchAndPopulate() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]?.id) {
        console.warn('[Bluebook Citer] no active tab found');
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { type: 'extractCitation' }, response => {
        if (response && response.ok) {
          const data = response.data;

          // Populate inputs
          document.getElementById('caseName').value = data.caseName || '';
          document.getElementById('volume').value = data.volume || '';
          document.getElementById('reporter').value = data.reporter || '';
          document.getElementById('page').value = data.page || '';
          document.getElementById('pinpoint').value = data.pinpoint || '';
          document.getElementById('court').value = data.court || '';
          document.getElementById('year').value = data.year || '';
          document.getElementById('docket').value = data.docket || '';
          document.getElementById('sourceUrl').value = data.sourceUrl || '';

          // Generate citations
          generateCitation();
        } else {
          longBox.textContent = '';
          shortBox.textContent = '';
          debugBox.style.color = 'red';
          debugBox.textContent = response?.error || 'No data extracted';
        }
      });
    });
  }

  // Run extraction on popup open
  fetchAndPopulate();

  // Manual re-generate button
  if (generateBtn) {
    generateBtn.addEventListener('click', generateCitation);
  }

  // Auto-update when typing in any field
  const fields = [
    'caseName', 'volume', 'reporter', 'page', 'pinpoint',
    'court', 'year', 'docket', 'sourceUrl'
  ];
  fields.forEach(id => {
    document.getElementById(id).addEventListener('input', generateCitation);
  });

  // Copy buttons
  copyLongBtn.addEventListener('click', () => copyToClipboard(longBox.textContent));
  copyShortBtn.addEventListener('click', () => copyToClipboard(shortBox.textContent));
});
