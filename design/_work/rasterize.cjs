const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const svg = fs.readFileSync(path.join(__dirname, "TripCraft_vector_brand", "TripCraft_app_icon_SIMPLIFIED.svg"));

const jobs = [
  { size: 180, out: "apple-touch-icon.png" },
  { size: 192, out: "icon-192.png" },
  { size: 512, out: "icon-512.png" },
];

(async () => {
  for (const { size, out } of jobs) {
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(__dirname, out));
    console.log(`wrote ${out} (${size}x${size})`);
  }
})();
