"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// // src/commands/validate.ts
const { fileExists, readJSON } = require("../core/fileUtils");
function validateCommand(opts) {
    const configFile = opts.config || "rules.config.json";
    const mappingFile = opts.mapping || ".zod-mapping.json";
    if (!fileExists(configFile)) {
        console.error(`Config file not found: ${configFile}`);
        process.exit(1);
    }
    if (!fileExists(mappingFile)) {
        console.error(`Mapping file not found: ${mappingFile}`);
        process.exit(1);
    }
    const config = readJSON(configFile);
    const mapping = readJSON(mappingFile);
    for (const col of config.collections || []) {
        if (col.schema && !mapping[col.schema]) {
            console.error(`Schema referenced in config does not exist in mapping: ${col.schema}`);
            process.exit(1);
        }
    }
    console.log("Validation passed ✅");
}
module.exports = { validateCommand };
