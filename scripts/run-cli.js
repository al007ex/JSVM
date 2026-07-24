#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const distIndex = path.join(projectRoot, "dist", "index.js");
const distTemplate = path.join(projectRoot, "dist", "EmulatorTemplate", "EmulatorTemplate.js");

function latestMtime(targetPath) {
    if (!fs.existsSync(targetPath)) {
        return 0;
    }

    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
        return stats.mtimeMs;
    }

    let newest = stats.mtimeMs;
    for (const entry of fs.readdirSync(targetPath)) {
        newest = Math.max(newest, latestMtime(path.join(targetPath, entry)));
    }
    return newest;
}

function needsBuild() {
    if (!fs.existsSync(distIndex) || !fs.existsSync(distTemplate)) {
        return true;
    }

    const distMtime = Math.min(
        fs.statSync(distIndex).mtimeMs,
        fs.statSync(distTemplate).mtimeMs
    );

    const inputs = [
        path.join(projectRoot, "src"),
        path.join(projectRoot, "tsconfig.json"),
        path.join(projectRoot, "tsconfig.EmulatorTemplate.json")
    ].filter(fs.existsSync);

    const newestInput = inputs.length
        ? Math.max(...inputs.map(latestMtime))
        : 0;

    return newestInput >= distMtime;
}

function runCommand(command, args) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        stdio: "inherit"
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

if (needsBuild()) {
    console.log("Building project...");
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    runCommand(npmCommand, ["run", "build"]);
}

const cli = spawnSync(
    process.execPath,
    [distIndex, ...process.argv.slice(2)],
    {
        cwd: projectRoot,
        stdio: "inherit"
    }
);

process.exit(cli.status ?? 1);
