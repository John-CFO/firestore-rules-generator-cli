# Firestore Rules CLI — README

`frcli` scans Zod schemas marked with `@AppSec` and generates Firestore rules from them. The focus is on **predictability**: better to mark a field as "must be checked manually" than to generate a rule that silently pretends to be correct.

The CLI does not replace Cloud Functions. It produces a starting point that forces the user to think about trust boundaries and business logic.

---

## Table of Contents

1. [What the CLI does](#1-what-the-cli-does)
2. [What the CLI does not do](#2-what-the-cli-does-not-do)
3. [Installation](#3-installation)
4. [Commands](#4-commands)
5. [`rules.config.json` — Format](#5-rulesconfigjson--format)
6. [`.zod-mapping.json` — Format](#6-zod-mappingjson--format)
7. [Automatically recognized Zod patterns](#7-automatically-recognized-zod-patterns)
8. [Zod patterns that must be checked manually (`requiresManual`)](#8-zod-patterns-that-must-be-checked-manually-requiresmanual)
9. [Generated Firestore rules — structure](#9-generated-firestore-rules--structure)
10. [Workflow](#10-workflow)
11. [Important notes before deploying](#11-important-notes-before-deploying)
12. [Troubleshooting](#12-troubleshooting)
13. [.gitignore](#13-gitignore)
14. [Project tree](#14-project-tree)
15. [License](#15-license)

---

## 1. What the CLI does

- **Discover**: scans source files for Firestore `doc()` / `collection()` calls via `ts-morph`, extracts the collection hierarchy, and writes a suggested config to `rules.config.json.suggested`. Conservative defaults: all schemas marked `REPLACE_WITH_SCHEMA_NAME`, all `allow` flags except `read` set to `false`. Does **not** overwrite `rules.config.json` — the user reviews and merges manually.
- **Scan**: finds exported variables with the `@AppSec` JSDoc tag, parses their initializer via `ts-morph`, and extracts type, required status, nested objects, `min`/`max`, `regex`, `enum`, `nullable`, and `strict`.
- **Validate**: checks that all schemas referenced in `rules.config.json` exist in the mapping before generation starts.
- **Generate**: produces a `firestore.rules` file with:
  - `isSignedIn()` and `isOwner(userId)` helpers
  - a `match /security/{document=**}` deny block
  - nested `match` blocks matching the config hierarchy
  - per collection: `hasRequired_<Schema>()` with type checks, `min`/`max`, `regex`, `enum`, and `nullable`
  - `allow` lines for `read`, `list`, `create`, `update`, `delete`
  - a `REQUIRES MANUAL` comment block above each `match` when the schema is `strict` or contains `requiresManual` fields. The block lists the affected fields and (for `strict`) a commented-out `hasOnly` suggestion.

All generated comments are ASCII so they remain readable in any console and any CI log.

---

## 2. What the CLI does not do

- **Does not translate business logic.** `.refine()`, `.superRefine()`, `.transform()`, `z.email()`, `z.url()`, `z.uuid()`, etc. are marked as `requiresManual` and commented in the output. The user implements them themselves.
- **Does not generate `hasOnly` automatically.** `.strict()` schemas receive a commented-out suggestion that the user must consciously activate.
- **Does not guess server fields.** If the document contains fields that are not in the Zod schema (e.g. `createdAt`, `updatedAt`, `uid`), they do not appear in the rules. With `.strict()`, the user must add them manually to the `hasOnly` whitelist.
- **No cross-document checks.** Rules such as "`projectId` must exist in `Projects/{projectId}`" cannot be expressed with Firestore rules alone.
- **Not a Cloud Function replacement.** If the actual validation runs in Cloud Functions (because the client does not write directly), the generated field checks are redundant. See Section 11.
- **`discover` does not assign schemas to collections.** It cannot know that `FirestoreUserUpdateSchema` belongs to `Users/{userId}` — that is an application-level decision. The output uses `REPLACE_WITH_SCHEMA_NAME` as a placeholder, and the user assigns each schema manually. `validate` lists available schemas when a placeholder remains.
- **`discover` uses the parameter names found in code.** If your code uses `note.id`, the suggested path is `Notes/{id}`. If it uses `targetDay`, the suggested path is `WorkHours/{targetDay}`. The tool does not guess semantic names — rename them in `rules.config.json` if you prefer different identifiers. Firestore only cares about the structure, not the parameter names.
- **No `customChecks` support.** The field is currently not processed. Custom conditions must be added manually to the generated file.

---

## 3. Installation

Prerequisite: Node.js 20+, a project with `tsconfig.json`.

As a devDependency in the target project:

```powershell
cd C:\Path\to\my-project
npm install --save-dev C:\Path\to\firestore-rules-cli
```

Or via `npm link` for live development on the CLI:

```powershell
cd C:\Path\to\firestore-rules-cli
npm install
npm run build
npm link

cd C:\Path\to\my-project
npm link firestore-rules-cli
```

Then in the target project:

```powershell
npx frcli --help
```

Directly from the CLI repo (without `npm link`):

```powershell
node dist/cli.js --help
```

---

## 4. Commands

### `frcli discover [-p "**/*.{ts,tsx}"] [-o rules.config.json.suggested]`

Scans source files for Firestore `doc()` and `collection()` calls, extracts the collection hierarchy, and writes a suggested config.

- **Default pattern**: `**/*.{ts,tsx}` — relative to the current working directory.
- **Default output**: `rules.config.json.suggested`.

The command does **not** write to `rules.config.json` directly. It writes a `.suggested` file that you review and merge manually.

**What it extracts:**

- `doc(db, "Users", uid, "Services", sid)` → `Users/{uid}/Services/{sid}`
- `collection(db, "Users", uid, "Services")` → `Users/{uid}/Services`
- Paths are merged by collection name: `Users/{uid}` and `Users/{userId}` become one node, preferring the more descriptive parameter name.

**What it does not do:**

- Does not assign schemas. All collections get `"schema": "REPLACE_WITH_SCHEMA_NAME"`.
- Does not set `allow` flags meaningfully. All default to `read: true`, rest `false`.
- Does not resolve wrapper functions like `fetchProjectsApi(serviceId)`. If the actual `doc()` call is inside the wrapper's implementation, the path is found when that file is scanned — but if the wrapper builds the path dynamically, it may be missed.

**Review checklist after running `discover`:**

1. Every collection your app touches must appear in the output. If one is missing, the wrapper hiding it is too complex — add it manually.
2. Replace `REPLACE_WITH_SCHEMA_NAME` with the correct schema from `.zod-mapping.json`.
3. Adjust `allow` flags per collection.
4. Rename `{id}` / `{uid}` / `{targetDay}` parameters if you prefer semantic names.
5. Copy the result into `rules.config.json` (or start from it) and run `validate` → `generate`.

### `frcli init [-o rules.config.json]`

Creates a template for `rules.config.json` in the current directory.

### `frcli scan-zod [-p "**/*.ts"] [-o .zod-mapping.json]`

Scans TypeScript files for exported variables with the `@AppSec` JSDoc tag.
Writes the result as `.zod-mapping.json` in the current directory.

- **Default pattern**: `**/*.ts` — relative to the current working directory.
- **Default output**: `.zod-mapping.json`.

The pattern is matched against the include set of `tsconfig.json`. Files excluded there (e.g. `node_modules`) are ignored.

**Examples:**

```powershell
# Standard case: all .ts files in the project root and subfolders
# that are not excluded by tsconfig
npx frcli scan-zod

# Only one subfolder
npx frcli scan-zod --pattern "validation/**/*.ts"

# Multiple folders via a common prefix
npx frcli scan-zod --pattern "src/**/*.ts"

# Different output path
npx frcli scan-zod --pattern "**/*.ts" -o ./build/zod-mapping.json
```

If your project has no `src/` folder and the schemas live under `validation/`, for example, then `--pattern "validation/**/*.ts"` is the usual invocation. In large projects, it's worth narrowing the pattern to the folder containing the `@AppSec` schemas — this makes the scan faster.

### `frcli validate [-c rules.config.json] [-m .zod-mapping.json]`

Checks that all schemas referenced under `schema` in `rules.config.json` are present in the mapping. Exits with code 1 if a schema is missing.

### `frcli generate [-c rules.config.json] [-m .zod-mapping.json] [-o firestore.rules]`

Reads config and mapping and writes the generated `firestore.rules` to the target directory.

---

## 5. `rules.config.json` — Format

The config describes the Firestore tree and the access rules per collection.

```json
{
  "collections": [
    {
      "path": "Users/{userId}",
      "ownerField": "userId",
      "schema": "FirestoreUserUpdateSchema",
      "allow": { "read": true, "create": true, "update": true },
      "subcollections": [
        {
          "path": "Services/{serviceId}",
          "schema": "HourlyRateSchema",
          "allow": { "read": true, "create": true },
          "subcollections": [
            {
              "path": "Projects/{projectId}",
              "schema": "ProjectStateSchema",
              "allow": {
                "read": true,
                "create": true,
                "update": true,
                "delete": true
              },
              "subcollections": [
                {
                  "path": "WorkHours/{workHourId}",
                  "schema": "TimerAndEarningsSchema",
                  "allow": {
                    "read": true,
                    "create": true,
                    "update": true,
                    "delete": true
                  }
                }
              ]
            },
            {
              "path": "Vacations/{vacationId}",
              "schema": "VacationInputSchema",
              "allow": {
                "read": true,
                "create": true,
                "update": true,
                "delete": true
              }
            },
            {
              "path": "Notes/{noteId}",
              "allow": {
                "read": true,
                "create": true,
                "update": true,
                "delete": true
              }
            }
          ]
        }
      ]
    }
  ]
}
```

### Fields

| Field            | Required | Description                                                                                                                                               |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`           | yes      | Firestore path with `{param}` placeholders. For subcollections, **relative** to the parent (only the last segment, e.g. `Services/{serviceId}`).          |
| `ownerField`     | no       | Name of the field that contains the owner variable (e.g. `"userId"`). Used for `isOwner(userId)` checks. **Inherits to subcollections** if not set there. |
| `schema`         | no       | Name of a schema from `.zod-mapping.json`. If omitted, no field validation is generated — only `allow` lines.                                             |
| `allow`          | no       | Per-operation flags. See below.                                                                                                                           |
| `subcollections` | no       | Array of subcollection objects, same structure as above.                                                                                                  |
| `customChecks`   | no       | **Not implemented.** Currently ignored. Do not use.                                                                                                       |

### `allow` defaults

If `allow` is omitted, the following applies:

```json
{ "read": true, "list": false, "create": true, "update": true, "delete": false }
```

If `allow` is set but individual flags are missing, the defaults apply only to the missing fields — all present fields are overwritten.

### Important rule

**Every collection your app touches must be listed in the config.**
Collections that are not listed do not appear in the generated tree and are denied by Firestore by default.

If a collection has no `@AppSec` schema (because validation happens in a Cloud Function, for example), omit the `schema` field and use only `allow`.

### Building the config from your existing code

If you don't have hand-written Firestore rules yet, `discover` can suggest a starting tree:

```powershell
npx frcli discover
```

This writes `rules.config.json.suggested`, which you then edit:

1. Replace `REPLACE_WITH_SCHEMA_NAME` per collection with the correct schema from `.zod-mapping.json`. Run `npx frcli validate` after editing — it lists available schemas if a placeholder remains.
2. Set `allow` flags per collection based on your access policy.
3. Rename parameters (`{id}`, `{targetDay}`) if you prefer different names.
4. Copy the result to `rules.config.json`.

Collections without an `@AppSec` schema (e.g. where validation happens in a Cloud Function) should have the `schema` field **omitted entirely** — not set to a placeholder.

---

## 6. `.zod-mapping.json` — Format

`scan-zod` creates one entry per schema found:

```json
{
  "FirestoreUserUpdateSchema": {
    "fields": {
      "displayName": {
        "type": "string",
        "required": false,
        "hasComplexCheck": true,
        "complexCheckWarning": "Complex validation (refine) detected"
      },
      "photoURL": {
        "type": "string",
        "required": false,
        "hasComplexCheck": true,
        "complexCheckWarning": "z.url() requires manual regex implementation"
      }
    },
    "strict": true,
    "raw": "z.object({...}).strict()",
    "requiresManual": {
      "displayName": { "...": "..." },
      "photoURL": { "...": "..." }
    }
  }
}
```

### Field attributes

| Attribute             | Type     | Meaning                                                                                         |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `type`                | string   | `"string"`, `"number"`, `"boolean"`, `"timestamp"`, `"object"`, `"array"`, `"unknown"`, `"any"` |
| `required`            | boolean  | `false` for `.optional()`                                                                       |
| `nullable`            | boolean  | `true` for `.nullable()` — value may be `null`                                                  |
| `enum`                | string[] | Values from `z.enum([...])`                                                                     |
| `min` / `max`         | number   | Numeric constraints or string length                                                            |
| `regex`               | string   | Regex literal as a string (with slashes)                                                        |
| `ref`                 | string   | When referencing another schema                                                                 |
| `fields`              | object   | For nested objects                                                                              |
| `hasComplexCheck`     | boolean  | `true` for `.refine()`, `.transform()`, `z.email()`, `z.url()`, etc.                            |
| `complexCheckWarning` | string   | Description of what needs manual checking                                                       |

### Schema attributes

| Attribute        | Type    | Meaning                                              |
| ---------------- | ------- | ---------------------------------------------------- |
| `strict`         | boolean | `true` if `.strict()` on the top-level object        |
| `raw`            | string  | The original Zod expression (for traceability)       |
| `requiresManual` | object  | All fields with `hasComplexCheck: true`, listed flat |

---

## 7. Automatically recognized Zod patterns

| Zod                | Firestore rules translation                               |
| ------------------ | --------------------------------------------------------- |
| `z.string()`       | `is string`                                               |
| `z.number()`       | `is number`                                               |
| `z.boolean()`      | `is bool`                                                 |
| `z.date()`         | `is timestamp`                                            |
| `z.object({...})`  | `is map` + recursive field checks                         |
| `z.array(...)`     | `is list`                                                 |
| `z.enum([...])`    | `in ["a", "b", ...]`                                      |
| `.min(n)` (number) | `>= n`                                                    |
| `.max(n)` (number) | `<= n`                                                    |
| `.min(n)` (string) | `.size() >= n`                                            |
| `.max(n)` (string) | `.size() <= n`                                            |
| `.regex(/.../)`    | `.matches("...")`                                         |
| `.optional()`      | `!has(...) \|\|`                                          |
| `.nullable()`      | `== null \|\|`                                            |
| `.strict()`        | `hasComplexCheck` + hint, `hasOnly` suggestion in comment |
| `.default(...)`    | Ignored (Firestore has no defaults)                       |

Arrow-function wrappers (`() => z.object({...})`) are automatically unwrapped.

---

## 8. Zod patterns that must be checked manually (`requiresManual`)

These patterns are recognized but **not** translated. They appear as a comment block above the respective `match` block:

| Zod                                               | Reason                                             |
| ------------------------------------------------- | -------------------------------------------------- |
| `.refine()`                                       | Arbitrary JS logic, no Firestore equivalent        |
| `.superRefine()`                                  | As above, multi-step                               |
| `.transform()`                                    | Changes type/semantics, Firestore cannot transform |
| `.preprocess()`                                   | Like `transform`                                   |
| `z.email()` / `z.url()` / `z.uuid()` / `z.cuid()` | No built-in regex — user decides                   |
| `z.record()` / `z.map()`                          | Dynamic keys, not mappable                         |
| Reference to another schema (`ref`)               | CLI does not expand, user checks the relationship  |
| Array-of-objects                                  | Element checks are business logic                  |
| `.strict()`                                       | `hasOnly` whitelist is policy, not automatic       |

---

## 9. Generated Firestore rules — structure

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return request.auth != null && request.auth.uid == userId;
    }

    match /security/{document=**} {
      allow read, write: if false;
    }

    match /Users/{userId} {
      // ------------------------------------------------------------
      // WARNING: REQUIRES MANUAL - schema: FirestoreUserUpdateSchema
      // ------------------------------------------------------------
      // .strict() detected - define the field whitelist yourself.
      // Candidates: displayName, personalNumber, photoURL
      // (add server-managed fields like uid, createdAt if present)
      //
      // - displayName: Complex validation (refine) detected
      // - personalNumber: Complex validation (refine) detected
      // - photoURL: z.url() requires manual regex implementation
      //
      // Suggested create rule (uncomment and adapt):
      // // allow create: if isOwner(userId)
      // //   && request.resource.data.keys().hasOnly([...]);
      // ------------------------------------------------------------
      function hasRequired_FirestoreUserUpdateSchema() {
        return (...);
      }
      allow read:   if isOwner(userId);
      allow list:   if false;
      allow create: if isOwner(userId) && hasRequired_FirestoreUserUpdateSchema();
      allow update: if isOwner(userId) && hasRequired_FirestoreUserUpdateSchema();
      allow delete: if false;

      match /Services/{serviceId} { ... }
    }
  }
}
```

The `REQUIRES MANUAL` blocks are the most important part. They show the user where follow-up work is needed and, for `.strict()`, suggest a concrete `hasOnly` expression that the user can uncomment and adapt.

---

## 10. Workflow

### In the target project

#### Option A — you already have a hand-written `rules.config.json`

```powershell
# 1. Collect all @AppSec schemas
npx frcli scan-zod

# 2. Validate config against mapping
npx frcli validate

# 3. Generate rules
npx frcli generate
```

#### Option B — start from your existing code

```powershell
# 1. Collect all @AppSec schemas
npx frcli scan-zod

# 2. Discover your collection tree from doc()/collection() calls
npx frcli discover

# 3. Edit rules.config.json.suggested:
#    - assign schemas per collection
#    - adjust allow flags
#    - copy to rules.config.json when done

# 4. Validate
npx frcli validate

# 5. Generate rules
npx frcli generate
```

### Review and roll out

```powershell
# 4. Diff against the current firebase-rules/firestore.rules
#    (or wherever your firebase.json points)
Compare-Object (Get-Content firebase-rules/firestore.rules) (Get-Content firestore.rules)

# 5. Go through all REQUIRES MANUAL blocks and adjust as needed

# 6. Check syntax against Firebase (no live deploy!)
npm exec -- firebase deploy --only firestore:rules --dry-run

# 7. Emulator test against real writes
npm exec -- firebase emulators:start --only firestore

# 8. Only then go live
npm exec -- firebase deploy --only firestore:rules
```

**Note:** `npm exec` without `--` swallows Firebase flags. Always use `npm exec -- firebase ...` or `npx firebase ...`.

---

## 11. Important notes before deploying

### The generated rules are stricter than hand-written ones

If your previous rules were only access control (e.g. `allow read: if isOwner(userId)`), the CLI adds **field validation**. A client that previously got through can be rejected because a field does not match the Zod type. This is intentional, but it is a difference you need to be aware of.

### Consider the Cloud Function model

If writes do not happen directly from the client but via Cloud Functions (the Admin SDK bypasses the rules entirely), the generated field checks are redundant. In that case:

- Use rules as a pure access-control layer
- Omit `schema` per collection in the config
- Leave the actual validation in the Cloud Function

The CLI currently has **no** option to disable field validation per collection while still listing the schema. Workaround: do not set `schema` and keep the Zod information only as documentation.

### Server fields with `.strict()`

If a schema uses `.strict()` but the document contains additional fields (e.g. `uid`, `createdAt`, `updatedAt`), the user must add these to the `hasOnly` expression when activating the suggestion. The comment block points this out.

### The `security` block is not a global deny-all

The generated file contains:

```rules
match /security/{document=**} {
  allow read, write: if false;
}
```

This block protects **only** documents under the path `/security/...` in your database. It is not a global safeguard. All other collections need their own `allow` rules — which the generator covers through `rules.config.json`.

### Collections must be complete

If a collection or subcollection is missing from the config, it is also missing from the rules. Firestore will then deny all access to it. Before deploying: check the config line by line against the real backend structure.

---

## 12. Troubleshooting

### `Cannot find module 'figures'` or `ERR_REQUIRE_ESM`

The CLI uses CommonJS. `figures` must be installed in version 3.x, `chalk` in version 4.x:

```powershell
npm install chalk@4 figures@3.2.0
```

### `Schema referenced in config does not exist in mapping`

`scan-zod` did not find the schema. Common causes:

- The `@AppSec` tag is not directly above the `export const`.
- The schema name in the config is a typo.
- The file lies outside the `--pattern` range.
- The project has no `src/` folder and the scan ran without `--pattern` (the default is `**/*.ts`, but files outside the `tsconfig` include set are ignored).

### `Found 0 Zod schemas`

Usually a pattern problem. Causes:

- The `@AppSec` schemas live in a folder that is not covered by the pattern (e.g. `validation/` instead of `src/`). Specify explicitly: `--pattern "validation/**/*.ts"`.
- `tsconfig.json` excludes the folder.
- The file is not a `.ts` file (`.tsx` is currently not matched).

### `discover` finds fewer collections than expected

`discover` only sees `doc()` / `collection()` calls with string-literal or simple-variable arguments. Causes for missing paths:

- **Wrapper functions**: `fetchProjects(serviceId)` hides the actual `doc(db, "Users", uid, "Services", sid, "Projects")` in another file. The path is found when that file is scanned — but only if the wrapper file is within the pattern range.
- **Template literals**: `doc(db, `Users/${uid}/Services`)` is not resolvable. `discover` emits a warning and skips it. Refactor to multi-arg form (`doc(db, "Users", uid, "Services")`) to fix.
- **Dynamic paths from config**: `doc(db, getPath())` cannot be resolved at scan time.

Check the warning list printed after `discover` for skipped arguments.

### `discover` output contains `REPLACE_WITH_SCHEMA_NAME`

Expected. The command does not know which schema belongs to which collection — that's an application decision. See Section 5 for how to assign schemas.

### `Dry run complete!` with many "Invalid function name: has" warnings

These warnings are false positives from the Firebase CLI linter. The decisive line is `cloud.firestore: rules file ... compiled successfully`. If it is there, the file is valid.

### `Unused function: isSignedIn`

Appears when every collection uses `ownerField`. Cosmetic. Optionally: remove the `isSignedIn` block in `generate.ts`.

### Generated rules differ from hand-written ones

Expected. The generated rules include field validation. If you only want access control, omit `schema` per collection.

### `no such file or directory, open '.zod-mapping.json'`

`generate` is running without a prior `scan-zod`. Scan first, then generate.

---

## 13. .gitignore

The following artifacts are generated and do not belong in the target project's repository:

```gitignore
.zod-mapping.json
firestore.rules
rules.config.json.suggested
```

`rules.config.json.suggested` is a temporary working file produced by `discover`. Once you've copied your edits into `rules.config.json`, delete the `.suggested` file or leave it gitignored.

`rules.config.json` is hand-written and **should** be committed to the repository — otherwise every team member has to rebuild it.

---

## 14. Project tree

```
firestore-rules-cli/
├─ src/
│  ├─ cli.ts                     # CLI entrypoint (CommonJS, shebang)
│  ├─ commands/
│  │  ├─ discover.ts             # Suggests rules.config.json from source scan
│  │  ├─ init.ts
│  │  ├─ scanZod.ts
│  │  ├─ validate.ts
│  │  └─ generate.ts
│  ├─ core/
│  │  ├─ structureDiscovery.ts   # doc()/collection() scan + tree builder
│  │  ├─ zodParser.ts            # ts-morph-based Zod parser
│  │  ├─ ruleCompiler.ts         # Zod field → Firestore expression
│  │  └─ fileUtils.ts            # JSON I/O
│  └─ types/
│     ├─ Config.ts
│     ├─ Mapping.ts
│     └─ GeneratorOpts.d.ts
├─ dist/                         # Build output (tsc)
│  └─ cli.js                     # bin target
├─ package.json
└─ README.md
```

---

## 15. License

MIT.
