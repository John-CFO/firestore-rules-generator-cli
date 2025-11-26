"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//src/core/fileUtils.ts
const fs = require("fs");
const path = require("path");
function readJSONGen(filePath) {
    const full = path.resolve(filePath);
    return JSON.parse(fs.readFileSync(full, "utf8"));
}
const readJSON = readJSONGen;
function fileExists(filePath) {
    return fs.existsSync(path.resolve(filePath));
}
function writeJSON(filePath, data) {
    fs.writeFileSync(path.resolve(filePath), JSON.stringify(data, null, 2), "utf8");
}
module.exports = { readJSONGen, readJSON, fileExists, writeJSON };
