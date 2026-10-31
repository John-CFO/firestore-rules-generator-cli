// src/commands/generate.ts

// --- Typdefinitionen ---
type GenerateOpts = { config: string; mapping: string; out: string };

type SchemaField = {
  type?: string;
  required?: boolean;
  ref?: string;
  fields?: Record<string, SchemaField>;
  enum?: string[];
  min?: number;
  max?: number;
  regex?: string;
  inList?: string[];
  hasComplexCheck?: boolean;
  complexCheckWarning?: string;
};

type SchemaDef = {
  fields?: Record<string, SchemaField>;
  createMode?: "strict" | "partial" | "replace" | "none";
  updateMode?: "strict" | "partial" | "replace" | "none";
};
type SchemaMapping = Record<string, SchemaDef>;

// --- Imports ---
const fsPromises = require("fs/promises");
const { readJSONGen } = require("../core/fileUtils");
const { buildRequiredCheck } = require("../core/ruleCompiler");
const chalk = require("chalk");
const figures = require("figures");

// --- Flatten Fields rekursiv ---
function flattenFields(
  schemaName: string,
  schemaDef: SchemaDef,
  mapping: SchemaMapping,
  visited: Set<string> = new Set(),
  warnings: string[] = [],
): Record<string, SchemaField> {
  if (visited.has(schemaName)) return {};
  visited.add(schemaName);

  const result: Record<string, SchemaField> = {};
  if (!schemaDef.fields) return result;

  for (const [key, rawVal] of Object.entries(schemaDef.fields)) {
    const val = rawVal as SchemaField;

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

// --- Generator-Function ---
async function generateCommand(options: GenerateOpts) {
  console.log(
    chalk.blue(`${figures.info} Starting Firestore rules generation...`),
  );
  const cfg = readJSONGen(options.config);
  const mapping = readJSONGen(options.mapping);

  if (!cfg || !Array.isArray(cfg.collections) || cfg.collections.length === 0) {
    throw new Error("No collections defined in config or invalid format.");
  }

  // Check for manual implementations needed
  const allManualChecks: Array<{
    schema: string;
    field: string;
    warning: string;
  }> = [];

  for (const [schemaName, schemaDef] of Object.entries(mapping)) {
    const def = schemaDef as SchemaDef & {
      requiresManual?: Record<string, any>;
    };
    if (def.requiresManual && Object.keys(def.requiresManual).length > 0) {
      console.log(
        chalk.yellow(
          `${figures.warning} Schema '${schemaName}' has fields requiring manual implementation:`,
        ),
      );

      for (const [fieldPath, field] of Object.entries(
        def.requiresManual || {},
      )) {
        const warning =
          (field as any).complexCheckWarning || "Complex validation detected";
        allManualChecks.push({
          schema: schemaName,
          field: fieldPath,
          warning: warning,
        });
        console.log(chalk.yellow(`  - ${fieldPath}: ${warning}`));
      }
    }
  }

  // Generate rules
  const lines: string[] = [];
  lines.push(`rules_version = '2';`);
  lines.push(`service cloud.firestore {`);
  lines.push(`  match /databases/{database}/documents {`);
  lines.push(``);
  lines.push(`    function isSignedIn() {`);
  lines.push(`      return request.auth != null;`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    function isOwner(userId) {`);
  lines.push(
    `      return request.auth != null && request.auth.uid == userId;`,
  );
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    // Deny-all catch-all for sensitive sub-trees.`);
  lines.push(`    match /security/{document=**} {`);
  lines.push(`      allow read, write: if false;`);
  lines.push(`    }`);
  lines.push(``);

  const generatedFunctions = new Set<string>();

  // render manual blocks
  function renderManualBlock(
    schemaName: string,
    schemaDef: any,
    fields: Record<string, SchemaField>,
    ownerVar: string | undefined,
    pad: string,
  ): string[] {
    const out: string[] = [];
    const manual = schemaDef.requiresManual || {};
    const isStrict = schemaDef.strict === true;
    const manualKeys = Object.keys(manual);

    if (!isStrict && manualKeys.length === 0) return out;

    const ownerArg = ownerVar || "userId";
    const fieldNames = Object.keys(fields);

    out.push(
      `${pad}// ------------------------------------------------------------`,
    );
    out.push(`${pad}// WARNING: REQUIRES MANUAL - schema: ${schemaName}`);
    out.push(
      `${pad}// ------------------------------------------------------------`,
    );

    if (isStrict) {
      out.push(
        `${pad}// .strict() detected - define the field whitelist yourself.`,
      );
      out.push(`${pad}// Candidates: ${fieldNames.join(", ")}`);
      out.push(
        `${pad}// (add server-managed fields like uid, createdAt if present)`,
      );
      out.push(`${pad}//`);
    }

    for (const key of manualKeys) {
      const warn =
        (manual[key] as any).complexCheckWarning || "Complex validation";
      out.push(`${pad}// - ${key}: ${warn}`);
    }

    if (isStrict) {
      const quoted = fieldNames.map((f) => `"${f}"`).join(", ");
      out.push(`${pad}//`);
      out.push(`${pad}// Suggested create rule (uncomment and adapt):`);
      out.push(`${pad}// // allow create: if isOwner(${ownerArg})`);
      out.push(
        `${pad}// //   && request.resource.data.keys().hasOnly([${quoted}]);`,
      );
    }

    out.push(
      `${pad}// ------------------------------------------------------------`,
    );
    return out;
  }

  // process collection
  function processCollection(col: any, indent = 4) {
    const pad = " ".repeat(indent);

    const depth = (indent - 4) / 2;
    const schemaLabel = col.schema || "(no schema)";
    console.log(
      chalk.blue(
        `${figures.info} ${"  ".repeat(depth)}${col.path} → ${schemaLabel}`,
      ),
    );

    lines.push(`${pad}match /${col.path} {`);

    let allValidators: string[] = [];

    if (col.schema && mapping[col.schema]) {
      const schemaConfig = mapping[col.schema] as any;

      const warnings: string[] = [];
      const flatFields = flattenFields(
        col.schema,
        schemaConfig,
        mapping,
        new Set(),
        warnings,
      );

      // Warn if the schema has no usable fields — otherwise the generated
      // hasRequired_* function silently returns true (or only checks the owner).
      const fieldCount = Object.keys(flatFields).length;
      if (fieldCount === 0) {
        const msg =
          `Schema '${col.schema}' has no parseable fields. ` +
          `The generated hasRequired_${col.schema}() will not enforce any field validation.`;
        console.warn(chalk.yellow(`${figures.warning} ${msg}`));

        // Also surface it inside the rules file so it's visible in review.
        lines.push(
          `${pad}  // WARNING: schema '${col.schema}' has no parseable fields.`,
        );
        lines.push(
          `${pad}  // hasRequired_${col.schema}() only enforces the owner check.`,
        );
      }

      // Manual-block goes above the allow rules
      const block = renderManualBlock(
        col.schema,
        schemaConfig,
        flatFields,
        col.ownerField,
        pad + "  ",
      );
      for (const l of block) lines.push(l);

      const funcName = `hasRequired_${col.schema}`;
      if (!generatedFunctions.has(funcName)) {
        const checks = buildRequiredCheck(funcName, flatFields, col.ownerField);
        for (const line of checks) lines.push(pad + "  " + line);
        generatedFunctions.add(funcName);
      }

      allValidators.push(`${funcName}()`);
    }

    const validatorsExpr = allValidators.length
      ? allValidators.join(" && ")
      : "true";

    // Allow-config: user can override per collection.
    // Defaults match the Users pattern: read+create+update yes, list+delete no.
    const allow = col.allow || {
      read: true,
      list: false,
      create: true,
      update: true,
      delete: false,
    };

    const ownerVar = col.ownerField;
    const authCheck = ownerVar ? `isOwner(${ownerVar})` : `isSignedIn()`;

    const readExpr = allow.read ? authCheck : "false";
    const listExpr = allow.list ? authCheck : "false";

    const withValidators = (base: string) =>
      allValidators.length ? `${base} && ${validatorsExpr}` : base;

    const createExpr = allow.create ? withValidators(authCheck) : "false";
    const updateExpr = allow.update ? withValidators(authCheck) : "false";
    const deleteExpr = allow.delete ? authCheck : "false";

    lines.push(`${pad}  allow read:   if ${readExpr};`);
    lines.push(`${pad}  allow list:   if ${listExpr};`);
    lines.push(`${pad}  allow create: if ${createExpr};`);
    lines.push(`${pad}  allow update: if ${updateExpr};`);
    lines.push(`${pad}  allow delete: if ${deleteExpr};`);

    if (Array.isArray(col.subcollections)) {
      for (const sub of col.subcollections) {
        const subCol = {
          ...sub,
          ownerField: sub.ownerField || col.ownerField,
        };
        processCollection(subCol, indent + 2);
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

  if (allManualChecks.length > 0) {
    console.log(chalk.yellow(`\n${figures.warning} IMPORTANT REMINDER:`));
    console.log(
      chalk.yellow(
        `The following ${allManualChecks.length} validations require manual Firestore rules:`,
      ),
    );
    console.log(
      chalk.yellow(`You must implement these manually in your security rules.`),
    );

    allManualChecks.forEach((check) => {
      console.log(
        chalk.yellow(`  • ${check.schema}.${check.field}: ${check.warning}`),
      );
    });

    console.log(
      chalk.yellow(
        `\nThese validations are marked as "requiresManual" in .zod-mapping.json`,
      ),
    );
  }

  const output = lines.join("\n");
  if (options.out) {
    await fsPromises.writeFile(options.out, output, "utf-8");
    console.log(
      chalk.green(`${figures.tick} Rules file generated: ${options.out}`),
    );
  }

  return output;
}

// --- CommonJS Export ---
module.exports = { generateCommand };
