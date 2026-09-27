// The Extractor — content script
// Runs on every page. Waits for a request from the popup, gathers data
// about the page, and sends it back. Does nothing until asked.

(() => {
  if (window.__theExtractorInstalled) return; // avoid double-registering
  window.__theExtractorInstalled = true;

  function textSnippet(el, max = 120) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function attrs(el, names) {
    const out = {};
    for (const n of names) {
      const v = el.getAttribute(n);
      if (v !== null) out[n] = v;
    }
    return out;
  }

  async function collectStylesheets() {
    const sheets = [];
    const linkEls = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
    for (const link of linkEls) {
      const href = link.href;
      let content = null;
      let error = null;
      try {
        const res = await fetch(href, { credentials: 'omit' });
        if (res.ok) {
          content = await res.text();
        } else {
          error = `HTTP ${res.status}`;
        }
      } catch (e) {
        error = 'fetch failed (likely cross-origin) — URL recorded instead';
      }
      sheets.push({ href, content, error });
    }
    const inline = Array.from(document.querySelectorAll('style')).map((s, i) => ({
      index: i,
      content: s.textContent || ''
    }));
    return { external: sheets, inline };
  }

  function collectScripts() {
    return Array.from(document.querySelectorAll('script')).map((s, i) => ({
      index: i,
      src: s.src || null,
      type: s.type || 'text/javascript',
      async: s.async,
      defer: s.defer,
      inlineContent: s.src ? null : (s.textContent || '')
    }));
  }

  function collectMeta() {
    const meta = Array.from(document.querySelectorAll('meta')).map((m) =>
      attrs(m, ['name', 'property', 'content', 'charset', 'http-equiv'])
    );
    return {
      title: document.title,
      url: location.href,
      meta,
      lang: document.documentElement.lang || null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      }
    };
  }

  function collectKeyElements() {
    const pick = (selector, names) =>
      Array.from(document.querySelectorAll(selector)).slice(0, 300).map((el) => ({
        tag: el.tagName.toLowerCase(),
        ...attrs(el, names),
        text: textSnippet(el)
      }));

    return {
      forms: Array.from(document.querySelectorAll('form')).slice(0, 100).map((f) => ({
        action: f.getAttribute('action'),
        method: f.getAttribute('method'),
        id: f.id || null,
        fields: Array.from(f.querySelectorAll('input,select,textarea')).map((field) => ({
          tag: field.tagName.toLowerCase(),
          ...attrs(field, ['type', 'name', 'id', 'placeholder', 'aria-label', 'required', 'value'])
        }))
      })),
      buttons: pick('button, [role="button"], input[type="submit"], input[type="button"]', [
        'id', 'class', 'type', 'aria-label', 'name'
      ]),
      links: pick('a[href]', ['href', 'id', 'class']),
      nav: pick('nav', ['id', 'class', 'aria-label']),
      headers: pick('header', ['id', 'class']),
      footers: pick('footer', ['id', 'class']),
      main: pick('main, [role="main"]', ['id', 'class']),
      tables: pick('table', ['id', 'class']),
      iframes: pick('iframe', ['id', 'class', 'src']),
      images: pick('img', ['id', 'class', 'src', 'alt']).slice(0, 100),
      headings: pick('h1,h2,h3', ['id', 'class'])
    };
  }

  function collectStorage(includeValues) {
    const dump = (storage) => {
      const out = {};
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          out[key] = includeValues ? storage.getItem(key) : '(value omitted)';
        }
      } catch (e) {
        return { error: 'inaccessible' };
      }
      return out;
    };
    return {
      localStorage: dump(window.localStorage),
      sessionStorage: dump(window.sessionStorage),
      note: includeValues
        ? 'Values included — check for tokens/secrets before sharing this zip.'
        : 'Only keys were captured. Enable "include storage values" in the popup to capture values too.'
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action !== 'extract') return; // let other listeners handle other messages

    (async () => {
      try {
        const stylesheets = await collectStylesheets();
        const data = {
          meta: collectMeta(),
          html: document.documentElement.outerHTML,
          stylesheets,
          scripts: collectScripts(),
          structure: collectKeyElements(),
          storage: collectStorage(!!msg.options?.includeStorageValues),
          extractedAt: new Date().toISOString()
        };
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();

    return true; // keep the message channel open for the async sendResponse
  });
})();
