"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
// ---- Funktionen ----
function readJSONGen(filePath) {
    const full = path.resolve(filePath);
    const data = fs.readFileSync(full, "utf8");
    return JSON.parse(data);
}
function fileExists(filePath) {
    return fs.existsSync(path.resolve(filePath));
}
function writeJSON(filePath, data) {
    fs.writeFileSync(path.resolve(filePath), JSON.stringify(data, null, 2), "utf8");
}
module.exports = {
    readJSONGen,
    fileExists,
    writeJSON,
};
