/**
 * Post-build script: embeds the app icon into the Windows .exe files.
 *
 * electron-builder's signAndEditExecutable is disabled because the
 * winCodeSign archive contains macOS symlinks that fail to extract
 * on Windows without Developer Mode. This script fills the gap by
 * using rcedit directly to embed the icon after the build finishes.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const ICON_PNG = path.join(PROJECT_ROOT, "build", "icon.png");
const PKG = require(path.join(PROJECT_ROOT, "package.json"));
const RELEASE_DIR = path.join(PROJECT_ROOT, "release", PKG.version);

async function run() {
  if (!fs.existsSync(ICON_PNG)) {
    console.log("No build/icon.png found — skipping icon embedding.");
    return;
  }

  const pngToIco = (await import("png-to-ico")).default;
  const { rcedit } = require("rcedit");

  const icoPath = path.join(__dirname, "..", "build", "icon.ico");
  console.log("Converting icon.png -> icon.ico ...");
  const buf = await pngToIco(ICON_PNG);
  fs.writeFileSync(icoPath, buf);

  const targets = [
    path.join(RELEASE_DIR, "win-unpacked", "hledgeditor.exe"),
  ];

  const installerPattern = /hledgeditor Setup.*\.exe$/i;
  if (fs.existsSync(RELEASE_DIR)) {
    for (const name of fs.readdirSync(RELEASE_DIR)) {
      if (installerPattern.test(name)) {
        targets.push(path.join(RELEASE_DIR, name));
      }
    }
  }

  for (const exe of targets) {
    if (!fs.existsSync(exe)) continue;
    console.log(`Embedding icon into ${path.basename(exe)} ...`);
    await rcedit(exe, { icon: icoPath });
  }

  console.log("Done.");
}

run().catch((err) => {
  console.error("Icon embedding failed:", err);
  process.exit(1);
});
