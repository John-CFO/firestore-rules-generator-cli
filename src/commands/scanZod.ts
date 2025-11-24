// src/commands/scanZod.ts
const { writeJSON } = require("../core/fileUtils");
const { extractSchemas } = require("../core/zodParser");

export interface ScanOpts {
  pattern: string;
  out: string;
}

function scanZodCommand(opts: ScanOpts) {
  const schemas = extractSchemas(opts.pattern);
  const mapping = schemas.reduce((acc: any, s: any) => {
    acc[s.name] = { fields: s.fields, raw: s.raw };
    return acc;
  }, {});

  writeJSON(opts.out, mapping);
  console.log(`Wrote mapping to ${opts.out}`);
}

module.exports = { scanZodCommand };
