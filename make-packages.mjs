// Generates two local packages under ./packages (run before `pnpm install`):
//   side-effect-sdk        – ships tsc-style `.js.map` files whose `sources` point at ./src/*.ts
//   side-effect-sdk-nomap  – identical code, no source maps
// The package is padded with ~40 generated modules (~2 MB) so Turbopack gives it server
// chunks of its own. Those chunks are then named after the package path with the
// `node_modules/.pnpm/...` prefix replaced by a short hash — i.e. without "node_modules".
// (A small package ends up in a shared `node_modules__pnpm_*` chunk, whose file name
// still contains "node_modules", and does not reproduce.)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const files = {
  "lib/helpers.js": `// Returns a proxy that warns the first time any string-keyed property is read,
// the way some SDKs guard values that should not be used on the server.
export function warnOnRead(target) {
  let warned = false;
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (!warned && typeof prop === "string") {
        warned = true;
        console.warn(
          \`[side-effect-sdk] SIDE-EFFECT GETTER FIRED: property "\${prop}" was read on the returned user object\n\` +
            new Error("side-effect-sdk getter stack").stack,
        );
      }
      return Reflect.get(obj, prop, receiver);
    },
  });
}
`,
  "client.js": `import { warnOnRead } from "./lib/helpers.js";
import * as TABLES from "./lib/tables/index.js";

export class Client {
  // Reads in-memory state only; no I/O of its own.
  async getSession() {
    return { data: { session: { user: warnOnRead({ id: "u1", role: "demo" }) } } };
  }

  // Calls getSession() from inside an I/O callback (a timer), awaits it INSIDE the
  // package, reads only \`data.session\`, and returns a plain string to the caller.
  async getGreeting() {
    const { data } = await new Promise((resolve) => setTimeout(() => resolve(this.getSession()), 5));
    return data.session ? \`hello from side-effect-sdk (\${Object.keys(TABLES).length})\` : "no session";
  }
}
`,
  "index.js": `import { Client } from "./client.js";
export { Client };
export function createClient() {
  return new Client();
}
`,
};
let index = "";
for (let k = 0; k < 40; k++) {
  let s = `export const T${k} = [\n`;
  for (let i = 0; i < 1500; i++) s += `  function f${k}_${i}(a, b) { return (a * ${i} + b) ^ ${i * 7 + k}; },\n`;
  files[`lib/tables/t${k}.js`] = s + "];\n";
  index += `export { T${k} } from "./t${k}.js";\n`;
}
files["lib/tables/index.js"] = index;

// An identity source map (line N -> line N of ../src/<same path>.ts), the shape `tsc
// --sourceMap` emits. The .ts sources are not shipped, as is common on npm.
function identityMap(rel, code) {
  const lines = code.split("\n").length;
  const up = "../".repeat(rel.split("/").length - 1 + 2);
  return JSON.stringify({
    version: 3,
    file: path.posix.basename(rel),
    sourceRoot: "",
    sources: [`${up}src/${rel.replace(/\.js$/, ".ts")}`],
    names: [],
    mappings: ["AAAA"].concat(Array(lines - 1).fill("AACA")).join(";"),
  });
}

for (const [name, withMaps] of [["side-effect-sdk", true], ["side-effect-sdk-nomap", false]]) {
  const root = path.join("packages", name);
  rmSync(root, { recursive: true, force: true });
  const pkg = { name, version: "1.0.0", type: "module", exports: { ".": "./dist/module/index.js" } };
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  for (const [rel, code] of Object.entries(files)) {
    const file = path.join(root, "dist/module", rel);
    mkdirSync(path.dirname(file), { recursive: true });
    const body =
      name === "side-effect-sdk"
        ? code
        : code
            .replaceAll("[side-effect-sdk]", "[side-effect-sdk-nomap]")
            .replaceAll("hello from side-effect-sdk", "hello from side-effect-sdk-nomap");
    if (withMaps) {
      writeFileSync(file, body + `//# sourceMappingURL=${path.posix.basename(rel)}.map\n`);
      writeFileSync(file + ".map", identityMap(rel, body));
    } else {
      writeFileSync(file, body);
    }
  }
  console.log(`wrote ${root} (${withMaps ? "with" : "without"} source maps)`);
}
