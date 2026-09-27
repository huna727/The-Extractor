# The Extractor

A Microsoft Edge (Manifest V3) extension that bundles a webpage's HTML, CSS,
scripts, DOM structure, storage keys and a screenshot into a single `.zip`
file — sized and organized for handing to an AI assistant that's helping you
build a browser extension for that site.

## Install in Edge

1. Unzip this package somewhere on disk (don't delete the folder afterward —
   Edge loads the extension from these files, it doesn't copy them).
2. Open `edge://extensions`.
3. Turn on **Developer mode** (bottom-left toggle).
4. Click **Load unpacked**.
5. Select the `the-extractor` folder (the one containing `manifest.json`).
6. The Extractor's icon appears in the toolbar (you may need to click the
   puzzle-piece icon and pin it).

## Use it

1. Go to the site you want to extract.
2. Click the **The Extractor** toolbar icon.
3. Optionally toggle:
   - **Include storage values** — off by default. When on, it copies the
     actual values in `localStorage`/`sessionStorage`, not just the key
     names. These can contain session tokens — leave this off unless you
     specifically need the values and trust where the zip is going.
   - **Include a screenshot** — on by default.
4. Click **Extract This Site**. A zip downloads immediately (no upload, no
   network calls — everything happens locally in your browser).

## What's inside the zip

See the `README.md` that's generated inside each extraction zip — it lists
every file and what it contains. In short: `page.html` (rendered DOM),
`meta.json`, `structure.json` (curated selectors for forms/buttons/nav/etc.),
`styles/` (every stylesheet), `scripts-manifest.json`, `storage.json`, and
`screenshot.png`.

## Notes and limits

- Only works on `http(s)://` pages (not `edge://`, PDF viewer, or the Chrome
  Web Store — browser policy blocks extensions there).
- Cross-origin stylesheets that don't allow CORS can't be fetched from the
  page; their URL is recorded instead of their content (see
  `styles/external-manifest.json` in the output).
- If you extract a page that was already open before you installed the
  extension, the first click may take an extra beat while the content
  script gets injected — that's expected and handled automatically.
- Everything runs locally. No data leaves your machine.

## Files in this project

```
the-extractor/
├── manifest.json     Extension manifest (MV3)
├── popup.html/.css/.js   Toolbar popup UI and orchestration
├── content.js        Injected into the page; gathers the data
├── lib/zip.js         Small dependency-free ZIP writer (store method)
└── README.md          This file
```
