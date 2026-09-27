const extractBtn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');
const hostnameEl = document.getElementById('hostname');
const includeStorageEl = document.getElementById('includeStorage');
const includeScreenshotEl = document.getElementById('includeScreenshot');

let activeTab = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function safeName(str) {
  return String(str).replace(/[^a-z0-9.-]+/gi, '_').slice(0, 80);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Ask the content script for page data. Injects it first in case the tab
 *  was already open before the extension loaded (content_scripts only
 *  auto-run on future navigations). */
function requestExtraction(tabId, options) {
  return new Promise((resolve, reject) => {
    const send = () => {
      chrome.tabs.sendMessage(tabId, { action: 'extract', options }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('No response from page'));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || 'Extraction failed'));
          return;
        }
        resolve(response.data);
      });
    };

    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => {
        // Ignore "already injected"-type errors — content.js guards itself.
        send();
      }
    );
  });
}

function captureScreenshot() {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        resolve(null);
        return;
      }
      resolve(dataUrl);
    });
  });
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildReadme(data) {
  const { meta, stylesheets, scripts, structure } = data;
  return `# The Extractor — site bundle

Source: ${meta.url}
Title: ${meta.title}
Extracted: ${data.extractedAt}

This zip is a snapshot of one page, meant to be handed to an AI assistant
that is helping you build a browser extension for this site.

## Files

- \`page.html\` — full rendered DOM (\`document.documentElement.outerHTML\`) at
  the moment of extraction. This is the DOM *after* JavaScript ran, not the
  server's original source.
- \`meta.json\` — title, URL, \`<meta>\` tags, viewport, language.
- \`structure.json\` — a curated summary of forms, buttons, links, nav/header/
  footer/main regions, tables, iframes, images and headings, with their
  ids/classes/attributes. Use this to find selectors without wading through
  the full HTML.
- \`styles/\` — every stylesheet, external and inline, as separate \`.css\`
  files. Stylesheets that could not be fetched (usually cross-origin) are
  listed with their URL only in \`styles/external-manifest.json\`.
- \`scripts-manifest.json\` — every \`<script>\` tag: its \`src\` (if external) or
  full inline source (if inline).
- \`storage.json\` — \`localStorage\`/\`sessionStorage\` keys (and values, if that
  option was enabled when extracting).
- \`screenshot.png\` — screenshot of the visible viewport, if captured.

## Suggested use

Point an AI assistant at this folder and ask it to design a Manifest V3
extension: which \`matches\` pattern to use, which DOM selectors in
\`structure.json\` to target with a content script, and what CSS in \`styles/\`
it needs to account for when injecting UI.

Stylesheet count: ${stylesheets.external.length} external, ${stylesheets.inline.length} inline.
Script count: ${scripts.length}.
Forms found: ${structure.forms.length}.
`;
}

extractBtn.addEventListener('click', async () => {
  extractBtn.disabled = true;
  try {
    setStatus('Reading page…');
    if (!activeTab) activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) throw new Error('No active tab found');
    if (!/^https?:/.test(activeTab.url || '')) {
      throw new Error('This page can\'t be extracted (not an http/https page).');
    }

    const options = { includeStorageValues: includeStorageEl.checked };
    const data = await requestExtraction(activeTab.id, options);

    let screenshotDataUrl = null;
    if (includeScreenshotEl.checked) {
      setStatus('Capturing screenshot…');
      screenshotDataUrl = await captureScreenshot();
    }

    setStatus('Building zip…');
    const zip = new ZipWriter();

    zip.addFile('page.html', data.html);
    zip.addFile('meta.json', JSON.stringify(data.meta, null, 2));
    zip.addFile('structure.json', JSON.stringify(data.structure, null, 2));
    zip.addFile('storage.json', JSON.stringify(data.storage, null, 2));

    data.stylesheets.inline.forEach((s) => {
      zip.addFile(`styles/inline-${s.index}.css`, s.content);
    });
    const externalManifest = [];
    data.stylesheets.external.forEach((s, i) => {
      if (s.content !== null) {
        let name = 'external-' + i + '-' + safeName(new URL(s.href).pathname.split('/').pop() || 'style') + '.css';
        if (!name.endsWith('.css')) name += '.css';
        zip.addFile(`styles/${name}`, s.content);
        externalManifest.push({ href: s.href, savedAs: `styles/${name}` });
      } else {
        externalManifest.push({ href: s.href, error: s.error });
      }
    });
    zip.addFile('styles/external-manifest.json', JSON.stringify(externalManifest, null, 2));

    zip.addFile('scripts-manifest.json', JSON.stringify(data.scripts, null, 2));

    if (screenshotDataUrl) {
      zip.addFile('screenshot.png', dataUrlToBytes(screenshotDataUrl));
    }

    zip.addFile('README.md', buildReadme(data));

    const bytes = zip.build();
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);

    const host = safeName(new URL(data.meta.url).hostname);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `the-extractor_${host}_${stamp}.zip`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setStatus(`Done — downloaded ${filename}`);
  } catch (err) {
    setStatus('Error: ' + (err && err.message ? err.message : String(err)));
  } finally {
    extractBtn.disabled = false;
  }
});

(async () => {
  activeTab = await getActiveTab();
  if (activeTab && activeTab.url) {
    try {
      hostnameEl.textContent = new URL(activeTab.url).hostname;
    } catch {
      hostnameEl.textContent = '';
    }
  }
})();
