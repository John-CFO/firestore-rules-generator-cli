// src/commands/init.ts

// imported modules
const chalk = require("chalk");
const figures = require("figures");
const { writeJSON, fileExists } = require("../core/fileUtils");

// interface
export interface InitOpts {
  out?: string;
}

// --- Initialize Command Function ---
async function initCommand(opts: InitOpts) {
  const out = opts.out || "rules.config.json";

  if (fileExists(out)) {
    console.log(chalk.yellow(`${figures.warning} ${out} already exists.`));
    return;
  }

  const example = {
    collections: [
      {
        path: "Users/{userId}",
        ownerField: "userId",
        schema: "REPLACE_WITH_SCHEMA_NAME",
        allow: { read: true, create: true, update: true },
        subcollections: [
          {
            path: "Subcollection/{subId}",
            schema: "REPLACE_WITH_SCHEMA_NAME",
            allow: { read: true, create: true },
          },
        ],
      },
    ],
  };

  writeJSON(out, example);
  console.log(chalk.green(`${figures.tick} Created template config: ${out}`));
  console.log(
    chalk.blue(
      `ℹ Adjust the collections and subcollections to match your backend structure.`,
    ),
  );
  console.log(
    chalk.blue(
      `ℹ "schema" must match a key from .zod-mapping.json (run "frcli scan-zod" first).`,
    ),
  );
  console.log(
    chalk.blue(
      `ℹ Omit "schema" for collections that have no @AppSec Zod schema.`,
    ),
  );
  console.log(
    chalk.blue(
      `ℹ Every collection your app touches must be listed — otherwise it stays locked.`,
    ),
  );
}
module.exports = { initCommand };
