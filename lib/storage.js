const DATABASE = "link-saver-file-settings";
const VERSION = 2;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of ["settings", "targets", "jobs"]) {
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close other Link Saver panels and try again."));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transaction(stores, mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(tx.error || new Error("Local storage could not finish saving."));
      tx.onerror = () => reject(tx.error);
      action(tx, (result) => {
        value = result;
      });
    });
  } finally {
    db.close();
  }
}

export function getValue(store, key) {
  return transaction([store], "readonly", (tx, done) => {
    tx.objectStore(store).get(key).onsuccess = (event) =>
      done(event.target.result);
  });
}

export function setValue(store, key, value) {
  return transaction([store], "readwrite", (tx) =>
    tx.objectStore(store).put(value, key),
  );
}

export const getJob = (id) => getValue("jobs", id);
export const getTarget = (id) => getValue("targets", id);
export const updateJob = (job) => setValue("jobs", job.id, job);

export async function rememberTarget(handle) {
  const targets = await transaction(["targets"], "readonly", (tx, done) => {
    tx.objectStore("targets").getAll().onsuccess = (event) =>
      done(event.target.result);
  });
  let id;
  for (const target of targets) {
    try {
      if (await handle.isSameEntry(target.handle)) {
        id = target.id;
        break;
      }
    } catch {
      /* A deleted file must not prevent selecting a different file. */
    }
  }
  const target = { id: id || crypto.randomUUID(), name: handle.name, handle };
  await transaction(["targets", "settings"], "readwrite", (tx) => {
    tx.objectStore("targets").put(target, target.id);
    tx.objectStore("settings").put(target.id, "selectedTargetId");
    // Retain compatibility with the existing file-handle database.
    tx.objectStore("settings").put(handle, "pdfFileHandle");
  });
  return target;
}

export async function getSelectedTarget() {
  const id = await getValue("settings", "selectedTargetId");
  if (id) return getTarget(id);
  const legacy = await getValue("settings", "pdfFileHandle");
  return legacy ? rememberTarget(legacy) : null;
}

export async function createJob(targetId, entry) {
  const id = crypto.randomUUID();
  const job = {
    id,
    targetId,
    entry: { ...entry, id },
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await transaction(["jobs", "settings"], "readwrite", (tx) => {
    tx.objectStore("jobs").put(job, id);
    tx.objectStore("settings").put(id, "lastJobId");
  });
  return job;
}

export async function getLastJob() {
  const id = await getValue("settings", "lastJobId");
  return id ? getJob(id) : null;
}

export async function getUnfinishedJobs() {
  return transaction(["jobs"], "readonly", (tx, done) => {
    tx.objectStore("jobs").getAll().onsuccess = (event) => {
      done(event.target.result
        .filter((job) => job && job.status !== "saved")
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))));
    };
  });
}
