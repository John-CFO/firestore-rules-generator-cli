// src/commands/generate.ts

// --- Typdefinitionen ---
type GenerateOpts = { config: string; mapping: string; out: string };

type SchemaField = {
  type?: string;
  required?: boolean;
  ref?: string;
  fields?: Record<string, SchemaField>;
};

type SchemaDef = { fields?: Record<string, SchemaField> };
type SchemaMapping = Record<string, SchemaDef>;

// --- Imports ---
const fsPromises = require("fs/promises");
const { readJSONGen } = require("../core/fileUtils");
const { buildRequiredCheck } = require("../core/ruleCompiler");

// --- Felder rekursiv auflösen ---
function flattenFields(
  schemaName: string,
  schemaDef: SchemaDef,
  mapping: SchemaMapping,
  visited: Set<string> = new Set(),
  warnings: string[] = []
): Record<string, any> {
  if (visited.has(schemaName)) return {};
  visited.add(schemaName);

  const result: Record<string, any> = {};
  if (!schemaDef.fields) return result;

  for (const [key, valRaw] of Object.entries(schemaDef.fields)) {
    const val = valRaw as SchemaField;

    if (val.required === false) {
      warnings.push(
        `⚠ Optional field "${key}" in schema "${schemaName}" will NOT be enforced in Firestore rules.`
      );
    }

    if (val.type === "object" && val.ref) {
      const nested = mapping[val.ref];
      result[key] = nested
        ? {
            type: "object",
            required: val.required !== false,
            fields: flattenFields(val.ref, nested, mapping, visited, warnings),
          }
        : {
            type: "object",
            required: val.required !== false,
            fields: {},
          };
    } else {
      result[key] = { type: val.type, required: val.required !== false };
    }
  }

  return result;
}

// --- Generator-Funktion ---
async function generateCommand(options: GenerateOpts) {
  const cfg = readJSONGen(options.config);
  const mapping = readJSONGen(options.mapping);

  const lines: string[] = [];
  lines.push(`rules_version = '2';`);
  lines.push(`service cloud.firestore {`);
  lines.push(`  match /databases/{database}/documents {`);
  lines.push(`    function isSignedIn() { return request.auth != null; }`);

  const generatedFunctions = new Set<string>();

  function processCollection(col: any, indent = 4) {
    const pad = " ".repeat(indent);
    lines.push(`${pad}match /${col.path} {`);
    lines.push(`${pad}  allow read: if isSignedIn();`);

    if (col.schema && mapping[col.schema]) {
      const warnings: string[] = [];
      const flatFields = flattenFields(
        col.schema,
        mapping[col.schema],
        mapping,
        new Set(),
        warnings
      );

      // Funktionsname nur nach Schema
      const funcName = `hasRequired_${col.schema}`;

      if (!generatedFunctions.has(funcName)) {
        const checks = buildRequiredCheck(funcName, flatFields);
        for (const line of checks) lines.push(pad + line);
        generatedFunctions.add(funcName);
      }

      for (const warn of warnings) console.warn(`${pad}${warn}`);

      if (col.ownerField) {
        lines.push(
          `${pad}  allow create: if isSignedIn() && request.resource.data.${col.ownerField} == request.auth.uid && ${funcName}();`
        );
        lines.push(
          `${pad}  allow update: if isSignedIn() && request.resource.data.${col.ownerField} == request.auth.uid && ${funcName}();`
        );
      }
    } else if (col.ownerField) {
      lines.push(
        `${pad}  allow create: if isSignedIn() && request.resource.data.${col.ownerField} == request.auth.uid;`
      );
      lines.push(
        `${pad}  allow update: if isSignedIn() && request.resource.data.${col.ownerField} == request.auth.uid;`
      );
    }

    if (Array.isArray(col.subcollections)) {
      for (const subCol of col.subcollections) {
        processCollection(subCol, indent + 2);
      }
    }

    lines.push(`${pad}}`);
  }

  for (const col of cfg.collections || []) {
    processCollection(col);
  }

  lines.push(`  }`);
  lines.push(`}`);

  await fsPromises.writeFile(options.out, lines.join("\n"), "utf8");
  console.log(`Generated ${options.out}`);
}

// --- CommonJS Export ---
module.exports = { generateCommand };
