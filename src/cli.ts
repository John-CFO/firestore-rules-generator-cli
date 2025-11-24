#!/usr/bin/env node
const { Command } = require("commander");
const { initCommand: _initCommand } = require("./commands/init");
const { scanZodCommand: _scanZodCommand } = require("./commands/scanZod");
const { validateCommand: _validateCommand } = require("./commands/validate");
const { generateCommand: _generateCommand } = require("./commands/generate");

const program = new Command();

program.name("frcli").version("1.0.0").description("Firestore Rules CLI");

program
  .command("init")
  .option("-o, --out <file>", "output file", "rules.config.json")
  .action(_initCommand);

program
  .command("scan-zod")
  .option("-p, --pattern <glob>", "file pattern", "src/**/*.ts")
  .option("-o, --out <file>", "output json", ".zod-mapping.json")
  .action(_scanZodCommand);

program
  .command("validate")
  .option("-c, --config <file>", "config file", "rules.config.json")
  .option("-m, --mapping <file>", "mapping file", ".zod-mapping.json")
  .action(_validateCommand);

program
  .command("generate")
  .option("-c, --config <file>", "config file", "rules.config.json")
  .option("-m, --mapping <file>", "mapping file", ".zod-mapping.json")
  .option("-o, --out <file>", "output rules", "firestore.rules")
  .action(_generateCommand);

program.parse(process.argv);

// #!/usr/bin/env node
// const { Command } = require("commander");
// const path = require("path");

// const { initCommand } = require("./commands/init");
// const { scanZodCommand } = require("./commands/scanZod");
// const { validateCommand } = require("./commands/validate");
// const { generateCommand } = require("./commands/generator");

// const program = new Command();

// program
//   .name("frcli")
//   .version("1.0.0")
//   .description(
//     "Generate Firestore rules from rules.config.json + Zod (@AppSec)"
//   );

// program
//   .command("init")
//   .description("Create example rules.config.json in the current directory")
//   .option("-o, --out <file>", "output filename", "rules.config.json")
//   .action((opts: { out: string }) => {
//     const fs = require("fs");
//     const readline = require("readline");

//     const target = opts.out || "rules.config.json";

//     // Exists?
//     if (fs.existsSync(target)) {
//       console.log(`${target} already exists.`);
//       return;
//     }

//     // Ask user
//     const rl = readline.createInterface({
//       input: process.stdin,
//       output: process.stdout,
//     });

//     rl.question(
//       `${target} does not exist. Create it now? (y/n) `,
//       async (answer: string) => {
//         rl.close();
//         if (answer.toLowerCase() === "y") {
//           await initCommand(opts);
//         } else {
//           console.log("Aborted.");
//         }
//       }
//     );
//   });

// program
//   .command("scan-zod")
//   .description("Scan TS files for Zod schemas flagged with @AppSec")
//   .option("-p, --pattern <glob>", "glob pattern for TS files", "src/**/*.ts")
//   .option("-o, --out <file>", "output mapping file", ".zod-mapping.json")
//   .action((opts: string) => scanZodCommand(opts));

// program
//   .command("validate")
//   .description("Validate rules.config.json against mapping")
//   .option("-c, --config <file>", "config file", "rules.config.json")
//   .option("-m, --mapping <file>", "zod mapping file", ".zod-mapping.json")
//   .action((opts: string) => validateCommand(opts));

// program
//   .command("generate")
//   .description("Generate firestore.rules from config + mapping")
//   .option("-c, --config <file>", "config file", "rules.config.json")
//   .option("-m, --mapping <file>", "zod mapping file", ".zod-mapping.json")
//   .option("-o, --out <file>", "output rules file", "firestore.rules")
//   .action((opts: string) => generateCommand(opts));

// program.parse(process.argv);
