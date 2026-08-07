import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public");
const files = [
  "index.html", "landing.js", "styles.css", "game.html", "game.js",
  "operators.js", "balance.js", "operator-system.js", "quality-pass.js", "frog.js",
  "asset-visuals.js", "lobby-bridge.js", "multiplayer-client.js", "map-data.js", "ui",
];
const assetFiles = ["logo.png", "processed"];

/* public 폴더 자체는 지우지 않는다.
   윈도우에서는 `wrangler dev` 가 이 폴더를 잡고 있어 rmdir 이 EBUSY 로 실패한다.
   대신 안에 있는 것 중 배포 목록에 없는 것만 지우고, 나머지는 덮어쓴다. */
await mkdir(output, { recursive: true });
const keep = new Set(files);
for (const entry of await readdir(output)) {
  if (keep.has(entry)) continue;
  await rm(resolve(output, entry), { recursive: true, force: true });
}
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file), { recursive: true, force: true });
}
await mkdir(resolve(output, "Asset"), { recursive: true });
for (const file of assetFiles) {
  await cp(resolve(root, "Asset", file), resolve(output, "Asset", file), {
    recursive: true,
    force: true,
  });
}
console.log(`Cloudflare assets copied to ${output}`);
