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

function detectOwnerField(docVar: string): string {
  if (["uid", "userId", "ownerId", "owner"].includes(docVar)) {
    return docVar;
  }
  // Uncommon name — keep it, user reviews
  return docVar;
}

function toConfigNode(node: any, isRoot: boolean): any {
  const match = node.path.match(/^([^/]+)\/\{(\w+)\}$/);
  if (!match) {
    throw new Error(`Unexpected path format: ${node.path}`);
  }
  const docVar = match[2];

  const config: any = { path: node.path };

  if (isRoot) {
    config.ownerField = detectOwnerField(docVar);
  }

  config.schema = "REPLACE_WITH_SCHEMA_NAME";
  config.allow = {
    read: true,
    create: false,
    update: false,
    delete: false,
  };

  if (node.children.length > 0) {
    config.subcollections = node.children.map((c: any) =>
      toConfigNode(c, false),
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
    console.log(chalk.blue(`  - ${name} (${fields} fields${suffix})`));
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

  const result = discoverStructure(pattern);

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

  const config = {
    collections: result.collections.map((node: unknown) =>
      toConfigNode(node, true),
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

  printAvailableSchemas(outFile);

  return { outFile, discovered: result.collections.length };
}

module.exports = { discoverCommand };
