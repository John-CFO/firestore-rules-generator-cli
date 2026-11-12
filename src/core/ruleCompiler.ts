//src/core/ruleCompiler.ts

// interface
export interface FieldMeta {
  type: string;
  required: boolean;
  enum?: string[];
  ref?: string;
  fields?: Record<string, FieldMeta>;
  min?: number;
  max?: number;
  regex?: string;
  nullable?: boolean;
  hasComplexCheck?: boolean;
  complexCheckWarning?: string;
}

// --- function to build required check ---
export function buildRequiredCheck(
  schemaFuncName: string,
  fields: Record<string, FieldMeta>,
  ownerField?: string,
): string[] {
  const lines: string[] = [];

  // function to build presence check
  function buildPresenceExpr(prefix: string): string {
    const parts = prefix.slice(1).split(".");
    if (parts.length === 1) {
      return `"${parts[0]}" in request.resource.data`;
    }
    const parent = parts.slice(0, -1).join(".");
    const leaf = parts[parts.length - 1];
    return `"${leaf}" in request.resource.data.${parent}`;
  }

  // function to build field check
  function buildFieldExpr(prefix: string, meta: FieldMeta): string {
    const expr = `request.resource.data${prefix}`;
    const checks: string[] = [];
    const presence = buildPresenceExpr(prefix);

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

    if (meta.enum?.length) {
      const vals = meta.enum.map((v) => JSON.stringify(v)).join(", ");
      checks.push(`${expr} in [${vals}]`);
    }

    if (meta.type === "number") {
      if (meta.min !== undefined) checks.push(`${expr} >= ${meta.min}`);
      if (meta.max !== undefined) checks.push(`${expr} <= ${meta.max}`);
    }

    if (meta.type === "string") {
      if (meta.min !== undefined) checks.push(`${expr}.size() >= ${meta.min}`);
      if (meta.max !== undefined) checks.push(`${expr}.size() <= ${meta.max}`);
    }

    if (meta.type === "string" && meta.regex) {
      const raw = meta.regex.replace(/^\/|\/[a-z]*$/g, "");
      checks.push(`${expr}.matches(${JSON.stringify(raw)})`);
    }

    if (checks.length === 0) {
      return meta.required ? presence : "";
    }

    // Nested fields — only for objects no arrays
    if (meta.type === "object" && meta.fields) {
      for (const [k, v] of Object.entries(meta.fields)) {
        checks.push(buildFieldExpr(`${prefix}.${k}`, v));
      }
    }

    const filtered = checks.filter(Boolean);
    const typeCheck = filtered.join(" && ");

    let inner: string;
    if (meta.nullable) {
      inner = typeCheck
        ? `(${expr} == null || (${typeCheck}))`
        : `${expr} == null`;
    } else {
      inner = typeCheck;
    }

    if (!inner) {
      return meta.required ? presence : "";
    }
    return meta.required
      ? `(${presence} && ${inner})`
      : `(!(${presence}) || ${inner})`;
  }

  const fieldExprs = Object.entries(fields)
    .map(([k, v]) => buildFieldExpr(`.${k}`, v))
    .filter(Boolean);

  lines.push(`function ${schemaFuncName}() {`);
  if (fieldExprs.length) {
    lines.push(`  return (${fieldExprs.join(" && ")});`);
  } else if (ownerField) {
    lines.push(
      `  return request.resource.data.${ownerField} == request.auth.uid;`,
    );
  } else {
    lines.push(`  return true;`);
  }
  lines.push(`}`);

  return lines;
}
