// src/commands/init.ts
const { writeJSON, fileExists } = require("../core/fileUtils");

export interface InitOpts {
  out?: string;
}

function initCommand(opts: InitOpts) {
  const out = opts.out || "rules.config.json";

  if (fileExists(out)) {
    console.log(`${out} already exists.`);
    return;
  }

  const example = {
    collections: [
      {
        path: "users/{userId}",
        ownerField: "userId",
        schema: "UserSchema",
        customChecks: ["isOwner()"],
      },
    ],
  };

  writeJSON(out, example);
  console.log(`Created ${out}`);
}

module.exports = { initCommand };
