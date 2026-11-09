const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const outDir = path.resolve("dist/worker-bundle");
const deployDir = path.resolve("deploy");
const sourceCommit = process.env.GITHUB_SHA;
if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? "")) throw new Error("GITHUB_SHA is required to pin the Worker bundle.");
if (!fs.existsSync(outDir)) throw new Error("Wrangler dry-run output directory is missing.");
const candidates = fs.readdirSync(outDir).filter(name => name.endsWith(".js") && !name.endsWith(".map"));
if (candidates.length !== 1) throw new Error("Expected exactly one bundled Worker JavaScript entrypoint; found: " + candidates.join(", "));
const source = path.join(outDir, candidates[0]);
const code = fs.readFileSync(source, "utf8");
if (!code.includes("worker_default") && !code.includes("export default")) throw new Error("Bundled Worker entrypoint does not look like a module Worker.");
fs.mkdirSync(deployDir, { recursive: true });
const output = path.join(deployDir, "worker.js");
fs.writeFileSync(output, code);
const manifest = {
  sourceCommit,
  sourceEntrypoint: "src/worker.ts",
  generatedBy: "wrangler deploy --dry-run",
  bundleFile: "worker.js",
  byteLength: Buffer.byteLength(code),
  sha256: crypto.createHash("sha256").update(code).digest("hex")
};
fs.writeFileSync(path.join(deployDir, "worker-build.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Pinned Worker bundle", manifest);
