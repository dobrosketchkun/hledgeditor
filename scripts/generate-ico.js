/**
 * Pre-build script: generates icon.ico from icon.png so that
 * electron-builder's NSIS config can reference it for the installer icon.
 */

const fs = require("fs");
const path = require("path");

const ICON_PNG = path.join(__dirname, "..", "build", "icon.png");
const ICON_ICO = path.join(__dirname, "..", "build", "icon.ico");

async function run() {
  if (!fs.existsSync(ICON_PNG)) {
    console.log("No build/icon.png found — skipping ico generation.");
    return;
  }
  if (fs.existsSync(ICON_ICO)) {
    console.log("build/icon.ico already exists — skipping generation.");
    return;
  }
  const pngToIco = (await import("png-to-ico")).default;
  console.log("Converting icon.png -> icon.ico ...");
  const buf = await pngToIco(ICON_PNG);
  fs.writeFileSync(ICON_ICO, buf);
  console.log("Done.");
}

run().catch((err) => {
  console.error("ICO generation failed:", err);
  process.exit(1);
});
