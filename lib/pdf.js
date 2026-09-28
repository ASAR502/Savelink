const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_LINKS = 5000;
const MAX_SAVED_TEXT = 1_500_000;
const MAX_STATE_HEX = 8 * 1024 * 1024;
const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 48;
const WIDTH = 516;
const canvas = () => {
  if (typeof OffscreenCanvas === "undefined") throw new Error("Update your browser to create PDFs.");
  return new OffscreenCanvas(1, 1);
};

function measuringContext() {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1).getContext("2d");
  let fontSize = 10;
  return {
    set font(value) { fontSize = Number.parseFloat(value.match(/([\d.]+)px/)?.[1]) || 10; },
    measureText(text) { return { width: Array.from(text).length * fontSize * 0.56 }; },
  };
}

function pdfAscii(value) {
  return String(value).normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
}

function binaryString(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000)
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length))));
  return parts.join("");
}

function escapePdf(value) {
  return pdfAscii(value).replace(/([\\()])/g, "\\$1").replace(/[\r\n]/g, " ");
}

function bytesOfAscii(value) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 255;
  return bytes;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (size > MAX_BYTES) throw new Error("This PDF would exceed 25 MB. Create a new PDF or save fewer links in it.");
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

async function jpegLine(text, fontSize = 10, bold = false) {
  if (typeof OffscreenCanvas === "undefined") throw new Error("Update your browser to save text in this language.");
  const probe = canvas();
  const measure = probe.getContext("2d");
  measure.font = `${bold ? "600" : "400"} ${fontSize * 3}px Arial, sans-serif`;
  const width = Math.max(8, Math.ceil(measure.measureText(text).width) + 18);
  const height = fontSize * 3 + 18;
  const imageCanvas = new OffscreenCanvas(width, height);
  const context = imageCanvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.font = `${bold ? "600" : "400"} ${fontSize * 3}px Arial, sans-serif`;
  context.fillStyle = "#202124";
  context.textBaseline = "middle";
  context.fillText(text, 6, height / 2, width - 12);
  const blob = await imageCanvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let imageWidth = 0, imageHeight = 0;
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      imageHeight = (bytes[i + 5] << 8) | bytes[i + 6];
      imageWidth = (bytes[i + 7] << 8) | bytes[i + 8];
      break;
    }
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) break;
    i += length + 2;
  }
  if (!imageWidth || !imageHeight) throw new Error("Your browser could not prepare text for this PDF.");
  return { bytes, width: imageWidth, height: imageHeight };
}

function splitText(text, measure, maxWidth) {
  const rows = [];
  for (const paragraph of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) { rows.push(""); continue; }
    const units = Array.from(paragraph);
    let start = 0;
    while (start < units.length) {
      while (start < units.length && units[start] === " ") start++;
      if (start === units.length) break;
      // Binary search guarantees forward progress even for a very long token.
      let low = 1, high = units.length - start, fit = 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = units.slice(start, start + mid).join("");
        if (measure(candidate) <= maxWidth || fit === 0) { fit = mid; low = mid + 1; }
        else high = mid - 1;
      }
      let end = start + Math.max(fit, 1);
      if (end < units.length) {
        const spaceAt = units.lastIndexOf(" ", end - 1);
        if (spaceAt > start) end = spaceAt;
      }
      rows.push(units.slice(start, end).join("").trimEnd());
      start = end;
      while (start < units.length && units[start] === " ") start++;
    }
  }
  return rows;
}

function isUnicode(value) { return /[^\x20-\xff]/u.test(value); }

export async function inspectPdf(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) throw new Error("Choose a PDF smaller than 25 MB.");
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 131072)));
  if (!head.startsWith("%PDF-")) throw new Error("This file is not a readable PDF.");
  if (!head.includes("%LINK-SAVER") && !isLegacyLinkSaverPdf(head)) {
    throw new Error("This is not a Link Saver PDF. Create a new PDF to keep your existing file unchanged.");
  }
  const contents = bytes.length > head.length ? new TextDecoder("latin1").decode(bytes) : head;
  const matches = contents.match(/\/Type\s*\/Page\b/g) || [];
  const metadata = contents.match(/\/LinkSaverState\s*<([A-Fa-f0-9]+)>/);
  let linkCount = 0;
  if (metadata) {
    try {
      const hex = metadata[1];
      if (hex.length > MAX_STATE_HEX) throw new Error("Saved link data is too large.");
      const encoded = Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
      linkCount = JSON.parse(new TextDecoder().decode(encoded)).length;
    } catch { throw new Error("The saved-link information is damaged. Create a new PDF and leave this file unchanged."); }
  }
  const legacy = !metadata && isLegacyLinkSaverPdf(head);
  if (!matches.length) throw new Error("This PDF has no readable pages, so it was left unchanged.");
  if (legacy) linkCount = (contents.match(/\/Subtype\s*\/Link\b/g) || []).length;
  return { pageCount: matches.length, linkCount, managed: true, legacy, hasMetadata: Boolean(metadata) };
}

