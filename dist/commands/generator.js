"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fsGen = require("fs/promises");
module.exports = async function generate(opts) {
    const cfg = JSON.parse(await fsGen.readFile(opts.config, "utf8"));
    const mapping = JSON.parse(await fsGen.readFile(opts.mapping, "utf8"));
    const out = [];
    out.push("rules_version = '2';");
    out.push("service cloud.firestore {");
    out.push("  match /databases/{database}/documents {");
    out.push("    function isSignedIn() { return request.auth != null; }");
    for (const col of cfg.collections) {
        out.push(`    match /${col.path} {`);
        out.push(`      allow get, list: if isSignedIn();`);
        out.push(`      allow create: if isSignedIn() && request.auth.uid == request.resource.data.${col.ownerField};`);
        const schemaMap = mapping[col.schema];
        if (schemaMap && schemaMap.fields) {
            const required = Object.entries(schemaMap.fields)
                .filter(([_, v]) => v.required === true)
                .map(([k]) => k);
            if (required.length > 0) {
                out.push(`      function hasRequired_${col.schema}() {`);
                out.push("        return " +
                    required
                        .map((f) => `request.resource.data.keys().has("${f}")`)
                        .join(" && ") +
                    ";");
                out.push("      }");
                out.push(`      allow create: if isSignedIn() && hasRequired_${col.schema}();`);
            }
        }
        out.push("    }");
    }
    out.push("  }");
    out.push("}");
    await fsGen.writeFile(opts.out, out.join("\n"));
    console.log("firestore.rules written.");
};
