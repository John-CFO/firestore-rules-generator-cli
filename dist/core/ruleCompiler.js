"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function buildRequiredCheck(schemaName, fields) {
    const requiredFields = Object.keys(fields).filter((f) => fields[f].required);
    if (requiredFields.length === 0)
        return [];
    return [
        `      function hasRequired_${schemaName}() {`,
        `        return ${requiredFields
            .map((f) => `request.resource.data.keys().has("${f}")`)
            .join(" && ")};`,
        `      }`,
    ];
}
module.exports = { buildRequiredCheck };
