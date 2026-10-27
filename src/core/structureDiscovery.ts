// src/core/structureDiscovery.ts

const { Project, SyntaxKind } = require("ts-morph");
export interface DiscoveredCollection {
  path: string; // e.g. "Users/{uid}"
  children: DiscoveredCollection[];
}

export interface DiscoveryResult {
  collections: DiscoveredCollection[];
  filesScanned: number;
  docCallsFound: number;
  collectionCallsFound: number;
  uniquePaths: number;
  warnings: string[];
}

// Param names that carry no information about the domain
const PLACEHOLDER_PARAMS = new Set(["docId", "id", "param"]);

// Unwrap `x as T`, `<T>x`, `x!`, `(x)`, `x satisfies T`
function unwrapArg(node: any): any {
  const unwrapKinds = [
    SyntaxKind.AsExpression,
    SyntaxKind.TypeAssertionExpression,
    SyntaxKind.NonNullExpression,
    SyntaxKind.ParenthesizedExpression,
    SyntaxKind.SatisfiesExpression,
  ];
  let current = node;
  while (unwrapKinds.includes(current.getKind())) {
    current = current.getExpression();
  }
  return current;
}

function extractSegments(
  args: any[],
  sf: any,
  call: any,
  warnings: string[],
): string[] | null {
  const segments: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = unwrapArg(args[i]);
    const kind = arg.getKind();

    if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      const literal = arg.getLiteralText();
      // Path-style string like "Users/abc123" — hardcoded, can't parametrize
      if (literal.includes("/")) {
        warnings.push(
          `${sf.getFilePath()}:${call.getStartLineNumber()} - ` +
            `path-style string "${literal}" not supported, use multi-arg form`,
        );
        return null;
      }
      segments.push(literal);
      continue;
    }

    if (
      kind === SyntaxKind.Identifier ||
      kind === SyntaxKind.PropertyAccessExpression
    ) {
      const name = arg.getText().split(".").pop() || "id";
      segments.push(`{${name}}`);
      continue;
    }

    warnings.push(
      `${sf.getFilePath()}:${call.getStartLineNumber()} - ` +
        `cannot resolve argument "${arg.getText()}" (${arg.getKindName()})`,
    );
    return null;
  }

  return segments;
}

function mergePath(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  const len = Math.min(merged.length, incoming.length);
  for (let i = 1; i < len; i += 2) {
    const existingParam = merged[i].match(/^\{(\w+)\}$/)?.[1];
    const incomingParam = incoming[i].match(/^\{(\w+)\}$/)?.[1];
    if (!existingParam || !incomingParam) continue;
    if (
      PLACEHOLDER_PARAMS.has(existingParam) &&
      !PLACEHOLDER_PARAMS.has(incomingParam)
    ) {
      merged[i] = incoming[i];
    }
  }
  return merged;
}

function buildTree(paths: string[][]): DiscoveredCollection[] {
  const roots: DiscoveredCollection[] = [];

  for (const segments of paths) {
    let siblings = roots;
    for (let i = 0; i < segments.length - 1; i += 2) {
      const collectionName = segments[i];
      const paramName = segments[i + 1];

      // Match on collection name only — params are local variable names
      let node = siblings.find((n) => n.path.split("/")[0] === collectionName);

      if (!node) {
        node = { path: `${collectionName}/${paramName}`, children: [] };
        siblings.push(node);
      } else {
        // Prefer more descriptive param names over generic ones
        const existingParam = node.path.split("/")[1].replace(/[{}]/g, "");
        const incomingParam = paramName.replace(/[{}]/g, "");
        const isGeneric = (p: string) =>
          ["uid", "id", "docId", "param"].includes(p);
        if (isGeneric(existingParam) && !isGeneric(incomingParam)) {
          node.path = `${collectionName}/${paramName}`;
        }
      }

      siblings = node.children;
    }
  }

  return roots;
}

export function discoverStructure(pattern: string): DiscoveryResult {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  project.addSourceFilesAtPaths(pattern);

  // Match any node_modules folder anywhere in the tree — handles the
  // top-level one plus nested ones like functions/node_modules and
  // emulator-tests/node_modules. ts-morph returns forward slashes on
  // every platform, so the leading/trailing slash form is safe.
  const isInsideNodeModules = (filePath: string): boolean =>
    filePath.includes("/node_modules/");

  const rawPaths: string[][] = [];
  const warnings: string[] = [];
  let filesScanned = 0;
  let docCallsFound = 0;
  let collectionCallsFound = 0;

  for (const sf of project.getSourceFiles(pattern)) {
    if (isInsideNodeModules(sf.getFilePath())) continue;

    filesScanned++;
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of calls) {
      const callee = call.getExpression().getText();
      const shortName = callee.includes(".") ? callee.split(".").pop() : callee;
      if (shortName !== "doc" && shortName !== "collection") continue;

      if (shortName === "doc") docCallsFound++;
      else collectionCallsFound++;

      const args = call.getArguments();
      if (args.length < 2) continue;

      const segments = extractSegments(args, sf, call, warnings);
      if (!segments || segments.length === 0) continue;

      // `collection(db, "Users")` produces odd-length; pad with placeholder
      if (segments.length % 2 === 1) {
        segments.push("{docId}");
      }

      rawPaths.push(segments);
    }
  }

  // Dedupe by collection path (ignore param names), merge to prefer meaningful names
  const unique = new Map<string, string[]>();
  for (const path of rawPaths) {
    const key = path.filter((_, i) => i % 2 === 0).join("/");
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, path);
    } else {
      unique.set(key, mergePath(existing, path));
    }
  }

  const collections = buildTree(Array.from(unique.values()));

  return {
    collections,
    filesScanned,
    docCallsFound,
    collectionCallsFound,
    uniquePaths: unique.size,
    warnings,
  };
}
