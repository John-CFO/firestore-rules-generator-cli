//src/core/fileUtils.ts
const fs = require("fs");
const path = require("path");

export type JSONValue = any;

function readJSONGen(filePath: string): JSONValue {
  const full = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

const readJSON = readJSONGen;

function fileExists(filePath: string): boolean {
  return fs.existsSync(path.resolve(filePath));
}

function writeJSON(filePath: string, data: JSONValue): void {
  fs.writeFileSync(
    path.resolve(filePath),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

module.exports = { readJSONGen, readJSON, fileExists, writeJSON };
