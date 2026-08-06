import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public");
const files = [
  "index.html", "landing.js", "styles.css", "game.html", "game.js",
  "operators.js", "operator-system.js", "quality-pass.js", "frog.js",
  "asset-visuals.js", "lobby-bridge.js", "multiplayer-client.js", "Asset", "ui",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) await cp(resolve(root, file), resolve(output, file), { recursive: true });
console.log(`Cloudflare assets copied to ${output}`);
