# Link Saver for Chromium Browsers

Link Saver runs locally in Chromium based browsers that support Manifest V3, extension service workers, and the File System Access API. Clicking the toolbar icon opens a compact popup. Choose **Select PDF** to use a PDF from your computer, or **New PDF** to create one. Save links to the selected file; the extension remembers each file and updates its readable list. Each address is clickable. After a successful save, the popup closes automatically. No server, account, or network connection is needed to save.

## Install for development

1. Open your browser's extensions management page (for example, `chrome://extensions` in Chrome or `edge://extensions` in Edge).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder, the one containing `manifest.json`.
4. Open a regular web page and click the Link Saver toolbar icon to open the popup.

## Existing PDFs

For safety, this version edits PDFs created by Link Saver. It recognizes PDFs created by the previous Link Saver format and restores their saved links from this extension's local extension storage. It leaves unrelated PDFs untouched. Password-protected, damaged, read-only, or larger-than-25-MB PDFs receive an error before the save can replace the file. Create a new Link Saver PDF if a selected PDF cannot be edited.

When updating a selected PDF, Link Saver reads its existing saved-link list and writes an updated PDF to the same file. Use **New PDF** to keep a separate collection. File handles and retry records stay in extension IndexedDB; links from the earlier release may also be read from browser extension local storage during migration. Data is not uploaded.

A save request is stored before the file update, then completed in the browser's background service worker. Failed saves remain available through **Retry previous save**. Repeating a completed request does not add a duplicate. The PDF supports up to 5,000 links, 500 pages, 1.5 million characters of saved text, and 25 MB. Unicode text is drawn into the PDF as an image so Hindi and emoji remain legible; those specific lines are not selectable as text.

## Release package

Run `npm run package` to create a timestamped unpacked folder and ZIP under `dist/`. The package contains only the manifest, popup UI, local save code, and icons. It omits the old unused server and its SQLite files.

## Privacy

See [PRIVACY.md](PRIVACY.md).
