"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/commands/init.ts
const { writeJSON, fileExists } = require("../core/fileUtils");
function initCommand(opts) {
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
