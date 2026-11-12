// src/commands/validate.ts

// imported modules
const { fileExists, readJSON } = require("../core/fileUtils");

// interface
export interface ValidateOpts {
  config?: string;
  mapping?: string;
}

// --- Validate Command Function ---
function validateCommand(opts: ValidateOpts) {
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

  const availableSchemas = Object.keys(mapping);
  let hasErrors = false;

  // Walk the config tree and collect all schema references that do not exist
  // in the mapping. Reports the full path for each failure so the user knows
  // exactly which subcollection is broken.
  function checkCollection(col: any, prefix: string = "") {
    const fullPath = prefix ? `${prefix}/${col.path}` : col.path;

    if (col.schema && !mapping[col.schema]) {
      console.error(
        `Schema referenced in config does not exist in mapping: "${col.schema}" (at ${fullPath})`,
      );
      hasErrors = true;
    }

    if (Array.isArray(col.subcollections)) {
      for (const sub of col.subcollections) {
        checkCollection(sub, fullPath);
      }
    }
  }

  for (const col of config.collections || []) {
    checkCollection(col);
  }

  if (hasErrors) {
    console.error("");
    console.error(`Available schemas in ${mappingFile}:`);
    for (const name of availableSchemas) {
      console.error(`  - ${name}`);
    }
    console.error("");
    console.error(`Fix: edit ${configFile} and replace the "schema" value, or`);
    console.error(
      `     remove the "schema" field if this collection has no @AppSec schema.`,
    );
    process.exit(1);
  }

  // Warn (but do not fail) for collections without a schema. This is valid
  // when the actual validation runs in a Cloud Function — the collection
  // still needs allow rules, but no field checks.
  function warnMissingSchema(col: any, prefix: string = "") {
    const fullPath = prefix ? `${prefix}/${col.path}` : col.path;
    if (!col.schema) {
      console.warn(
        `Warning: collection "${fullPath}" has no schema — only allow rules will be generated. ` +
          `This is fine if validation happens in a Cloud Function.`,
      );
    }
    if (Array.isArray(col.subcollections)) {
      for (const sub of col.subcollections) {
        warnMissingSchema(sub, fullPath);
      }
    }
  }

  for (const col of config.collections || []) {
    warnMissingSchema(col);
  }

  console.log("Validation passed ✅");
}

module.exports = { validateCommand };
