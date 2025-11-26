//src/core/zodParser.ts
const { Project } = require("ts-morph");

export interface ParsedField {
  type: string;
  required: boolean;
  enum?: string[];
  ref?: string;
  fields?: Record<string, ParsedField>;
}

export interface ParsedSchema {
  name: string;
  fields: Record<string, ParsedField>;
  raw: string;
}

export function extractSchemas(pattern: string): ParsedSchema[] {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  project.addSourceFilesAtPaths(pattern);

  const schemas: ParsedSchema[] = [];

  for (const sf of project.getSourceFiles()) {
    for (const stmt of sf.getVariableStatements()) {
      if (!stmt.hasExportKeyword()) continue;
      const jsDocs = stmt.getJsDocs();
      const hasAppSec = jsDocs.some((doc: any) =>
        doc.getTags().some((tag: any) => tag.getTagName() === "AppSec")
      );
      if (!hasAppSec) continue;

      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        const raw = init.getText();
        const fields = parseRawZod(raw);
        schemas.push({ name: decl.getName(), fields, raw });
      }
    }
  }

  return schemas;
}

/**
 * Einfacher parser: erkennt first-level z.object({ ... })
 * unterstützt: z.string(), z.number(), z.boolean(), z.date(), z.enum([...]), optional(), z.array(z.object({...})) via ref hint
 */
export function parseRawZod(raw: string): Record<string, ParsedField> {
  const fields: Record<string, ParsedField> = {};

  const objMatch = raw.match(/z\.object\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!objMatch) return fields;
  const body = objMatch[1];

  // enum
  const enumRegex =
    /(\w+)\s*:\s*z\.enum\(\s*\[([\s\S]*?)\]\s*\)(\.optional\(\))?/g;
  let m;
  while ((m = enumRegex.exec(body)) !== null) {
    const [, key, listRaw, optional] = m;
    const items = Array.from(listRaw.matchAll(/['"`]([^'"`]+)['"`]/g)).map(
      (mm: any) => mm[1]
    );
    fields[key] = { type: "string", required: !optional, enum: items };
  }

  // primitives & date/array/object (basic)
  const fieldRegex =
    /(\w+)\s*:\s*z\.(string|number|boolean|date|array|object)(?:\([^)]*\))?(\.optional\(\))?/g;
  while ((m = fieldRegex.exec(body)) !== null) {
    const [, key, type, optional] = m;
    const mapped = type === "date" ? "timestamp" : type;
    fields[key] = { type: mapped, required: !optional };
  }

  // NOTE: For deep object/array refs you should add a mapping JSON that references other schemas.
  return fields;
}

module.exports = { extractSchemas };
