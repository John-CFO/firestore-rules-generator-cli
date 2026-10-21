#!/usr/bin/env node

// --- Imports ---
const { Command } = require("commander");
const chalk = require("chalk");
const figures = require("figures");
const { initCommand: _initCommand } = require("./commands/init");
const { scanZodCommand: _scanZodCommand } = require("./commands/scanZod");
const { validateCommand: _validateCommand } = require("./commands/validate");
const { generateCommand: _generateCommand } = require("./commands/generate");
const { discoverCommand: _discoverCommand } = require("./commands/discover");

const program = new Command();
program.name("frcli").version("1.0.0").description("Firestore Rules CLI");

// Wrapper for consistent output + error handling
function wrapAction(
  action: Function,
  successMsg?: string,
  extraInfo?: string[],
) {
  return async (...args: any[]) => {
    try {
      const result = await action(...args);
      if (successMsg) {
        console.log(chalk.green(`${figures.tick} ${successMsg}`));
      }
      if (extraInfo && extraInfo.length) {
        extraInfo.forEach((msg) =>
          console.log(chalk.blue(`${figures.info} ${msg}`)),
        );
      }
      return result;
    } catch (err: any) {
      console.error(chalk.red(`${figures.cross} Error:`), err.message || err);
      process.exit(1);
    }
  };
}

// --- Commands ---
program
  .command("init")
  .option("-o, --out <file>", "output file", "rules.config.json")
  .action(
    wrapAction(_initCommand, "Template config created", [
      "Adjust 'collections' and 'subcollections' to match your backend hierarchy",
      "Each entry should have a path (Firestore path), schema (from scan-zod output), optional ownerField/customChecks",
    ]),
  );

program
  .command("scan-zod")
  .description(
    "Scan TypeScript files for @AppSec Zod schemas.\n" +
      "  Examples:\n" +
      "    frcli scan-zod                              (default: **/*.ts)\n" +
      '    frcli scan-zod -p "validation/**/*.ts"\n' +
      '    frcli scan-zod -p "src/schemas/**/*.ts" -o .zod-mapping.json',
  )
  .option("-p, --pattern <glob>", "file pattern to match", "**/*.ts")
  .option("-o, --out <file>", "output json", ".zod-mapping.json")
  .action(
    wrapAction(_scanZodCommand, "Zod schemas scanned", [
      "Mapping written to .zod-mapping.json",
      "Only schemas marked with @AppSec are included",
    ]),
  );

program
  .command("validate")
  .option("-c, --config <file>", "config file", "rules.config.json")
  .option("-m, --mapping <file>", "mapping file", ".zod-mapping.json")
  .action(
    wrapAction(_validateCommand, "Validation passed ✅", [
      "Ensure referenced schemas exist in the mapping file",
      "Fix any missing or misconfigured collections before generating rules",
    ]),
  );

program
  .command("generate")
  .option("-c, --config <file>", "config file", "rules.config.json")
  .option("-m, --mapping <file>", "mapping file", ".zod-mapping.json")
  .option("-o, --out <file>", "output rules", "firestore.rules")
  .action(
    wrapAction(_generateCommand, "Firestore rules generated", [
      "Output written to firestore.rules",
      "Check warnings about optional fields and enums in the console",
      "Ensure your backend collections/subcollections match the config",
    ]),
  );

program
  .command("discover")
  .description(
    "Scan source files for Firestore doc()/collection() calls and suggest a rules.config.json structure.\n" +
      "  Output goes to rules.config.json.suggested — review and merge manually.",
  )
  .option("-p, --pattern <glob>", "file pattern to match", "**/*.{ts,tsx}")
  .option("-o, --out <file>", "output file", "rules.config.json.suggested")
  .action(
    wrapAction(_discoverCommand, "Structure discovered", [
      "Review rules.config.json.suggested",
      "Replace REPLACE_WITH_SCHEMA_NAME with your schema names",
      "Adjust allow flags per collection",
      "Merge into rules.config.json",
      "Run: frcli validate && frcli generate",
    ]),
  );

// --- No command fallback ---
program.parse(process.argv);
if (!process.argv.slice(2).length) {
  console.log(chalk.yellow(`${figures.info} No command specified.`));
  program.help();
}

export {};
