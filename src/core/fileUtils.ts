//src/core/fileUtils.ts

// imported modules
const fs = require("fs");
const path = require("path");

// typing
export type JSONValue = any;

// --- Functions ---

// read JSON file and return
function readJSONGen(filePath: string): JSONValue {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) {
    throw new Error(`File not found: ${full}`);
  }
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e: any) {
    throw new Error(`Invalid JSON in ${full}: ${e.message}`);
  }
}

// alias
const readJSON = readJSONGen;

// is file exists
function fileExists(filePath: string): boolean {
  return fs.existsSync(path.resolve(filePath));
}

// write JSON file and
function writeJSON(filePath: string, data: JSONValue): void {
  fs.writeFileSync(
    path.resolve(filePath),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

module.exports = { readJSONGen, readJSON, fileExists, writeJSON };
