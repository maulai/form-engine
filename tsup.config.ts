import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "tsup";

const REACT_ENTRY = "dist/react/index.js";
const USE_CLIENT = '"use client";\n';

export default defineConfig({
  entry: { "core/index": "src/core/index.ts", "react/index": "src/react/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // - peers are never bundled
  external: ["react"],
  // - the React binding uses hooks: mark it as a client module for server-component frameworks.
  //   Only its entry: the shared core chunk stays usable on the server.
  async onSuccess() {
    const code = await readFile(REACT_ENTRY, "utf8");
    if (code.startsWith(USE_CLIENT)) return;
    await writeFile(REACT_ENTRY, USE_CLIENT + code);
    // - the source map gains one empty line (";" in mappings), so stack traces stay exact
    const map = JSON.parse(await readFile(`${REACT_ENTRY}.map`, "utf8")) as { mappings: string };
    map.mappings = `;${map.mappings}`;
    await writeFile(`${REACT_ENTRY}.map`, JSON.stringify(map));
  },
});
