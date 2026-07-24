import { compileByteCode, resetScopeState } from "./Parserv2";
import { resetCodegenState } from "./ASTCodegen";
import { parse } from "acorn";
import * as fs from "fs";
import * as path from "path";
import { traverse } from "estraverse";
import { generate } from "escodegen";
import { minify } from "terser";
import { a } from "./InstructionFuncs";
import { Op, OpRemap, _Op, resetOpcodeState } from "./Op";
import { encryptBytecode, hash32 } from "./Utils";
import JavaScriptObfuscator from "javascript-obfuscator";

type CliOptions = {
    inputPath: string;
    outputDir: string;
    baseName: string;
    shouldMinify: boolean;
};

function printUsage(isError = false): void {
    const message = [
        "Usage: node dist/index.js [options] [inputFile] [outputDir]",
        "",
        "Options:",
        "  -i, --input <path>   Path to the JavaScript source to compile.",
        "  -o, --out <dir>      Directory where generated bundles are written.",
        "      --no-minify      Skip the obfuscation + minification step.",
        "  -h, --help           Show this message."
    ].join("\n");

    (isError ? console.error : console.log)(message);
}

function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    let inputArg: string | undefined;
    let outputArg: string | undefined;
    let shouldMinify = true;

    function takeValue(option: string, index: number): string {
        const value = args[index];
        if (!value) {
            console.error(`Expected a value after ${option}.`);
            printUsage(true);
            process.exit(1);
        }
        return value;
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--input":
            case "-i": {
                inputArg = takeValue(arg, ++i);
                break;
            }
            case "--out":
            case "-o": {
                outputArg = takeValue(arg, ++i);
                break;
            }
            case "--no-minify": {
                shouldMinify = false;
                break;
            }
            case "--help":
            case "-h": {
                printUsage();
                process.exit(0);
            }
            default: {
                if (arg.startsWith("-")) {
                    console.error(`Unknown option "${arg}".`);
                    printUsage(true);
                    process.exit(1);
                }
                if (!inputArg) {
                    inputArg = arg;
                } else if (!outputArg) {
                    outputArg = arg;
                } else {
                    console.error(`Too many positional arguments provided: "${arg}".`);
                    printUsage(true);
                    process.exit(1);
                }
                break;
            }
        }
    }

    const resolvedInput = path.resolve(process.cwd(), inputArg ?? path.join("input", "in.js"));
    const resolvedOutput = path.resolve(process.cwd(), outputArg ?? "out");

    if (!fs.existsSync(resolvedInput)) {
        console.error(`Input file not found: ${resolvedInput}`);
        process.exit(1);
    }

    fs.mkdirSync(resolvedOutput, { recursive: true });

    const baseName = path.basename(resolvedInput, path.extname(resolvedInput)) || "output";

    return {
        inputPath: resolvedInput,
        outputDir: resolvedOutput,
        baseName,
        shouldMinify
    };
}

function resolveTemplateFile(): string {
    const candidates = [
        path.join(__dirname, "EmulatorTemplate", "EmulatorTemplate.js"),
        path.join(__dirname, "..", "dist", "EmulatorTemplate", "EmulatorTemplate.js")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error("Unable to locate EmulatorTemplate.js. Run `npm run build` first.");
}

function makeLiteral(val: unknown) {
    return {
        type: "Literal",
        value: val,
        raw: JSON.stringify(val)
    };
}

function makeArray(value: unknown) {
    return parse(JSON.stringify(value), { ecmaVersion: "latest" });
}

// Build the opcode -> handler table. Relies on OpRemap already being populated
// by the compile pass (the Op getters assign shuffled ids as they are accessed
// during codegen), so this must run after compileByteCode().
function buildFuncsArray(): unknown[] {
    const newAr: Array<unknown> = [];
    const descriptors = Object.getOwnPropertyDescriptors(Op);
    for (const key in descriptors) {
        newAr[OpRemap[key]] = a[_Op[key]];
    }
    return newAr;
}

function injectProgram(ast: any, base64: string, scopes: unknown, seedBase: number, funcs: unknown[]) {
    traverse(ast, {
        enter(node: any) {
            if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
                if (node.id.name === "__program") {
                    node.init = makeLiteral(base64) as any;
                } else if (node.id.name === "__scopes") {
                    node.init = makeArray(scopes) as any;
                } else if (node.id.name === "__seedBase") {
                    node.init = makeLiteral(seedBase) as any;
                } else if (node.id.name === "__funcs") {
                    node.init = parse(`[${funcs.toString()}]`, { ecmaVersion: "latest" }) as any;
                }
            }
            if (node.type === "Literal" && (node.value === "The block does not match up" || node.value === " is not a child scope of ")) {
                node.value = "c";
            }
        }
    });
}

