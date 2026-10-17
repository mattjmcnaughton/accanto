// Package the built, browser-only design prototype as one portable HTML file.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("dist/index.html", root), "utf8");
const scriptPath = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
const stylePath = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)?.[1];
if (!scriptPath || !stylePath) throw new Error("Build the prototype before packaging it.");
const script = await readFile(new URL(`dist/${scriptPath.replace(/^\//, "")}`, root), "utf8");
const styles = await readFile(new URL(`dist/${stylePath.replace(/^\//, "")}`, root), "utf8");
const output = html
  .replace(
    /<script[^>]+src="[^"]+"[^>]*><\/script>/,
    () => `<script type="module">${script.replaceAll("</script", "<\\/script")}</script>`,
  )
  .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/, () => `<style>${styles}</style>`)
  .replace("<title>Accanto</title>", "<title>Accanto — design prototype</title>");
const destination = new URL("../../../../docs/product/daily-workspace-prototype.html", root);
await writeFile(destination, output);
process.stdout.write(`Prototype: ${fileURLToPath(destination)}\n`);