function isLegacyLinkSaverPdf(head) {
  // Recognize PDFs produced by the earlier Link Saver release; do not accept
  // arbitrary PDFs for rebuilding, because that would replace their content.
  return head.includes("(MY SAVED LINKS) Tj") && head.includes("/BaseFont /Helvetica") && head.includes("/Type /Catalog");
}

export async function createEmptyPdf() {
  return makePdf([]);
}

export async function appendLinkToPdf(existingBytes, entry, legacyHistory = []) {
  const url = new URL(entry.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https links can be saved.");
  if (entry.title?.length > 500 || entry.description?.length > 10000) throw new Error("The page title or description is too long.");
  let oldLinks = [];
  if (existingBytes?.length) {
    const info = await inspectPdf(existingBytes);
    const text = new TextDecoder("latin1").decode(existingBytes);
    if (!info.legacy && !info.hasMetadata) {
      throw new Error("This Link Saver PDF has damaged save information. Create a new PDF to keep its contents unchanged.");
    }
    if (info.legacy) {
      const validHistory = Array.isArray(legacyHistory) ? legacyHistory.filter((link) => {
        try { return link && ["http:", "https:"].includes(new URL(link.url).protocol); }
        catch { return false; }
      }).slice(0, MAX_LINKS - 1) : [];
      if (info.linkCount > 0 && validHistory.length === 0) {
        throw new Error("Old links from this PDF could not be restored. The original file was left unchanged.");
      }
      oldLinks = validHistory.map((link, index) => ({
        id: `legacy-${index}-${link.url}`,
        url: link.url,
        title: link.title || new URL(link.url).hostname,
        description: link.description || "",
        savedAt: link.savedAt || link.time || new Date().toISOString(),
      }));
    }
    const encoded = text.match(/\/LinkSaverState\s*<([A-Fa-f0-9]+)>/);
    if (encoded) {
      try {
        const hex = encoded[1];
        const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
        oldLinks = JSON.parse(new TextDecoder().decode(bytes));
      }
      catch { throw new Error("The saved-link list in this PDF is damaged. Your original file was not changed."); }
    }
  }
  if (oldLinks.some((link) => link.id === entry.id)) return { bytes: existingBytes, alreadySaved: true };
  if (oldLinks.length >= MAX_LINKS) throw new Error("This PDF already contains 5,000 links. Create a new PDF to continue.");
  return { bytes: await makePdf([...oldLinks, { ...entry, url: url.href }]), alreadySaved: false };
}

async function makePdf(links) {
  if (links.length > 5000) throw new Error("This PDF contains over 5,000 links. Create a new PDF to continue.");
  const measure = measuringContext();
  const rows = [
    { text: "MY SAVED LINKS", style: "title" },
    { text: "Click a blue address to open the website in your browser.", style: "small" },
    { text: "", style: "normal" },
  ];
  let inputSize = 0;
  for (const link of links) {
    inputSize += String(link.url || "").length + String(link.title || "").length + String(link.description || "").length;
    if (inputSize > MAX_SAVED_TEXT) throw new Error("This PDF has too much saved text to update at once. Create a new PDF for additional links.");
  }
  const annotationsByPage = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const title = String(link.title || new URL(link.url).hostname).slice(0, 500);
    rows.push({ text: `${i + 1}. ${title}`, style: "heading", bold: true });
    const firstUrlRow = rows.length;
    measure.font = "400 30px Arial, sans-serif";
    const wrappedUrl = splitText(link.url, (text) => measure.measureText(text).width, WIDTH * 3);
    for (const text of wrappedUrl) rows.push({ text, style: "url" });
    for (let row = firstUrlRow; row < rows.length; row++) {
      const page = Math.floor(row / 45);
      (annotationsByPage[page] ||= []).push({ row, url: link.url });
    }
    const about = String(link.description || "No note added").slice(0, 10000);
    rows.push({ text: `About: ${about}`, style: "normal" });
    rows.push({ text: `Saved: ${new Date(link.savedAt || Date.now()).toLocaleString()}`, style: "small" });
    rows.push({ text: "", style: "normal" });
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / 45));
  if (pageCount > MAX_PAGES) throw new Error("This PDF reached the 500-page limit. Create a new PDF.");

  const objects = [null, "<< /Type /Catalog /Pages 2 0 R /Lang (en-US) >>", "<< /Type /Pages /Kids [] /Count 0 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const addObject = (data) => { objects.push(data); return objects.length - 1; };
  const pages = [];
  for (let pageNumber = 0; pageNumber < pageCount; pageNumber++) {
    const pageRows = rows.slice(pageNumber * 45, (pageNumber + 1) * 45);
    const pageAnnotations = annotationsByPage[pageNumber] || [];
    const commands = [];
    const xobjects = [];
    for (let row = 0; row < pageRows.length; row++) {
      const entry = pageRows[row];
      const fontSize = entry.style === "title" ? 18 : entry.style === "heading" ? 12 : entry.style === "small" ? 9 : 10;
      const y = PAGE_H - 42 - row * 15;
      if (isUnicode(entry.text)) {
        const image = await jpegLine(entry.text, fontSize, entry.bold);
        const imageId = addObject(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n${binaryString(image.bytes)}\nendstream`);
        const imageName = `Im${imageId}`;
        xobjects.push(`/${imageName} ${imageId} 0 R`);
        const drawW = Math.min(WIDTH, image.width / 3);
        const drawH = Math.min(13, image.height / 3);
        commands.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${LEFT} ${(y - 2).toFixed(2)} cm /${imageName} Do Q`);
      } else {
        const color = entry.style === "url" ? "0.10 0.45 0.91" : entry.style === "small" ? "0.37 0.39 0.41" : "0.13 0.13 0.14";
        commands.push(`${color} rg BT /F1 ${fontSize} Tf ${LEFT} ${y} Td (${escapePdf(entry.text)}) Tj ET`);
      }
    }
    const annotationsForPage = [];
    for (const annotation of pageAnnotations) {
      const inPageRow = annotation.row - pageNumber * 45;
      const y = PAGE_H - 42 - inPageRow * 15;
      measure.font = "400 30px Arial, sans-serif";
      const w = Math.min(WIDTH, Math.max(16, measure.measureText(rows[annotation.row].text).width / 3));
      const id = addObject(`<< /Type /Annot /Subtype /Link /Rect [${LEFT} ${y - 3} ${LEFT + w} ${y + 12}] /Border [0 0 0] /A << /S /URI /URI <${toHexBytes(new TextEncoder().encode(annotation.url))}> >> >>`);
      annotationsForPage.push(`${id} 0 R`);
    }
    const streamData = new TextEncoder().encode(commands.join("\n"));
    const streamId = addObject(`<< /Length ${streamData.length} >>\nstream\n${new TextDecoder().decode(streamData)}\nendstream`);
    const pageId = addObject("");
    pages.push({ pageId, streamId, annotations: annotationsForPage, xobjects });
  }
  const kids = pages.map(({ pageId }) => `${pageId} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  for (const { pageId, streamId, annotations: refs, xobjects } of pages) {
    const resource = xobjects.length ? `/XObject << ${xobjects.join(" ")} >>` : "";
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> ${resource} >> /Contents ${streamId} 0 R /Annots [${refs.join(" ")}] >>`;
  }
  const state = JSON.stringify(links.map(({ id, url, title, description, savedAt }) => ({ id, url, title, description, savedAt })));
  const encodedState = new TextEncoder().encode(state);
  if (encodedState.length * 2 > MAX_STATE_HEX) throw new Error("The saved-link list is too large to store inside this PDF. Create a new PDF.");
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Lang (en-US) /LinkSaverState <${toHexBytes(encodedState)}> >>`;
  const header = bytesOfAscii("%PDF-1.4\n%LINK-SAVER\n");
  const objectBytes = [];
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    const value = objects[id];
    if (typeof value !== "string") throw new Error("The PDF could not be assembled. Try again.");
    objectBytes.push(bytesOfAscii(`${id} 0 obj\n${value}\nendobj\n`));
  }
  let xrefOffset = header.length;
  for (let id = 1; id < objectBytes.length + 1; id++) {
    offsets[id] = xrefOffset;
    xrefOffset += objectBytes[id - 1].length;
  }
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const parts = [header];
  for (const object of objectBytes) parts.push(object);
  parts.push(bytesOfAscii(xref));
  return concatBytes(parts);
}

function toHexBytes(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(); }
