/**
 * Post-build script: embeds the app icon into the main .exe file.
 *
 * electron-builder's signAndEditExecutable is disabled because the
 * winCodeSign archive contains macOS symlinks that fail to extract
 * on Windows without Developer Mode. This script fills the gap by
 * using rcedit directly to embed the icon after the build finishes.
 *
 * Note: we intentionally do NOT touch the NSIS installer — rcedit
 * corrupts its CRC integrity check. The installer icon is set via
 * the nsis.installerIcon config in package.json instead.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const ICON_ICO = path.join(PROJECT_ROOT, "build", "icon.ico");
const PKG = require(path.join(PROJECT_ROOT, "package.json"));
const RELEASE_DIR = path.join(PROJECT_ROOT, "release", PKG.version);

async function run() {
  if (!fs.existsSync(ICON_ICO)) {
    console.log("No build/icon.ico found — skipping icon embedding.");
    return;
  }

  const { rcedit } = require("rcedit");

  const exePath = path.join(RELEASE_DIR, "win-unpacked", `${PKG.build.productName}.exe`);
  if (!fs.existsSync(exePath)) {
    console.log(`Executable not found: ${exePath} — skipping.`);
    return;
  }

  console.log(`Embedding icon into ${path.basename(exePath)} ...`);
  await rcedit(exePath, { icon: ICON_ICO });
  console.log("Done.");
}

run().catch((err) => {
  console.error("Icon embedding failed:", err);
  process.exit(1);
});
