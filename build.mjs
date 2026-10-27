// Builds the app into dist/: the Electron main process and preload as
// CommonJS, the page as one script, plus its HTML, CSS and fonts. Nothing is
// minified, so what ships in the app is the source, readable.
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
const common = { bundle: true, minify: false, sourcemap: false, logLevel: "warning", legalComments: "inline" };
await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/preload.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: ["src/renderer/app.ts"], outfile: "dist/renderer/app.js", platform: "browser", format: "iife", target: "chrome130" });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/style.css", "dist/renderer/style.css");
cpSync("build/icon.png", "dist/icon.png"); // the window's own, where the desktop doesn't give it one
mkdirSync("dist/renderer/fonts", { recursive: true });
for (const pkg of ["alegreya", "alegreya-sc"]) {
  const dir = `node_modules/@fontsource/${pkg}/files`;
  for (const f of readdirSync(dir)) {
    if (/-latin(-ext)?-(400|700)-(normal|italic)\.woff2$/.test(f)) cpSync(`${dir}/${f}`, `dist/renderer/fonts/${f}`);
  }
  cpSync(`node_modules/@fontsource/${pkg}/LICENSE`, `dist/renderer/fonts/OFL-${pkg}.txt`); // the fonts' licence travels with them
}
