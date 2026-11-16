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
  const pattern = options.pattern || "**/*.ts";
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
      console.log(
        chalk.yellow(
          `  ${figures.warning} Schema '${schema.name}' has no parseable fields (not an object schema?)`,
        ),
      );
    }

    output[schema.name] = {
      collection: schema.collection || undefined,
      sourceFile: schema.sourceFile || undefined,
      fields: schema.fields,
      strict: schema.strict === true,
      rootField: schema.rootField,
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

  // Preserve developer-provided targetField from an existing mapping.
  // scanZod regenerates the file from scratch; without this merge, a
  // manually assigned targetField would be lost on the next scan.
  //
  // If the existing file cannot be read or parsed, abort BEFORE writing.
  // Overwriting a corrupt file would silently destroy manual mappings
  // and leave the developer with no chance to recover them.
  if (fs.existsSync(outFile)) {
    let existing: Record<string, { targetField?: string }>;
    try {
      existing = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    } catch (err: any) {
      console.error("");
      console.error(
        chalk.red(
          `${figures.warning} Cannot read existing ${path.basename(outFile)}: ${err.message}`,
        ),
      );
      console.error(
        chalk.red(
          `Aborting scan to avoid overwriting manually configured mappings.`,
        ),
      );
      console.error(
        chalk.red(`Fix or move ${path.basename(outFile)} and re-run scan-zod.`),
      );
      throw new Error(
        `Refusing to overwrite unreadable ${path.basename(outFile)}`,
      );
    }

    // Merge only targetField, only for schemas present in the new scan.
    // Schemas no longer discovered are dropped (existing behavior).
    for (const name of Object.keys(output)) {
      const prev = existing[name]?.targetField;
      if (prev && !output[name].targetField) {
        output[name].targetField = prev;
      }
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
