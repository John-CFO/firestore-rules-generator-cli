// src/commands/scanZod.ts

// imported modules
const { extractSchemas } = require("../core/zodParser");
const chalk = require("chalk");
const figures = require("figures");

// interface
export interface ScanOpts {
  pattern: string;
  out: string;
  current: number;
  total: number;
}

// imported modules
const path = require("path");
const fs = require("fs");

// --- Scan Zod Command Function ---
async function scanZodCommand(options: { pattern?: string; out?: string }) {
  const pattern = options.pattern || "**/*.{ts,tsx}";
  const outFile = path.resolve(options.out || ".zod-mapping.json");

  console.log(
    chalk.blue(`${figures.info} Scanning for Zod schemas with @AppSec tag...`),
  );
  console.log(chalk.blue(`Pattern: ${pattern}`));

  let lastReportedAt = 0;
  const schemas = extractSchemas(pattern, (current: number, total: number) => {
    const step = Math.max(Math.floor(total / 5), 25);
    if (current - lastReportedAt >= step && current < total) {
      lastReportedAt = current;
      console.log(
        chalk.blue(`${figures.info} Scanned ${current}/${total} files...`),
      );
    }
  });

  console.log(
    chalk.green(`${figures.tick} Found ${schemas.length} Zod schemas`),
  );

  const output: Record<string, any> = {};
  let totalManualChecks = 0;
  const manualCheckDetails: Array<{
    schema: string;
    field: string;
    warning: string;
  }> = [];

  for (const schema of schemas) {
    console.log(chalk.cyan(`\nProcessing schema: ${schema.name}`));
    console.log(`Raw Zod definition length: ${schema.raw.length} chars`);

    if (Object.keys(schema.fields).length === 0) {
      if (schema.rootField && schema.targetField) {
        console.log(
          chalk.green(
            `  ${figures.tick} Primitive root mapped to "${schema.targetField}" via @FirestoreField`,
          ),
        );
      } else if (schema.rootField) {
        console.log(
          chalk.yellow(
            `  ${figures.warning} Schema '${schema.name}' is a primitive root; ` +
              `add @FirestoreField <fieldName> to map it to a Firestore field`,
          ),
        );
      } else {
        console.log(
          chalk.yellow(
            `  ${figures.warning} Schema '${schema.name}' has no parseable fields`,
          ),
        );
      }
    }

    output[schema.name] = {
      collection: schema.collection || undefined,
      sourceFile: schema.sourceFile || undefined,
      fields: schema.fields,
      strict: schema.strict === true,
      rootField: schema.rootField,
      targetField: schema.targetField,
      raw: schema.raw,
      requiresManual: schema.requiresManual || {},
    };

    if (
      schema.requiresManual &&
      Object.keys(schema.requiresManual).length > 0
    ) {
      const manualCount = Object.keys(schema.requiresManual).length;
      totalManualChecks += manualCount;
      console.log(
        chalk.yellow(
          `${figures.warning} ${manualCount} fields require manual implementation`,
        ),
      );

      for (const [fieldPath, field] of Object.entries(schema.requiresManual)) {
        const warning =
          (field as any).complexCheckWarning || "Complex validation detected";
        manualCheckDetails.push({
          schema: schema.name,
          field: fieldPath,
          warning: warning,
        });
        console.log(chalk.yellow(`  - ${fieldPath}: ${warning}`));
      }
    } else if (Object.keys(schema.fields).length > 0) {
      console.log(
        chalk.green(
          `${figures.tick} All fields can be automatically processed`,
        ),
      );
    }
  }

  // @FirestoreField in the source is the only source of truth for
  // targetField. The mapping file is regenerated on every scan; any
  // stale targetField in an existing file is dropped here. Manual
  // edits no longer survive a rescan — use @FirestoreField instead.
  //
  // The existing file is still parsed as a safety net: if it is not
  // valid JSON, abort before overwriting so the user does not lose
  // whatever was in the file (e.g. a half-finished manual edit).
  if (fs.existsSync(outFile)) {
    try {
      JSON.parse(fs.readFileSync(outFile, "utf-8"));
    } catch (err: any) {
      console.error("");
      console.error(
        chalk.red(
          `${figures.warning} Cannot read existing ${path.basename(outFile)}: ${err.message}`,
        ),
      );
      console.error(
        chalk.red(`Aborting scan to avoid overwriting a corrupt mapping file.`),
      );
      console.error(
        chalk.red(`Fix or move ${path.basename(outFile)} and re-run scan-zod.`),
      );
      throw new Error(
        `Refusing to overwrite unreadable ${path.basename(outFile)}`,
      );
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf-8");

  // Summary output
  console.log(chalk.blue(`\n${figures.info} Summary:`));
  console.log(chalk.blue(`Schemas processed: ${schemas.length}`));
  console.log(
    chalk.blue(`Total fields requiring manual checks: ${totalManualChecks}`),
  );

  if (totalManualChecks > 0) {
    console.log(chalk.yellow(`\n${figures.warning} IMPORTANT:`));
    console.log(
      chalk.yellow(
        `The following validations require manual implementation in Firestore rules:`,
      ),
    );
    console.log(
      chalk.yellow(`They are marked as "requiresManual" in .zod-mapping.json`),
    );
    console.log(
      chalk.yellow(`You need to add custom security rules for these fields.`),
    );

    manualCheckDetails.forEach((detail) => {
      console.log(
        chalk.yellow(`  • ${detail.schema}.${detail.field}: ${detail.warning}`),
      );
    });
  }

  return {
    message: `${
      Object.keys(output).length
    } schemas scanned, ${totalManualChecks} require manual checks`,
    outFile,
    manualChecks: totalManualChecks,
    details: manualCheckDetails,
  };
}

module.exports = { scanZodCommand };
