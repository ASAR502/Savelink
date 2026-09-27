import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const { version } = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = `link-saver-${version}-${timestamp}`;
const stage = path.join(root, "dist", name);
const extension = path.join(stage, "extension");
const files = [
  "manifest.json", "popup.html", "popup.js", "background.js",
  "lib/storage.js", "lib/save.js", "lib/pdf.js",
  "icons/link-saver-16.png", "icons/link-saver-32.png",
  "icons/link-saver-48.png", "icons/link-saver-128.png",
];

await mkdir(extension, { recursive: true });
for (const file of files) {
  const destination = path.join(extension, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, file), destination);
}
for (const doc of ["README.md", "PRIVACY.md"])
  await cp(path.join(root, doc), path.join(stage, doc));

const manifest = JSON.parse(await readFile(path.join(extension, "manifest.json"), "utf8"));
for (const resource of [
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
]) await readFile(path.join(extension, resource));

const archive = path.join(stage, `${name}.zip`);
await new Promise((resolve, reject) => {
  const child = spawn("/usr/bin/zip", ["-X", "-q", "-r", archive, "."], { cwd: extension, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`zip exited with status ${code}`)));
});
await writeFile(path.join(stage, "PACKAGE-CONTENTS.txt"), `${files.join("\n")}\n`);
console.log(`Release built: ${path.relative(root, archive)}`);
