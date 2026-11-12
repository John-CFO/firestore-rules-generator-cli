//src/core/zodParser.ts

const { Project, SyntaxKind } = require("ts-morph");

// interface and  types
interface ParsedField {
  type: string;
  required: boolean;
  enum?: string[];
  ref?: string;
  fields?: Record<string, ParsedField>;
  min?: number;
  max?: number;
  regex?: string;
  strict?: boolean;
  nullable?: boolean;
  hasComplexCheck?: boolean;
  complexCheckWarning?: string;
}

type TsMorphNode = any;

interface ParsedSchema {
  name: string;
  fields: Record<string, ParsedField>;
  raw: string;
  strict?: boolean;
  collection?: string;
  sourceFile?: string;
  requiresManual?: Record<string, ParsedField>;
}

// Utility: escape keys for hasOnly
function escapeKey(key: string): string {
  return key.replace(/["\\]/g, "\\$&");
}

// function to collect Zod calls
function collectZodCalls(node: TsMorphNode) {
  const calls: { rawName: string; args: any[]; node: TsMorphNode }[] = [];
  let current = node;

  while (current) {
    const kind = current.getKind?.();
    if (!kind) break;

    if (kind === SyntaxKind.CallExpression) {
      const callExpr = current;
      const expression = callExpr.getExpression();
      const expressionKind = expression.getKind?.();

      if (expressionKind === SyntaxKind.PropertyAccessExpression) {
        // Example: z.string().min(1) -> expression is "z.string().min"
        const name = expression.getName();
        const args = callExpr.getArguments();

        calls.unshift({ rawName: name, args: args, node: callExpr });

        // Go to earlier Expression
        current = expression.getExpression();
      } else if (expressionKind === SyntaxKind.Identifier) {
        // Example: z.object() -> expression is "z"
        const name = expression.getText();
        const args = callExpr.getArguments();

        calls.unshift({ rawName: name, args: args, node: callExpr });
        break;
      } else {
        break;
      }
    } else if (kind === SyntaxKind.PropertyAccessExpression) {
      // Example: .optional without brackets
      const name = current.getName();

      calls.unshift({ rawName: name, args: [], node: current });
      current = current.getExpression();
    } else if (kind === SyntaxKind.Identifier) {
      const name = current.getText();

      calls.unshift({ rawName: name, args: [], node: current });
      break;
    } else {
      break;
    }
  }

  return calls;
}

// function to parse Zod property initializers
function parsePropertyInitializer(expr: TsMorphNode): ParsedField | null {
  if (!expr) return null;

  const exprText = expr.getText();
  const kindName = expr.getKindName();

  // Unwrap arrow functions and function expressions:
  // `() => z.object({...})` and `function () { return z.object({...}); }`
  if (kindName === "ArrowFunction" || kindName === "FunctionExpression") {
    const body = expr.getBody?.();
    if (body) {
      return parsePropertyInitializer(body);
    }
    return null;
  }

  // collect Zod calls in the chain
  const calls = collectZodCalls(expr);
  if (calls.length === 0) {
    // Check for simple identifier (e.g. Referenzes to other schemas)
    if (kindName === "Identifier") {
      const identifier = exprText;

      // General detection of schema references
      // (without specific app references)
      if (identifier.endsWith("Schema") || identifier.match(/^[A-Z]/)) {
        return {
          type: "object",
          required: true,
          ref: identifier,
          hasComplexCheck: true,
          complexCheckWarning: `Reference to external schema: ${identifier}`,
        };
      }
    }

    return null;
  }

  // Case 1: The chain doesn't start with a 'z' -> extern reference
  if (calls[0].rawName !== "z") {
    const refName = calls[0].rawName;

    // General detection without spezific App-references
    const isSchemaReference =
      refName.endsWith("Schema") || refName.match(/^[A-Z]/);

    const field: ParsedField = {
      type: isSchemaReference ? "object" : "unknown",
      required: true,
      ref: refName,
      hasComplexCheck: true,
      complexCheckWarning: isSchemaReference
        ? `Reference to external schema: ${refName}`
        : `External function call: ${refName}`,
    };

    // Process the remaining calls in the chain
    for (let i = 1; i < calls.length; i++) {
      const call = calls[i];
      const methodName = call.rawName;

      if (methodName === "optional" || methodName === "nullable") {
        field.required = false;
      } else if (methodName === "default") {
      } else if (methodName === "strict" || methodName === "partial") {
      } else {
        field.hasComplexCheck = true;
        field.complexCheckWarning = `Unknown method in reference chain: ${methodName}()`;
      }
    }

    return field;
  }

  // Case 2: The chain starts with  'z' -> Zod-Type
  // find the first zod-type in the chain
  const zodTypes = [
    "string",
    "number",
    "boolean",
    "date",
    "object",
    "array",
    "enum",
    "email",
    "url",
    "uuid",
    "cuid",
    "record",
    "map",
    "any",
  ];

  let baseTypeIndex = -1;
  let baseType = "";

  for (let i = 0; i < calls.length; i++) {
    if (zodTypes.includes(calls[i].rawName)) {
      baseTypeIndex = i;
      baseType = calls[i].rawName;
      break;
    }
  }

  if (baseTypeIndex === -1) {
    if (calls[0].rawName === "z") {
      return {
        type: "unknown",
        required: true,
        hasComplexCheck: true,
        complexCheckWarning: "Invalid Zod expression",
      };
    }

    // check Identifier in CallExpression
    const firstCall = calls[0];

    // Check for references to other schemas or functions
    const identifierMatch = firstCall.rawName.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
    if (identifierMatch) {
      const identifier = identifierMatch[0];

      // General detection without spezifix App-references
      if (identifier.endsWith("Schema") || identifier.match(/^[A-Z]/)) {
        return {
          type: "object",
          required: true,
          ref: identifier,
          hasComplexCheck: true,
          complexCheckWarning: `Reference to external schema: ${identifier}`,
        };
      }

      // Check if it looks like a function call (not a Zod method)
      const zodMethods = [
        "min",
        "max",
        "regex",
        "optional",
        "nullable",
        "refine",
        "transform",
        "superRefine",
        "preprocess",
        "default",
        "strict",
        "partial",
        "email",
        "url",
        "uuid",
        "cuid",
        "int",
      ];

      if (!zodMethods.includes(identifier)) {
        return {
          type: "unknown",
          required: true,
          hasComplexCheck: true,
          complexCheckWarning: `Function call detected: ${identifier}() - requires manual implementation`,
        };
      }
    }

    // Fallback for other cases
    return {
      type: "unknown",
      required: true,
      hasComplexCheck: true,
      complexCheckWarning: `Could not parse validation expression starting with: ${firstCall.rawName}`,
    };
  }

  let field: ParsedField;

  const callExpr = calls[baseTypeIndex].node;

  switch (baseType) {
    case "string":
      field = parseZodString();
      break;
    case "number":
      field = parseZodNumber();
      break;
    case "boolean":
      field = parseZodBoolean();
      break;
    case "date":
      field = { type: "timestamp", required: true };
      break;
    case "object":
      field = parseZodObject(callExpr);
      break;
    case "array":
      field = parseZodArray(callExpr);
      break;
    case "enum":
      field = parseZodEnum(callExpr);
      break;
    case "email":
    case "url":
    case "uuid":
    case "cuid":
      field = {
        type: "string",
        required: true,
        hasComplexCheck: true,
        complexCheckWarning: `z.${baseType}() requires manual regex implementation`,
      };
      break;
    case "record":
    case "map":
      field = {
        type: "object",
        required: true,
        hasComplexCheck: true,
        complexCheckWarning: `z.${baseType}() requires manual implementation`,
      };
      break;
    case "any":
      field = parseZodAny();
      break;
    default:
      field = {
        type: "unknown",
        required: true,
        hasComplexCheck: true,
        complexCheckWarning: `Unknown Zod type: ${baseType}`,
      };
  }

  // Method chain
  for (let i = baseTypeIndex + 1; i < calls.length; i++) {
    const call = calls[i];
    const methodName = call.rawName;

    switch (methodName) {
      case "min":
        if (call.args.length > 0) {
          const numValue = Number(call.args[0].getText());
          if (!isNaN(numValue)) field.min = numValue;
        }
        break;
      case "max":
        if (call.args.length > 0) {
          const numValue = Number(call.args[0].getText());
          if (!isNaN(numValue)) field.max = numValue;
        }
        break;
      case "regex":
        if (call.args.length > 0) field.regex = call.args[0].getText();
        break;
      case "optional":
        field.required = false;
        break;
      case "nullable":
        field.nullable = true;
        break;
      case "refine":
      case "transform":
      case "superRefine":
      case "preprocess":
        field.hasComplexCheck = true;
        field.complexCheckWarning = `Complex validation (${methodName}) detected`;

        if (call.args.length > 0) {
          const firstArg = call.args[0];
          if (firstArg.getKindName() === "Identifier") {
            const funcName = firstArg.getText();
            if (!["min", "max", "regex", "email", "url"].includes(funcName)) {
              field.complexCheckWarning = `Complex validation: ${methodName}(${funcName}())`;
            }
          }
        }
        break;

      case "default":
        break;

      case "strict":
        field.strict = true;
        field.hasComplexCheck = true;
        field.complexCheckWarning =
          `Strict schema — whitelist manually. Candidates: ` +
          Object.keys(field.fields || {}).join(", ");
        break;
      case "partial":
        field.hasComplexCheck = true;
        field.complexCheckWarning = "partial() requires manual validation";
        break;

      case "email":
      case "url":
      case "uuid":
      case "cuid":
        if (field.type === "string") {
          field.hasComplexCheck = true;
          field.complexCheckWarning = `z.string().${methodName}() requires manual regex implementation`;
        }
        break;

      case "int":
        if (field.type === "number") {
        }
        break;

      default:
        if (!field.hasComplexCheck) {
          field.hasComplexCheck = true;
          field.complexCheckWarning = `Unhandled Zod method: ${methodName}()`;
        }
    }
  }

  return field;
}

// Helper function to parse Zod object with chained methods
function parseZodObject(callExpr: TsMorphNode): ParsedField {
  const field: ParsedField = { type: "object", required: true, fields: {} };

  // Get object literal argument
  const args = callExpr.getArguments();
  if (args.length > 0 && args[0].getKindName() === "ObjectLiteralExpression") {
    field.fields = parseObjectLiteral(args[0]);
  }

  return field;
}

// Helper function to parse Zod string
function parseZodString(): ParsedField {
  return { type: "string", required: true };
}

// Helper function to parse Zod number
function parseZodNumber(): ParsedField {
  return { type: "number", required: true };
}

// Helper function to parse Zod boolean
function parseZodBoolean(): ParsedField {
  return { type: "boolean", required: true };
}

// Helper function to parse Zod array
function parseZodArray(callExpr: TsMorphNode): ParsedField {
  const field: ParsedField = { type: "array", required: true };

  // Get element type argument
  const args = callExpr.getArguments();
  if (args.length > 0) {
    const elementType = parsePropertyInitializer(args[0]);
    if (elementType && elementType.fields) {
      field.fields = elementType.fields;
      field.hasComplexCheck = true;
      field.complexCheckWarning =
        "Array of objects — validate element-wise manually";
    }
  }

  return field;
}

// Helper function to parse Zod enum
function parseZodEnum(callExpr: TsMorphNode): ParsedField {
  const field: ParsedField = { type: "string", required: true };

  const args = callExpr.getArguments();
  if (args.length > 0 && args[0].getKindName() === "ArrayLiteralExpression") {
    const arrayExpr = args[0];
    const elements = arrayExpr.getElements();
    const enumValues: string[] = [];

    for (const element of elements) {
      const elementText = element.getText();
      const cleanValue = elementText.replace(/^['"`]|['"`]$/g, "");
      enumValues.push(cleanValue);
    }

    field.enum = enumValues;
  }

  return field;
}

// Helper function to parse Zod any
function parseZodAny(): ParsedField {
  return { type: "any", required: true };
}

// function to parse Zod object literal
function parseObjectLiteral(
  objLiteral: TsMorphNode,
): Record<string, ParsedField> {
  const result: Record<string, ParsedField> = {};

  if (!objLiteral || objLiteral.getKindName() !== "ObjectLiteralExpression") {
    return result;
  }

  const props = objLiteral.getProperties?.() || [];

  for (const p of props) {
    const kindName = p.getKindName();

    if (kindName !== "PropertyAssignment") {
      continue;
    }

    let key = "";
    try {
      const nameNode = p.getNameNode();
      if (nameNode) {
        key = nameNode.getText();
        // delete quotation marks if present
        key = key.replace(/^['"`]|['"`]$/g, "");
      }
    } catch (e: any) {
      continue;
    }

    if (!key) {
      continue;
    }

    const init = p.getInitializer?.();
    if (!init) {
      result[key] = {
        type: "unknown",
        required: true,
        hasComplexCheck: true,
        complexCheckWarning: "No validation specified",
      };
      continue;
    }

    const parsed = parsePropertyInitializer(init);
    if (parsed) {
      result[key] = parsed;
    } else {
      result[key] = {
        type: "unknown",
        required: true,
        hasComplexCheck: true,
        complexCheckWarning: `Could not parse validation for field ${key}`,
      };
    }
  }

  return result;
}

// Parse raw Zod string using an in-memory ts-morph file
function parseRawZod(raw: string): {
  fields: Record<string, ParsedField>;
  strict: boolean;
  failed?: boolean;
} {
  try {
    const tmp = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
    });

    // Declare z and i18n as any so the schema parses regardless of imports.
    // Raw is inserted verbatim — no whitespace collapsing, otherwise
    // inline `//` comments would comment out the rest of the schema.
    const sourceCode = `
    declare const z: any;
    declare const i18n: any;
    const __x = ${raw};
    `;

    const src = tmp.createSourceFile("tmp.ts", sourceCode);

    const decl = src.getVariableDeclaration("__x");
    if (!decl) {
      return { fields: {}, strict: false };
    }

    const init = decl.getInitializer();
    if (!init) {
      return { fields: {}, strict: false };
    }

    const result = parsePropertyInitializer(init);

    return {
      fields: result?.fields || {},
      strict: result?.strict === true,
    };
  } catch (error: any) {
    console.error(
      `\n⚠ Failed to parse schema (${raw.slice(0, 60)}...): ${error.message}`,
    );
    return { fields: {}, strict: false, failed: true };
  }
}

// Extract Zod schemas from project
function extractSchemas(
  pattern: string,
  onProgress?: (current: number, total: number) => void,
): ParsedSchema[] {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  project.addSourceFilesAtPaths(pattern);
  const output: ParsedSchema[] = [];

  const sourceFiles = project
    .getSourceFiles(pattern)
    .filter((sf: any) => !sf.getFilePath().includes("/node_modules/"));
  let index = 0;

  for (const sf of sourceFiles) {
    index++;
    if (onProgress) onProgress(index, sourceFiles.length);

    for (const stmt of sf.getVariableStatements()) {
      if (!stmt.hasExportKeyword()) continue;

      const jsDocs = stmt.getJsDocs();
      const allTags = jsDocs.flatMap((d: TsMorphNode) => d.getTags?.() || []);

      const hasAppSec = allTags.some(
        (t: TsMorphNode) => t.getTagName?.() === "AppSec",
      );
      if (!hasAppSec) continue;

      const collectionTag = allTags.find(
        (t: TsMorphNode) => t.getTagName?.() === "Collection",
      );
      const collection = collectionTag?.getCommentText?.()?.trim();

      const sourceFile = sf.getFilePath();

      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;

        const name = decl.getName();
        const raw = init.getText();

        const parsed = parseRawZod(raw);
        const fields = parsed.fields;
        const strict = parsed.strict;

        // generate requiresManual report
        const requiresManual: Record<string, ParsedField> = {};

        function checkFields(
          fields: Record<string, ParsedField>,
          path: string[] = [],
        ) {
          for (const [key, field] of Object.entries(fields)) {
            const fullPath = [...path, key].join(".");

            // Check if field has complex check
            if (field.hasComplexCheck) {
              requiresManual[fullPath] = field;
            }

            // Check nested fields for arrays/objects
            if (field.type === "array" && field.fields) {
              const arrayPath = [...path, key];
              checkFields(field.fields, arrayPath);
            } else if (field.type === "object" && field.fields) {
              const objectPath = [...path, key];
              checkFields(field.fields, objectPath);
            }
          }
        }

        checkFields(fields);

        output.push({
          name: name,
          fields,
          strict,
          collection,
          sourceFile,
          raw,
          requiresManual,
        });
      }
    }
  }

  return output;
}

module.exports = { escapeKey, parseRawZod, extractSchemas };

export {};
