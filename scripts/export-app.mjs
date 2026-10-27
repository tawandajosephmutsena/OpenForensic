import { spawnSync } from "node:child_process";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const buildOutput = path.join(root, ".next-export");
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const build = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: root,
  env: { ...process.env, OPEN_FORENSIC_STATIC_EXPORT: "1" },
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

await rm(out, { recursive: true, force: true });
await cp(buildOutput, out, { recursive: true });

async function collect(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const files = await collect(out);
if (!files.includes("index.html")) throw new Error("Static export did not produce index.html");
const cacheable = files.filter((file) => file !== "sw.js" && file !== "precache-manifest.js");
const urls = [...new Set(["/", ...cacheable.map((file) => `/${file}`)])];
await writeFile(path.join(out, "precache-manifest.js"), `self.__OPEN_FORENSIC_ASSETS = ${JSON.stringify(urls)};\n`);
const buildHash = createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 12);
const swPath = path.join(out, "sw.js");
const sw = await readFile(swPath, "utf8");
await writeFile(swPath, sw.replace("open-forensic-v1", `open-forensic-${buildHash}`));
console.log(`Static app ready in ${out} (${urls.length} offline shell assets).`);
