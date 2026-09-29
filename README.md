# Turbopack dev: a bundled `node_modules` package that ships its own source maps loses `ignoreList`

In `next dev` (Turbopack), a `node_modules` package that ships its own `.js.map` files is bundled into server chunks whose source-map sections carry **no `ignoreList`**. That happens even though their `sources` resolve into `node_modules`. Next's dev stack-frame filter therefore treats the package's frames as user code. React Flight's dev debug info then serialises a value the package awaited internally, and in doing so it **invokes getters on it**.

This repo reproduces that with a proxy that logs a warning when a property is read.

Reproduced from this repo on `next@16.3.5` and `16.4.0-canary.52` (react 19.3.0); also on `16.3.7` in an equivalent app with the same package shape.

## Steps

```bash
node make-packages.mjs     # generates ./packages/side-effect-sdk{,-nomap}; run before installing
pnpm install
pnpm dev
```

Request each route a few times, with `curl` or a browser (a browser is not required):

```bash
curl -s http://localhost:3000/ > /dev/null                        # reproduces
curl -s http://localhost:3000/control-no-sourcemap > /dev/null   # control, does not reproduce
```

Then watch the `next dev` terminal.

## What is in it

`make-packages.mjs` writes two local packages with **identical code**:

- `side-effect-sdk` ships tsc-style `.js.map` files whose `sources` point at `../src/*.ts`. The `src/` files are not shipped, as is common on npm.
- `side-effect-sdk-nomap` ships no source maps. It is the control.

Both are padded with ~40 generated modules (~2 MB), so Turbopack gives them server chunks of their own. Those chunk file names replace the `node_modules/.pnpm/…` prefix with a short hash, so they no longer contain `node_modules`.

The method the page awaits never reads `user`:

```js
async getSession() {                       // `user` is a Proxy that console.warn()s on its first read
  return { data: { session: { user: warnOnRead({ id: "u1", role: "demo" }) } } };
}
async getGreeting() {
  const { data } = await new Promise((resolve) => setTimeout(() => resolve(this.getSession()), 5));
  return data.session ? "hello from side-effect-sdk (40)" : "no session";
}
```

`app/page.js` renders `await createClient().getGreeting()` from `side-effect-sdk`. `app/control-no-sourcemap/page.js` does the same from `side-effect-sdk-nomap`.

## Actual behaviour (`next dev`)

Every request to `/` prints:

```
[side-effect-sdk] SIDE-EFFECT GETTER FIRED: property "toJSON" was read on the returned user object
Error: side-effect-sdk getter stack
    at Object.get (.next/dev/server/chunks/ssr/<hash>_side-effect-sdk_dist_module_lib_helpers_<hash>.js:18:5)
    at stringify (<anonymous>)
    at emitOutlinedDebugModelChunk (node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js:88:121716)
    at node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js:88:64370
```

The last frame is the `.then` callback inside React Flight's `serializeDebugThenable` (16.3.5). In a browser, the warning is also replayed into the console with the `Server` badge.

The package's dev server chunk has sections like:

```
side-effect-sdk        sources=[".../node_modules/.pnpm/side-effect-sdk@.../node_modules/side-effect-sdk/src/client.ts"]        ignoreList=undefined
side-effect-sdk-nomap  sources=[".../node_modules/.pnpm/side-effect-sdk-nomap@.../dist/module/client.js"]  ignoreList=[0]
```

Observed on 16.3.5:

| | `/` (with source maps) | `/control-no-sourcemap` |
|---|---|---|
| `next dev` | **3/3 requests warn** | 0/3 |
| `next dev` + `serverExternalPackages: ["side-effect-sdk", "side-effect-sdk-nomap"]` | 0/3 | 0/3 |
| `next build` + `next start` | 0/3 | 0/3 |

To try the workaround, run `REPRO_EXTERNAL=1 pnpm dev`. `next.config.mjs` then sets `serverExternalPackages`.

## Expected behaviour

A `node_modules` package's frames should be ignore-listed in dev whether or not the package ships its own source maps. `/` should then behave like `/control-no-sourcemap`, and React should not invoke getters on a value the package awaited internally.

## Notes

- It needed all three of these conditions:
  - the package ships its own source maps;
  - its chunk's file name has lost `node_modules`;
  - the promise holding the value is created inside an I/O callback.
- A small package that shares a `node_modules__pnpm_*` chunk did not reproduce. Neither did awaiting the timer inside the package.
- Webpack (`next dev --webpack`) was not tried. Tested on Windows only.
