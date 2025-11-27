"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRequiredCheck = void 0;
/**
 * buildRequiredCheck
 * - schemaFuncName: vollständiger Funktionsname, z.B. "hasRequired_ProjectStateSchema"
 * - fields: feld-meta (kann nested enthalten)
 * - ownerField?: optional, füge Owner-Feld zur Top-Level-Whitelist hinzu
 *
 * Liefert Array<string> Lines (keine zusätzliche Indentierung).
 */
function buildRequiredCheck(schemaFuncName, fields, ownerField) {
    const lines = [];
    const topFields = Object.keys(fields);
    const whitelist = [...topFields];
    if (ownerField && !whitelist.includes(ownerField))
        whitelist.push(ownerField);
    // Top-Level whitelist
    if (whitelist.length) {
        lines.push(`function ${schemaFuncName}_hasOnlyTopLevel() {`);
        lines.push(`  return request.resource.data.keys().hasOnly([${whitelist
            .map((f) => `"${f}"`)
            .join(", ")}]);`);
        lines.push(`}`);
    }
    // Recursive Field Checks
    function buildFieldExpr(prefix, meta) {
        const expr = `request.resource.data${prefix}`;
        const checks = [];
        // Typprüfung
        switch (meta.type) {
            case "string":
                checks.push(`${expr} is string`);
                break;
            case "number":
                checks.push(`${expr} is number`);
                break;
            case "boolean":
                checks.push(`${expr} is bool`);
                break;
            case "timestamp":
                checks.push(`${expr} is timestamp`);
                break;
            case "object":
                checks.push(`${expr} is map`);
                break;
            case "array":
                checks.push(`${expr} is list`);
                break;
        }
        // Enum
        if (meta.enum?.length)
            checks.push(`${expr} in [${meta.enum.map((v) => `"${v}"`).join(", ")}]`);
        // Nested Fields
        if (meta.fields && Object.keys(meta.fields).length) {
            for (const [k, v] of Object.entries(meta.fields)) {
                checks.push(buildFieldExpr(`${prefix}.${k}`, v));
            }
        }
        const presence = `request.resource.data.keys().has("${prefix.slice(1)}")`;
        return meta.required
            ? `(${presence} && ${checks.join(" && ")})`
            : `(!${presence} || (${checks.join(" && ")}))`;
    }
    const fieldExprs = Object.entries(fields).map(([k, v]) => buildFieldExpr(`.${k}`, v));
    lines.push(`function ${schemaFuncName}() {`);
    if (fieldExprs.length) {
        lines.push(`  return (${fieldExprs.join(" && ")})`);
    }
    else if (ownerField) {
        lines.push(`  return request.resource.data.${ownerField} == request.auth.uid`);
    }
    else {
        lines.push(`  return true`);
    }
    lines.push(`}`);
    return lines;
}
exports.buildRequiredCheck = buildRequiredCheck;
