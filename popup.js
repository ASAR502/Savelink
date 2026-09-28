import {
  getValue,
  setValue,
  getSelectedTarget,
  rememberTarget,
  createJob,
  getUnfinishedJobs,
  getTarget,
} from "./lib/storage.js";
import { friendlyError } from "./lib/save.js";

const $ = (id) => document.getElementById(id);
const form = $("save-form");
const urlInput = $("url");
const descriptionInput = $("description");
const saveButton = $("save");
const selectButton = $("choose-file");
const newButton = $("create-file");
const retryButton = $("retry");
const status = $("status");
const pickerTypes = [
  { description: "PDF document", accept: { "application/pdf": [".pdf"] } },
];
let target = null;
let lastJob = null;
let activePage = {};
let ready = false;
let busy = false;
let draftTimer;

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}

function setBusy(value) {
  busy = value;
  form.setAttribute("aria-busy", String(value));
  for (const control of [
    urlInput,
    descriptionInput,
    saveButton,
    selectButton,
    newButton,
    retryButton,
  ]) {
    control.disabled = value || !ready;
  }
}

function showTarget() {
  $("file-name").textContent = target?.name || "No PDF selected";
  $("file-name").title = target?.name || "Choose a PDF on your computer";
}

function draft() {
  return {
    url: urlInput.value,
    description: descriptionInput.value,
    title: activePage.title || "",
    pageUrl: activePage.url || "",
    updatedAt: Date.now(),
  };
}

async function persistDraft() {
  clearTimeout(draftTimer);
  await setValue("settings", "draft", draft());
}

form.addEventListener("input", () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(
    () => persistDraft().catch((error) => message(friendlyError(error), true)),
    180,
  );
});

