## Using the JS Bytecode VM to hide WebSocket encode/decode logic

Yes. This toolchain lets you ship your encoding/decoding code as bytecode that only runs through the bundled emulator. The result is **obfuscated logic** that is harder to reverse in the browser while remaining executable in Node.js and the client. It is not a cryptographic guarantee—assume a motivated attacker can still instrument, patch, or step through the emulator—but it meaningfully raises the effort required to lift your protocol logic.

### What you gain (and what you do not)
- Gains: minified + obfuscated emulator, custom bytecode format, no direct source, and the option to keep only a thin JS bridge visible.
- Limits: runtime access is still possible (DevTools, breakpoints, memory snapshots). Do not embed long-lived secrets or keys. Treat this as obfuscation, not DRM.

### High-level workflow
1. Write your encode/decode helpers as plain JS (ES5-friendly) and attach only the callable surface you need (e.g., `globalThis.encodePacket = encodePacket;`).
2. Compile that file into bytecode (`npm run build` then `npm run compile ...`).
3. Serve/require the generated `*.bytecode.js` (or `*.bytecode.min.js`) on both browser and Node endpoints.
4. Use the exported helpers to transform typed-array payloads before writing to the WebSocket, and to parse received buffers.

### Example codec source (input/codec.js)
```js
"use strict";

// Simple binary protocol: [u8 opcode][f32 x][f32 y]
function encodePacket(opcode, x, y) {
    var buf = new ArrayBuffer(9);
    var view = new DataView(buf);
    view.setUint8(0, opcode);
    view.setFloat32(1, x, true);
    view.setFloat32(5, y, true);
    return new Uint8Array(buf);
}

function decodePacket(bytes) {
    var view = bytes instanceof DataView ? bytes : new DataView(bytes.buffer || bytes);
    return {
        opcode: view.getUint8(0),
        x: view.getFloat32(1, true),
        y: view.getFloat32(5, true)
    };
}

// Expose only the API you need; the implementations run inside the VM.
globalThis.encodePacket = encodePacket;
globalThis.decodePacket = decodePacket;
```

### Build and compile
1. Install deps: `npm install`
2. Build the toolchain and emulator template: `npm run build`
3. Compile your codec file:  
   - `npm run compile -- --input input/codec.js --out ./out`
   - Outputs `out/codec.bytecode.js` and `out/codec.bytecode.min.js` (minified + obfuscated). Use the `.min` file for shipping.

### Using it in the browser
- Include the generated bundle before your game code (script tag or bundler import). The emulator bootstraps immediately and registers any globals defined in your source (e.g., `encodePacket`/`decodePacket`).
- Sending:
  ```js
  const ws = new WebSocket("wss://game.example/ws");
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(encodePacket(1, player.x, player.y));
  ```
- Receiving:
  ```js
  ws.onmessage = (evt) => {
      const bytes = new Uint8Array(evt.data);
      const { opcode, x, y } = decodePacket(bytes);
      handleMessage(opcode, x, y);
  };
  ```
- Only the thin calls to `encodePacket`/`decodePacket` are visible; the logic lives in bytecode executed by the emulator in the bundle.

### Using it in Node (authoritative server)
- Require the same bundle so you exercise identical encoding/decoding across client and server:
  ```js
  require("./out/codec.bytecode.js");
  const net = require("net");

  const socket = /* ws or tcp */;
  socket.on("message", (data) => {
      const decoded = global.decodePacket(new Uint8Array(data));
      // ...update state, broadcast...
  });

  function broadcast(state) {
      const payload = global.encodePacket(2, state.x, state.y);
      socket.send(payload);
  }
  ```
- For ESM, use `import "./out/codec.bytecode.js";` and read from `globalThis`.

### Hardening tips
- Keep the public surface narrow. Expose only the functions you need to call from outside the VM.
- Stick to the minified build (`*.min.js`) for distribution; it applies Terser + JavaScript Obfuscator on top of the bytecode.
- Avoid embedding static keys or salts. If you need integrity/confidentiality, layer cryptography on top of this obfuscation.
- Consider runtime checks (e.g., simple tamper flags) inside your codec to detect obvious patching, but avoid breaking legitimate clients.
- The emulator now exposes the bytecode's return value as `vm` (`globalThis.vm`, `module.exports`, and the global `bytecodeVm` var emitted by Rollup). Structure your source so the entrypoint returns the callable you want to invoke (e.g., an XOR handshake helper) and then bind it with `let mathFunction = bytecodeVm;`.

### Sample handshake call surface
If you model your source after `input/in.js`, the compiled bundle returns a function that performs a rolling XOR handshake:
```js
import "./out/in.bytecode.js"; // or require(...)
const mathFunction = globalThis.bytecodeVm; // same as globalThis.vm or the default export
const packet = mathFunction(clientNonce, serverNonce, "optional-salt");
// -> Uint8Array ready to send over your socket
```

### Testing the bundle
- Run `npm run compile -- --input input/codec.js --out ./out` and then execute the bundle locally:
  - Browser: open a test page that includes `./out/codec.bytecode.js` and call `encodePacket`/`decodePacket`.
  - Node: `node -e "require('./out/codec.bytecode.js'); console.log(decodePacket(encodePacket(1, 10, 20)));"`.
- Verify payload compatibility between client and server before deploying.

### Recap
- You can ship your WebSocket codec as VM bytecode to obscure its internals.
- The approach raises the reverse-engineering bar but is not a substitute for server-side validation or cryptography.
- Ship the minified bundle, expose the smallest possible API, and reuse the same compiled codec on both ends to keep protocol behavior consistent.
