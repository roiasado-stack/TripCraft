const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const SRC = "C:/Users/user/.claude/uploads/c60db4a1-081b-4949-9407-75f500764278";
const OUT = "C:/Users/user/אפליקציית טיולים/docs/assets/screens";
fs.mkdirSync(OUT, { recursive: true });

// [source file, output name, crop-height-fraction from top (1 = full image)]
const jobs = [
  ["de8f1197-image.jpg", "trips-list.jpg", 1],
  ["7a5075f1-image.jpg", "trip-home.jpg", 1],
  ["33f00279-image.jpg", "itinerary.jpg", 1],
  ["06633466-image.jpg", "recommendations.jpg", 1],
  ["16816fe5-image.jpg", "documents.jpg", 1],
  ["69d419a7-image.jpg", "ask-agent.jpg", 1],
  ["983a114a-image.jpg", "checklist.jpg", 1],
];

(async () => {
  for (const [srcName, outName, frac] of jobs) {
    const srcPath = path.join(SRC, srcName);
    const img = sharp(srcPath);
    const meta = await img.metadata();
    console.log(outName, "source:", meta.width, "x", meta.height);
    // Target a real phone ratio (~9:19.5). Crop from the top so headers/hero
    // content stay in frame instead of the tail end of a full-page scroll.
    const targetRatio = 9 / 19.5;
    const cropH = Math.min(meta.height, Math.round(meta.width / targetRatio));
    await sharp(srcPath)
      .extract({ left: 0, top: 0, width: meta.width, height: cropH })
      .resize({ width: 640 })
      .jpeg({ quality: 88 })
      .toFile(path.join(OUT, outName));
    console.log("  -> cropped to", meta.width, "x", cropH, "saved", outName);
  }
})().catch((e) => { console.error(e); process.exit(1); });
