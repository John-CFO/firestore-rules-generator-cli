//src/core/fileUtils.ts
export {};

const fs = require("fs");
const path = require("path");

// ---- Typen ----
type JSONValue = any; // Falls du hier strenger willst, sag’s.

// ---- Funktionen ----

function readJSONGen(filePath: string): JSONValue {
  const full = path.resolve(filePath);
  const data = fs.readFileSync(full, "utf8");
  return JSON.parse(data);
}

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

module.exports = {
  readJSONGen,
  fileExists,
  writeJSON,
};
