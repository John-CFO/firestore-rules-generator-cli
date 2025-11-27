// src/commands/generate.ts

// --- Typdefinitionen ---
type GenerateOpts = { config: string; mapping: string; out: string };

type SchemaField = {
  type?: string;
  required?: boolean;
  ref?: string;
  fields?: Record<string, SchemaField>;
  enum?: string[];
};

type SchemaDef = { fields?: Record<string, SchemaField> };
type SchemaMapping = Record<string, SchemaDef>;

// --- Imports ---
const fsPromises = require("fs/promises");
const { readJSONGen } = require("../core/fileUtils");
const { buildRequiredCheck } = require("../core/ruleCompiler");

// --- Flatten Fields rekursiv ---
function flattenFields(
  schemaName: string,
  schemaDef: SchemaDef,
  mapping: SchemaMapping,
  visited: Set<string> = new Set(),
  warnings: string[] = []
): Record<string, SchemaField> {
  if (visited.has(schemaName)) return {};
  visited.add(schemaName);

  const result: Record<string, SchemaField> = {};
  if (!schemaDef.fields) return result;

  for (const [key, rawVal] of Object.entries(schemaDef.fields)) {
    const val = rawVal as SchemaField;

    if (val.required === false) {
      warnings.push(
        `⚠ Optional field "${key}" in schema "${schemaName}" will NOT be strictly enforced.`
      );
    }

    if ((val.type === "object" || val.type === "array") && val.ref) {
      const nestedDef = mapping[val.ref];
      result[key] = {
        type: val.type,
        required: val.required !== false,
        fields: nestedDef
          ? flattenFields(val.ref, nestedDef, mapping, visited, warnings)
          : {},
        enum: val.enum,
        ref: val.ref,
      };
    } else {
      result[key] = { ...val, required: val.required !== false };
    }
  }

  return result;
}

// --- Generator-Funktion ---
async function generateCommand(options: GenerateOpts) {
  const cfg = readJSONGen(options.config);
  const mapping = readJSONGen(options.mapping);

  if (!cfg || !Array.isArray(cfg.collections) || cfg.collections.length === 0) {
    throw new Error("Keine Collections in config gefunden oder Datei leer.");
  }

  const lines: string[] = [];
  lines.push(`rules_version = '2';`);
  lines.push(`service cloud.firestore {`);
  lines.push(`  match /databases/{database}/documents {`);
  lines.push(`    function isSignedIn() { return request.auth != null; }`);

  const generatedFunctions = new Set<string>();

  function createNestedValidators(
    prefixFunc: string,
    metaFields: Record<string, SchemaField>,
    basePad: string,
    validators: string[] = []
  ): string[] {
    for (const [field, meta] of Object.entries(metaFields)) {
      if (meta.fields && Object.keys(meta.fields).length) {
        const nestedFunc = `${prefixFunc}_${field}`;
        if (!generatedFunctions.has(nestedFunc)) {
          const nestedChecks = buildRequiredCheck(
            nestedFunc,
            meta.fields,
            "userId"
          );
          for (const l of nestedChecks) lines.push(basePad + "  " + l);
          generatedFunctions.add(nestedFunc);
        }
        validators.push(`${nestedFunc}_hasOnlyTopLevel()`);
        validators.push(`${nestedFunc}()`);
        createNestedValidators(nestedFunc, meta.fields, basePad, validators);
      }
    }
    return validators;
  }
  function processCollection(col: any, indent = 4) {
    const pad = " ".repeat(indent);
    lines.push(`${pad}match /${col.path} {`);

    if (col.ownerField) {
      lines.push(
        `${pad}  allow read: if isSignedIn() && resource.data.${col.ownerField} == request.auth.uid;`
      );
    } else {
      lines.push(`${pad}  allow read: if isSignedIn();`);
    }

    let allValidators: string[] = [];

    if (col.schema && mapping[col.schema]) {
      const warnings: string[] = [];
      const flatFields = flattenFields(
        col.schema,
        mapping[col.schema],
        mapping,
        new Set(),
        warnings
      );

      const funcName = `hasRequired_${col.schema}`;
      if (!generatedFunctions.has(funcName)) {
        const checks = buildRequiredCheck(funcName, flatFields, col.ownerField);
        for (const line of checks) lines.push(pad + "  " + line);
        generatedFunctions.add(funcName);
      }

      allValidators.push(`${funcName}_hasOnlyTopLevel()`, `${funcName}()`);
      allValidators.push(...createNestedValidators(funcName, flatFields, pad));

      for (const w of warnings) console.warn(`${pad}${w}`);
    }

    const validatorsExpr = allValidators.length
      ? allValidators.join(" && ")
      : "true";

    if (col.ownerField) {
      lines.push(
        `${pad}  allow create: if isSignedIn() && request.resource.data.${col.ownerField} == request.auth.uid && ${validatorsExpr};`
      );
      lines.push(
        `${pad}  allow update: if isSignedIn() && resource.data.${col.ownerField} == request.auth.uid && request.resource.data.${col.ownerField} == request.auth.uid && ${validatorsExpr};`
      );
    } else {
      lines.push(`${pad}  allow create: if isSignedIn() && ${validatorsExpr};`);
      lines.push(`${pad}  allow update: if isSignedIn() && ${validatorsExpr};`);
    }

    if (Array.isArray(col.subcollections)) {
      for (const sub of col.subcollections) {
        if (!sub.ownerField && col.ownerField) sub.ownerField = col.ownerField;
        processCollection(sub, indent + 2);
      }
    }

    lines.push(`${pad}}`);
  }

  for (const col of cfg.collections) {
    processCollection(col);
  }

  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");

  const output = lines.join("\n");
  if (options.out) {
    await fsPromises.writeFile(options.out, output, "utf-8");
    console.log(`✅ Rules file generated: ${options.out}`);
  }

  return output;
}

// --- CommonJS Export ---
module.exports = { generateCommand };
