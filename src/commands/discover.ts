// src/commands/discover.ts

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const figures = require("figures");
const { discoverStructure } = require("../core/structureDiscovery");

export interface DiscoverOpts {
  pattern?: string;
  out?: string;
}

interface SchemaMapping {
  [schemaName: string]: {
    collection?: string;
    sourceFile?: string;
    fields?: Record<string, any>;
    requiresManual?: Record<string, any>;
  };
}

interface AssignmentReport {
  autoAssigned: Array<{ path: string; schema: string }>;
  needsManual: Array<{ path: string }>;
}

function loadMapping(): SchemaMapping {
  const mappingPath = path.resolve(".zod-mapping.json");
  if (!fs.existsSync(mappingPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
  } catch {
    return {};
  }
}

function findSchemaForCollection(
  collectionName: string,
  mapping: SchemaMapping,
): string | undefined {
  for (const [schemaName, def] of Object.entries(mapping)) {
    if (def.collection === collectionName) {
      return schemaName;
    }
  }
  return undefined;
}

function detectOwnerField(docVar: string): string {
  if (["uid", "userId", "ownerId", "owner"].includes(docVar)) {
    return docVar;
  }
  // Uncommon name — keep it, user reviews
  return docVar;
}

function toConfigNode(
  node: any,
  isRoot: boolean,
  mapping: SchemaMapping,
  report: AssignmentReport,
): any {
  const match = node.path.match(/^([^/]+)\/\{(\w+)\}$/);
  if (!match) {
    throw new Error(`Unexpected path format: ${node.path}`);
  }
  const docVar = match[2];
  const collectionName = match[1];

  const config: any = { path: node.path };

  if (isRoot) {
    config.ownerField = detectOwnerField(docVar);
  }

  // Auto-assign from @Collection tag
  const autoSchema = findSchemaForCollection(collectionName, mapping);
  if (autoSchema) {
    config.schema = autoSchema;
    report.autoAssigned.push({ path: node.path, schema: autoSchema });
  } else {
    config.schema = "REPLACE_WITH_SCHEMA_NAME";
    report.needsManual.push({ path: node.path });
  }

  config.allow = {
    read: true,
    create: false,
    update: false,
    delete: false,
  };

  if (node.children.length > 0) {
    config.subcollections = node.children.map((c: any) =>
      toConfigNode(c, false, mapping, report),
    );
  }

  return config;
}

function printAvailableSchemas(outFile: string): void {
  const mappingPath = path.resolve(".zod-mapping.json");

  if (!fs.existsSync(mappingPath)) {
    console.log("");
    console.log(
      chalk.yellow(
        `${figures.warning} No .zod-mapping.json found. Run "frcli scan-zod" first to see available schemas.`,
      ),
    );
    return;
  }

  const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
  const schemaNames = Object.keys(mapping);

  if (schemaNames.length === 0) return;

  console.log("");
  console.log(
    chalk.blue(`${figures.info} Available schemas from .zod-mapping.json:`),
  );
  for (const name of schemaNames) {
    const fields = Object.keys(mapping[name].fields || {}).length;
    const manual = Object.keys(mapping[name].requiresManual || {}).length;
    const suffix = manual > 0 ? ` (${manual} require manual)` : "";
    const tagged = mapping[name].collection
      ? chalk.green(` [@Collection ${mapping[name].collection}]`)
      : "";
    console.log(chalk.blue(`  - ${name} (${fields} fields${suffix})`) + tagged);
  }
  console.log("");
  console.log(
    chalk.blue(
      `${figures.info} Replace REPLACE_WITH_SCHEMA_NAME in ${path.basename(outFile)} with one of the above.`,
    ),
  );
  console.log(
    chalk.blue(
      `${figures.info} Omit the "schema" field for collections without an @AppSec schema.`,
    ),
  );
}

async function discoverCommand(opts: DiscoverOpts) {
  const pattern = opts.pattern || "**/*.{ts,tsx}";
  const outFile = path.resolve(opts.out || "rules.config.json.suggested");

  if (!fs.existsSync("tsconfig.json")) {
    throw new Error(
      `tsconfig.json not found in ${process.cwd()}. Run frcli from your project root.`,
    );
  }

  console.log(
    chalk.blue(
      `${figures.info} Scanning for Firestore doc()/collection() calls...`,
    ),
  );
  console.log(chalk.blue(`Pattern: ${pattern}`));

  let lastReportedAt = 0;
  const result = discoverStructure(
    pattern,
    (current: number, total: number) => {
      const step = Math.max(Math.floor(total / 5), 25);
      if (current - lastReportedAt >= step && current < total) {
        lastReportedAt = current;
        console.log(
          chalk.blue(`${figures.info} Scanned ${current}/${total} files...`),
        );
      }
    },
  );

  console.log(chalk.blue(`Files scanned: ${result.filesScanned}`));
  console.log(chalk.blue(`doc() calls: ${result.docCallsFound}`));
  console.log(chalk.blue(`collection() calls: ${result.collectionCallsFound}`));
  console.log(chalk.blue(`Distinct paths: ${result.uniquePaths}`));

  if (result.collections.length === 0) {
    console.warn(
      chalk.yellow(`${figures.warning} No Firestore paths discovered.`),
    );
    console.warn(
      chalk.yellow(
        `Check the pattern, or verify your code imports doc() / collection() from "firebase/firestore".`,
      ),
    );
    return { outFile: null, discovered: 0 };
  }

  const mapping = loadMapping();
  const report: AssignmentReport = { autoAssigned: [], needsManual: [] };

  const config = {
    collections: result.collections.map((node: unknown) =>
      toConfigNode(node, true, mapping, report),
    ),
  };

  const existed = fs.existsSync(outFile);
  fs.writeFileSync(outFile, JSON.stringify(config, null, 2) + "\n", "utf-8");

  if (existed) {
    console.warn(
      chalk.yellow(
        `${figures.warning} Overwrote existing ${path.basename(outFile)}`,
      ),
    );
  }

  if (result.warnings.length > 0) {
    console.log("");
    console.log(chalk.yellow(`${figures.warning} Warnings:`));
    result.warnings.forEach((w: string) =>
      console.log(chalk.yellow(`  - ${w}`)),
    );
  }

  if (report.autoAssigned.length > 0) {
    console.log("");
    console.log(
      chalk.green(`${figures.tick} Auto-assigned from @Collection tags:`),
    );
    for (const item of report.autoAssigned) {
      console.log(chalk.green(`  ${item.path} → ${item.schema}`));
    }
  }

  if (report.needsManual.length > 0) {
    console.log("");
    console.log(
      chalk.yellow(`${figures.warning} Still needs manual schema assignment:`),
    );
    for (const item of report.needsManual) {
      console.log(chalk.yellow(`  ${item.path}`));
    }
  }

  printAvailableSchemas(outFile);

  return { outFile, discovered: result.collections.length };
}

module.exports = { discoverCommand };
