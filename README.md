# jscvm

A JavaScript-to-bytecode **virtualizing obfuscator**. It compiles JS into a custom stack-machine bytecode and ships it inside a minimal emulator (the VM). The original logic never appears as JS — it exists only as encrypted bytecode interpreted at runtime.

## How it works

```
source ─▶ lower (Babel) ─▶ parse (acorn) ─▶ scope analysis ─▶ bytecode
       ─▶ stream-cipher + base64 ─▶ embed in emulator ─▶ Terser + javascript-obfuscator
```

- **Compile** — source is lowered (`let`/`const`, `async`/`await`), parsed, scope-analyzed, and emitted as bytecode for a custom stack VM.
- **Protect (per build)** — opcodes are shuffled; the whole bytecode buffer (including the string table) is encrypted with a position-keyed stream cipher; the cipher seed is *not stored* but rebuilt at runtime from the payload's integrity, so patching the program or the handler table decrypts to garbage (no check to bypass); native `Function.prototype.apply` is captured and the dispatch table frozen.
- **Package** — the emulator + embedded bytecode is minified and run through `javascript-obfuscator`.

## Install / build

```bash
npm install
npm run build
```

## CLI

```bash
npm run compile -- --input path/to/source.js --out ./out
```

`-i, --input <path>` · `-o, --out <dir>` · `--no-minify` (skip the obfuscator pass) · `-h, --help`.
Emits `<name>.bytecode.js` and (unless `--no-minify`) `<name>.bytecode.min.js`.

## Node API

```js
const { obfuscate } = require("jscvm");

const code = await obfuscate(source, { minify: true }); // returns a self-contained bundle
```

The bundle exposes the program's return value on `globalThis.vm` and `module.exports`.
`minify: false` skips the (heavy) obfuscator pass — much faster, bytecode still encrypted.

## Webpack

```js
const { JSCVMWebpackPlugin } = require("jscvm/webpack");

module.exports = {
  plugins: [
    new JSCVMWebpackPlugin({
      test: /\.js$/,     // assets to process
      minify: true,      // obfuscator pass
      maxBytes: 512*1024,// skip larger assets
      cache: true        // content-hash cache across rebuilds
    })
  ]
};
```

Processes final emitted assets in parallel, caches by content hash, skips oversized assets, and **leaves any asset the VM can't compile untouched with a build warning** — an unsupported construct never breaks the build.

**Other bundlers** — call `require("jscvm").obfuscate(code)` from a Rollup `renderChunk`, esbuild plugin, or Vite `generateBundle` hook; same result.

## Supported JavaScript

`var` / `let` / `const` · functions, function expressions, **arrow functions** (lexical `this`/`arguments`), closures, recursion · `if`/`else`, ternary · `for`, `while`, `do…while`, `switch`, `break`/`continue` · `try`/`catch`/`finally` (incl. `return`/`break` through `finally`), `throw` · all arithmetic/bitwise/logical/comparison/unary operators, `++`/`--`, all compound assignments (`+=` … `**=`, `<<=` …) · object/array literals, computed/string/numeric keys, shorthand, methods, getters/setters · member/computed access, calls, methods, `new`, calling call-results · `async`/`await` · `regex`, `typeof`, `delete`, `void`, `in`, `instanceof`, `arguments`.

Unsupported constructs fail loudly at compile time — see the roadmap.

## When to use / not

**Use it for** raising the reverse-engineering cost of small, security-sensitive client-side logic — protocol/codec internals, licence or integrity checks, anti-cheat helpers.

**Do not use it** as encryption or DRM (it's obfuscation — runtime instrumentation still works), to store secrets or keys (recoverable at runtime), on hot paths (bytecode is interpreted, so materially slower than native — obfuscate *boundaries*, not tight loops), or on code that uses unsupported features (it won't compile).

## Performance

- Compile time is dominated by the obfuscator pass; use `minify: false` for dev/large builds.
- The webpack plugin caches by content hash, skips assets over `maxBytes`, and processes assets in parallel.
- Runtime is interpreted — expect a constant-factor slowdown versus native.

## Roadmap

**Language — near term**
- [ ] Template literals
- [ ] Optional chaining `?.`, nullish `??`, logical assignment `??=` / `&&=` / `||=`
- [ ] Spread (calls, arrays, objects)
- [ ] Rest & default parameters
- [ ] `for…of` / `for…in`

**Language — later**
- [ ] Destructuring (declarations, parameters, assignment)
- [ ] Labeled statements + labeled `break`/`continue`
- [ ] Tagged templates · BigInt literals
- [ ] Classes / `extends` / `super`
- [ ] Generators (`yield`), async generators, `for await`
- [ ] ES modules (`import`/`export`)

**Obfuscation hardening**
- [x] Per-build opcode shuffling
- [x] Position-keyed bytecode + string-table encryption
- [x] Checksum-as-key (tamper → garbage, branchless)
- [x] Native-reference capture + frozen dispatch table
- [ ] Superinstructions / handler polymorphism
- [ ] Junk/dead bytecode + opaque predicates
- [ ] Branchless VM-level anti-debug
- [ ] Encoded value domain (stack values transformed)

**Tooling**
- [x] CLI · Node API · Webpack 5 plugin
- [ ] Rollup / esbuild / Vite adapters
- [ ] Worker-thread offloading for large builds

## Security

Obfuscation, not cryptography. A motivated attacker with the runtime can still instrument, trace, or step through the emulator. The per-build measures above raise the effort; they do not make extraction impossible. Do not embed long-lived secrets.

## Layout

`src/` — parser, scope analysis, bytecode codegen, emulator, transpile pass, CLI, webpack plugin · `dist/` — build output · `scripts/` — CLI runner and dev server.