function validateEntry() {
  let parsed;
  try {
    parsed = new URL(urlInput.value.trim());
  } catch {
    throw new Error(
      "Enter a complete web address, such as https://example.com.",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Only http and https links can be saved.");
  if (parsed.username || parsed.password)
    throw new Error(
      "Remove the username or password from this address before saving.",
    );
  if (parsed.href.length > 32768)
    throw new Error(
      "This link is too long to save (maximum 32,768 characters).",
    );
  if (descriptionInput.value.length > 10000)
    throw new Error("Keep the description under 10,000 characters.");
  return {
    url: parsed.href,
    description: descriptionInput.value.trim(),
    savedAt: new Date().toISOString(),
    title:
      urlInput.value.trim() === activePage.url
        ? (activePage.title || "").slice(0, 500)
        : parsed.hostname,
  };
}

async function chooseFile(mode) {
  if (!ready || busy) return;
  let handle;
  setBusy(true);
  try {
    if (!window.showOpenFilePicker || !window.showSaveFilePicker)
      throw new Error(
        "Use a current desktop Chromium browser to select a PDF.",
      );
    // Keep native pickers in a durable window and before any storage awaits.
    if (mode === "existing") {
      [handle] = await window.showOpenFilePicker({
        id: "link-saver-pdf",
        types: pickerTypes,
        excludeAcceptAllOption: true,
        multiple: false,
      });
    } else {
      handle = await window.showSaveFilePicker({
        id: "link-saver-pdf",
        suggestedName: "My Saved Links.pdf",
        types: pickerTypes,
        excludeAcceptAllOption: true,
      });
    }
    if (!handle.name.toLowerCase().endsWith(".pdf"))
      throw new Error("Choose a file whose name ends in .pdf.");
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted")
      throw new DOMException("Write access denied.", "NotAllowedError");
    message("Reading PDF…");
    const file = await handle.getFile();
    if (file.size > 25 * 1024 * 1024)
      throw new Error(
        "Choose a PDF smaller than 25 MB to keep saves responsive.",
      );
    const { inspectPdf, createEmptyPdf } = await import("./lib/pdf.js");
    if (file.size) {
      await inspectPdf(new Uint8Array(await file.arrayBuffer()));
    } else if (mode === "existing") {
      throw new Error(
        "This file is empty. Use New PDF to create a valid document.",
      );
    } else {
      const bytes = await createEmptyPdf();
      const current = await handle.getFile();
      if (current.size !== 0 || current.lastModified !== file.lastModified)
        throw new Error("The file changed. Select it again.");
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    }
    target = await rememberTarget(handle);
    showTarget();
    message("PDF selected. Click Save link to add this page.");
  } catch (error) {
    if (error.name === "AbortError")
      message("Selection cancelled. Your previous PDF is still selected.");
    else message(friendlyError(error), true);
  } finally {
    setBusy(false);
  }
}

selectButton.addEventListener("click", () => chooseFile("existing"));
newButton.addEventListener("click", () => chooseFile("new"));

async function allowTargetWrite(selected) {
  if (!selected)
    throw new Error("Select an existing PDF or create a new one first.");
  const permission = await selected.handle.requestPermission({ mode: "readwrite" });
  if (permission === "granted") return true;
  throw new DOMException("Write access denied.", "NotAllowedError");
}

async function runSave(retry = false) {
  if (!ready || busy) return;
  let successful = false;
  setBusy(true);
  try {
    const entry = retry ? null : validateEntry();
    if (!target)
      throw new Error("Select an existing PDF or create a new one first.");
    if (!(await allowTargetWrite(target))) return;
    if (retry && lastJob?.targetId !== target.id)
      throw new Error(
        "Select the original PDF to retry that request, or use Save link for this PDF.",
      );
    await persistDraft();
    const job = retry ? lastJob : await createJob(target.id, entry);
    lastJob = job;
    message("Saving to your PDF…");
    const result = await chrome.runtime.sendMessage({
      type: "save-pdf",
      id: job.id,
    });
    if (!result?.ok)
      throw new Error(
        result?.error ||
          "The save was interrupted. Your link is kept locally; use Retry save.",
      );
    await setValue("settings", "draft", null).catch(() => {});
    const unfinished = await getUnfinishedJobs();
    lastJob = unfinished[0] || job;
    retryButton.hidden = unfinished.length === 0;
    const earlierSaves = unfinished.length
      ? ` ${unfinished.length} earlier save${unfinished.length === 1 ? "" : "s"} can be retried.`
      : "";
    message(result.warning || `Saved to ${result.fileName}.${earlierSaves}`);
    successful = true;
    saveButton.textContent = "Saved";
  } catch (error) {
    message(friendlyError(error), true);
    retryButton.hidden = !lastJob || lastJob.status === "saved";
  } finally {
    setBusy(false);
    if (successful) {
      saveButton.textContent = "Saved";
      // Let the user see the success state, then dismiss the toolbar popup.
      setTimeout(() => window.close(), 650);
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSave();
});
retryButton.addEventListener("click", () => runSave(true));

async function initialize() {
  setBusy(false);
  const [selected, storedDraft, unfinished] = await Promise.all([
    getSelectedTarget(),
    getValue("settings", "draft"),
    getUnfinishedJobs(),
  ]);
  target = selected;
  lastJob = unfinished[0] || null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:\/\//i.test(tab.url))
    activePage = { url: tab.url, title: tab.title || "" };
  const useDraft = storedDraft && storedDraft.url === activePage.url;
  if (useDraft) {
    urlInput.value = storedDraft.url || "";
    descriptionInput.value = storedDraft.description || "";
    activePage = { url: storedDraft.pageUrl, title: storedDraft.title };
  } else {
    urlInput.value = activePage.url || "";
  }
  showTarget();
    if (lastJob && lastJob.status !== "saved") {
      retryButton.hidden = false;
    message(
      lastJob.error ||
        "A previous save needs attention. Retry it to finish safely.",
      true,
    );
    if (!target || target.id === lastJob.targetId) {
      target = await getTarget(lastJob.targetId);
      showTarget();
    }
  }
  ready = true;
  setBusy(false);
}

initialize().catch((error) => {
  message(friendlyError(error), true);
});
