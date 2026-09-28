const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function friendlyError(error) {
  const messages = {
    AbortError: "Cancelled. Your PDF was left unchanged.",
    NotAllowedError: "Allow access to this PDF, then retry the saved link.",
    SecurityError:
      "Select this PDF again from the side panel to allow file access.",
    NotFoundError:
      "The PDF was moved or deleted. Select it again, or create a new PDF.",
    NotReadableError:
      "Your browser cannot read this PDF. Close it in other apps and try again.",
    NoModificationAllowedError:
      "This PDF is locked or read-only. Close it in other apps or select a writable copy.",
    QuotaExceededError: "Storage is full. Free some disk space, then retry.",
  };
  return (
    messages[error?.name] ||
    error?.message ||
    "The save could not finish. Your link is kept locally for retry."
  );
}

function sameVersion(left, right) {
  return left.size === right.size && left.lastModified === right.lastModified;
}

// Runs in the service worker, so closing the side panel cannot interrupt it.
// The caller serializes jobs with a Web Lock shared by extension contexts.
export async function saveJob(
  id,
  { getJob, getTarget, updateJob, appendLinkToPdf },
) {
  const job = await getJob(id);
  if (!job)
    throw new Error(
      "This saved request is missing. Open the extension and save the link again.",
    );
  if (job.status === "saved")
    return { ok: true, fileName: job.fileName, alreadySaved: true };
  let writable;
  try {
    const target = await getTarget(job.targetId);
    if (!target?.handle) throw new Error("Select the PDF for this link again.");
    if (
      (await target.handle.queryPermission({ mode: "readwrite" })) !== "granted"
    ) {
      throw new DOMException("File access is required.", "NotAllowedError");
    }
    const source = await target.handle.getFile();
    if (source.size > MAX_FILE_BYTES)
      throw new Error(
        "Choose a PDF smaller than 25 MB to keep saves responsive.",
      );
    const bytes = source.size
      ? new Uint8Array(await source.arrayBuffer())
      : null;
    const result = await appendLinkToPdf(bytes, { ...job.entry, id: job.id });
    if (!sameVersion(source, await target.handle.getFile())) {
      throw new Error(
        "The PDF changed in another app. Retry to include its latest content.",
      );
    }
    if (!result.alreadySaved) {
      writable = await target.handle.createWritable();
      await writable.write(result.bytes);
      if (!sameVersion(source, await target.handle.getFile())) {
        throw new Error(
          "The PDF changed while saving. Retry to include its latest content.",
        );
      }
      await writable.close();
      writable = null;
    }
    try {
      await updateJob({
        ...job,
        status: "saved",
        fileName: target.name,
        savedAt: new Date().toISOString(),
        error: null,
      });
      return {
        ok: true,
        fileName: target.name,
        alreadySaved: result.alreadySaved,
      };
    } catch {
      // The PDF already contains the request ID. Retrying this pending job is
      // safe even if Chrome stops between the file commit and local bookkeeping.
      return {
        ok: true,
        fileName: target.name,
        warning:
          "PDF saved. Local history could not update; retrying this request will not add it twice.",
      };
    }
  } catch (error) {
    if (writable) await writable.abort().catch(() => {});
    const message = friendlyError(error);
    await updateJob({ ...job, status: "failed", error: message }).catch(
      () => {},
    );
    throw new Error(message);
  }
}
