const fs = require("fs");
const path = require("path");

const file = "C:/Users/user/אפליקציית טיולים/docs/presentation.html";
const dir = "C:/Users/user/אפליקציית טיולים/docs";
let html = fs.readFileSync(file, "utf8");

html = html.replace(/src="(assets\/screens\/[a-z-]+\.jpg)"/g, (m, rel) => {
  const abs = path.join(dir, rel);
  const b64 = fs.readFileSync(abs).toString("base64");
  console.log(rel, "->", (b64.length / 1024).toFixed(0) + "KB base64");
  return `src="data:image/jpeg;base64,${b64}"`;
});

fs.writeFileSync(file, html);
console.log("done, new size:", (fs.statSync(file).size / 1024).toFixed(0) + "KB");