async function buildMinifiedBundle(code: string): Promise<string> {
    const result = await minify(code, {
        sourceMap: true,
        mangle: {
            properties: true
        }
    });

    if (!result.code) {
        throw new Error("Terser did not return any code to obfuscate.");
    }

    const options = {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        selfDefending: true,
        renameProperties: true,
        TRenamePropertiesMode: "unsafe",
        TIdentifierNamesGenerator: "mangled-shuffled"
    };

    const obfuscated = JavaScriptObfuscator.obfuscate(result.code, options).getObfuscatedCode();

    const finalMinCode = await minify(obfuscated, {
        sourceMap: true
    });

    if (!finalMinCode.code) {
        throw new Error("Terser did not produce minified output.");
    }

    return finalMinCode.code;
}

// Compile source into the emulator bundle(s). Reused by both the CLI and the
// web server, so it returns strings rather than writing files.
export async function compileToBundles(code: string, shouldMinify: boolean): Promise<{ bundle: string; minified?: string }> {
    // Make compilation reentrant: clear the module-level counters so repeated
    // calls in one process (the web server) each start from a clean slate.
    resetScopeState();
    resetOpcodeState();
    resetCodegenState();

    const { raw, scopes } = compileByteCode(code);

    // Tier 1: per-build position-keyed stream cipher over the whole bytecode
    // buffer. Opcodes, operands and the string table all live inside `raw`, so
    // one cipher covers everything and nothing ships in plaintext.
    const seed = Math.floor(Math.random() * 0x100000000) | 0;
    const enc = encryptBytecode(raw, seed);
    const base64 = Buffer.from(enc).toString("base64");

    // Tier 1: checksum-as-key. Store `seedBase = seed ^ integrity`; the runtime
    // recomputes `integrity` from the payload it ships with and XORs it back to
    // recover `seed`. Tampering with the program blob or the handler-table shape
    // changes `integrity`, so decryption silently produces garbage — there is no
    // branch to patch out. Both sides must derive integrity identically.
    const funcs = buildFuncsArray();
    const integrity = (hash32(base64) ^ Math.imul(funcs.length, 0x01000193)) | 0;
    // Store unsigned so the injected literal is never negative (escodegen rejects
    // negative numeric literals). XOR is bit-pattern preserving, so the runtime's
    // int32 recovery still yields the original seed.
    const seedBase = (seed ^ integrity) >>> 0;

    const templateFile = resolveTemplateFile();
    const template = fs.readFileSync(templateFile, { encoding: "utf-8" });
    const ast = parse(template, { ecmaVersion: "latest" });

    injectProgram(ast, base64, scopes, seedBase, funcs);

    const bundle = generate(ast);
    if (!shouldMinify) {
        return { bundle };
    }

    const minified = await buildMinifiedBundle(bundle);
    return { bundle, minified };
}

async function run(): Promise<void> {
    const { inputPath, outputDir, baseName, shouldMinify } = parseArgs();
    const code = fs.readFileSync(inputPath, { encoding: "utf8" });

    const { bundle, minified } = await compileToBundles(code, shouldMinify);

    const bundlePath = path.join(outputDir, `${baseName}.bytecode.js`);
    fs.writeFileSync(bundlePath, bundle);

    let minifiedPath: string | undefined;
    if (minified !== undefined) {
        minifiedPath = path.join(outputDir, `${baseName}.bytecode.min.js`);
        fs.writeFileSync(minifiedPath, minified);
    }

    console.log(`Converted ${inputPath}`);
    console.log(`Main bundle: ${bundlePath}`);
    if (minifiedPath) {
        console.log(`Minified bundle: ${minifiedPath}`);
    }
}

// Only run the CLI when executed directly; when imported (e.g. by the web
// server) we just expose compileToBundles().
if (require.main === module) {
    run().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
