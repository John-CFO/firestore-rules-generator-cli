//src/core/ruleCompiler.ts
export interface ParsedSchema {
  name: string;
  fields: Record<string, { type: string; required: boolean }>;
  raw: string;
}
function buildRequiredCheck(
  schemaName: ParsedSchema["name"],
  fields: ParsedSchema["fields"]
) {
  const requiredFields = Object.keys(fields).filter((f) => fields[f].required);
  if (requiredFields.length === 0) return [];

  return [
    `      function hasRequired_${schemaName}() {`,
    `        return ${requiredFields
      .map((f) => `request.resource.data.keys().has("${f}")`)
      .join(" && ")};`,
    `      }`,
  ];
}

module.exports = { buildRequiredCheck };
