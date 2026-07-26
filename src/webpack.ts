// @ts-nocheck
// ---------------------------------------------------------------------------
// Webpack 5 plugin.
//
//   const { JSCVMWebpackPlugin } = require("jscvm/webpack");
//   plugins: [ new JSCVMWebpackPlugin({ test: /\.js$/, minify: true }) ]
//
// Runs each matching emitted asset through the jscvm obfuscator, replacing it
// with the bytecode-VM bundle. It hooks the very last processAssets stage so it
// sees the final, bundled output.
//
// Performance: assets are processed in parallel; results are cached by content
// hash so unchanged assets are never recompiled across watch rebuilds; assets
// larger than `maxBytes` are skipped; and `minify: false` skips the expensive
// obfuscator pass. Any asset the VM cannot compile is left untouched with a
// build warning, so an unsupported construct never breaks the build.
//
// Other bundlers: there is no magic here — call `require("jscvm").obfuscate(code)`
// from a Rollup `renderChunk`, esbuild plugin, or Vite `generateBundle` hook to
// get the same behaviour.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { compileToBundles } from "./index";

export interface JSCVMWebpackPluginOptions {
    /** Only process asset names matching this. Default /\.js$/i. */
    test?: RegExp;
    /** Additional allow filter applied on top of `test`. */
    include?: RegExp;
    /** Skip asset names matching this. */
    exclude?: RegExp;
    /** Apply the Terser + javascript-obfuscator pass. Default true. */
    minify?: boolean;
    /** Skip assets larger than this many bytes (avoids pathological build times). Default 512 KiB. */
    maxBytes?: number;
    /** Cache results by content hash across rebuilds. Default true. */
    cache?: boolean;
}

const DEFAULTS: Required<Omit<JSCVMWebpackPluginOptions, "include" | "exclude">> = {
    test: /\.js$/i,
    minify: true,
    maxBytes: 512 * 1024,
    cache: true
};

const PLUGIN_NAME = "JSCVMWebpackPlugin";

export class JSCVMWebpackPlugin {
    private readonly options: JSCVMWebpackPluginOptions;
    private readonly resultCache = new Map<string, string>();

    constructor(options: JSCVMWebpackPluginOptions = {}) {
        this.options = { ...DEFAULTS, ...options };
    }

    apply(compiler: any): void {
        const webpack = compiler.webpack;
        if (!webpack || !webpack.Compilation) {
            throw new Error(`${PLUGIN_NAME} requires webpack 5.`);
        }
        const { Compilation, sources, WebpackError } = webpack;

        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation: any) => {
            compilation.hooks.processAssets.tapPromise(
                { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER },
                async (assets: Record<string, any>) => {
                    const names = Object.keys(assets).filter(name => this.shouldProcess(name));
                    await Promise.all(names.map(name => this.processAsset(compilation, sources, WebpackError, name)));
                }
            );
        });
    }

    private async processAsset(compilation: any, sources: any, WebpackError: any, name: string): Promise<void> {
        const asset = compilation.getAsset(name);
        if (!asset) return;

        const input = asset.source.source().toString();
        if (input.length > (this.options.maxBytes as number)) return;

        const cacheKey = this.options.cache ? createHash("sha1").update(input).digest("hex") : null;
        if (cacheKey && this.resultCache.has(cacheKey)) {
            compilation.updateAsset(name, new sources.RawSource(this.resultCache.get(cacheKey)));
            return;
        }

        try {
            const { bundle, minified } = await compileToBundles(input, this.options.minify !== false);
            const output = minified !== undefined ? minified : bundle;
            if (cacheKey) this.resultCache.set(cacheKey, output);
            compilation.updateAsset(name, new sources.RawSource(output));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            compilation.warnings.push(new WebpackError(`${PLUGIN_NAME}: skipped ${name} (${message})`));
        }
    }

    private shouldProcess(name: string): boolean {
        const base = name.split("?")[0];
        if (this.options.test && !this.options.test.test(base)) return false;
        if (this.options.include && !this.options.include.test(base)) return false;
        if (this.options.exclude && this.options.exclude.test(base)) return false;
        return true;
    }
}

export default JSCVMWebpackPlugin;
