import { getJob, getTarget, updateJob } from "./lib/storage.js";
import { appendLinkToPdf } from "./lib/pdf.js";
import { saveJob, friendlyError } from "./lib/save.js";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.type !== "save-pdf" ||
    typeof message.id !== "string"
  )
    return;
  navigator.locks
    .request("link-saver-pdf-write", async () => {
      const { links = [] } = await chrome.storage.local.get("links");
      const addEntry = (bytes, entry) => appendLinkToPdf(bytes, entry, links);
      return saveJob(message.id, { getJob, getTarget, updateJob, appendLinkToPdf: addEntry });
    })
    .then(reply, (error) => reply({ ok: false, error: friendlyError(error) }));
  return true;
});
