"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//src/core/zodParser.ts
const { Project, SyntaxKind } = require("ts-morph");
function extractSchemas(pattern) {
    const project = new Project({ tsConfigFilePath: "tsconfig.json" });
    project.addSourceFilesAtPaths(pattern);
    const schemas = [];
    for (const sf of project.getSourceFiles()) {
        for (const stmt of sf.getVariableStatements()) {
            if (!stmt.hasExportKeyword())
                continue;
            const jsDocs = stmt.getJsDocs();
            const hasAppSec = jsDocs.some((doc) => doc.getTags().some((tag) => tag.getTagName() === "AppSec"));
            if (!hasAppSec)
                continue;
            for (const decl of stmt.getDeclarations()) {
                const init = decl.getInitializer();
                if (!init)
                    continue;
                const raw = init.getText();
                const fields = parseRawZod(raw);
                schemas.push({
                    name: decl.getName(),
                    fields,
                    raw,
                });
            }
        }
    }
    return schemas;
}
/**
 * Very simple parser for first-level Zod object
 * Supports: string, number, boolean, optional
 * @param {string} raw
 * @returns {Record<string, {type:string, required:boolean}>}
 */
function parseRawZod(raw) {
    const fields = {};
    const objMatch = raw.match(/z\.object\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!objMatch)
        return fields;
    const body = objMatch[1];
    // Match each field: key: z.type() or z.type().optional()
    const fieldRegex = /(\w+)\s*:\s*z\.(string|number|boolean|array|object)\((?:.*?)\)(\.optional\(\))?/g;
    let m;
    while ((m = fieldRegex.exec(body)) !== null) {
        const [, key, type, optional] = m;
        fields[key] = {
            type,
            required: !optional,
        };
    }
    return fields;
}
module.exports = { extractSchemas };
