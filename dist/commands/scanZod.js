"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/commands/scanZod.ts
const { writeJSON } = require("../core/fileUtils");
const { extractSchemas } = require("../core/zodParser");
function scanZodCommand(opts) {
    const schemas = extractSchemas(opts.pattern);
    const mapping = schemas.reduce((acc, s) => {
        acc[s.name] = { fields: s.fields, raw: s.raw };
        return acc;
    }, {});
    writeJSON(opts.out, mapping);
    console.log(`Wrote mapping to ${opts.out}`);
}
module.exports = { scanZodCommand };
