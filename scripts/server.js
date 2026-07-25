#!/usr/bin/env node
"use strict";

// Minimal obfuscator web UI. Serves a single page with a CodeMirror editor for
// input on the left, output on the right, and a square blue "Obfuscate" button.
// POST /obfuscate { code } -> { ok, code } | { ok:false, error }.

const http = require("http");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const distIndex = path.join(projectRoot, "dist", "index.js");

if (!fs.existsSync(distIndex)) {
    console.error("dist/index.js not found. Build first:\n  npm run build");
    process.exit(1);
}

const { compileToBundles } = require(distIndex);
const PORT = Number(process.env.PORT) || 3000;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obfuscator</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111; background: #fff; display: flex; flex-direction: column;
  }
  header {
    height: 52px; flex: 0 0 52px; display: flex; align-items: center; gap: 14px;
    padding: 0 16px; border-bottom: 1px solid #e6e6e6;
  }
  header .title { font-size: 14px; font-weight: 600; letter-spacing: .01em; }
  button#run {
    border: 0; border-radius: 0; background: #2563eb; color: #fff;
    font: inherit; font-size: 14px; padding: 9px 22px; cursor: pointer;
  }
  button#run:hover { background: #1e51c9; }
  button#run:disabled { background: #9db8f0; cursor: default; }
  main { flex: 1 1 auto; display: flex; min-height: 0; }
  .pane { flex: 1 1 50%; display: flex; flex-direction: column; min-width: 0; }
  .pane + .pane { border-left: 1px solid #e6e6e6; }
  .pane .label {
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #888;
    padding: 8px 12px; border-bottom: 1px solid #f0f0f0;
  }
  .editor-wrap { flex: 1 1 auto; min-height: 0; position: relative; }
  .CodeMirror {
    height: 100%; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 13px;
    background: #fff; color: #111;
  }
  .CodeMirror-gutters { background: #fff; border-right: 1px solid #f0f0f0; }
</style>
</head>
<body>
  <header>
    <span class="title">Obfuscator</span>
    <button id="run">Obfuscate</button>
  </header>
  <main>
    <section class="pane">
      <div class="label">Input</div>
      <div class="editor-wrap"><textarea id="in"></textarea></div>
    </section>
    <section class="pane">
      <div class="label">Output</div>
      <div class="editor-wrap"><textarea id="out"></textarea></div>
    </section>
  </main>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
  <script>
    var input = CodeMirror.fromTextArea(document.getElementById("in"), {
      mode: "javascript", lineNumbers: true, lineWrapping: false
    });
    var output = CodeMirror.fromTextArea(document.getElementById("out"), {
      mode: "javascript", lineNumbers: true, lineWrapping: true, readOnly: true
    });
    input.setValue("function f() {\\n    return \\"hello\\" + \\" \\" + \\"world\\";\\n}\\nglobalThis.result = f();\\n");

    var btn = document.getElementById("run");
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Obfuscating\\u2026";
      output.setValue("");
      fetch("/obfuscate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input.getValue() })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          output.setValue(data.ok ? data.code : "// Error: " + data.error);
        })
        .catch(function (e) { output.setValue("// Error: " + e.message); })
        .finally(function () { btn.disabled = false; btn.textContent = "Obfuscate"; });
    });
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return;
    }

    if (req.method === "POST" && req.url === "/obfuscate") {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 5_000_000) req.destroy();
        });
        req.on("end", async () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            try {
                const { code } = JSON.parse(body || "{}");
                const { minified, bundle } = await compileToBundles(String(code || ""), true);
                res.end(JSON.stringify({ ok: true, code: minified || bundle }));
            } catch (err) {
                res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
            }
        });
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Obfuscator UI running at http://localhost:${PORT}`);
});
