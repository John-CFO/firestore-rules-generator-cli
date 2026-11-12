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
8. [Zod patterns that must be checked manually](#8-zod-patterns-that-must-be-checked-manually-requiresmanual)
9. [Generated Firestore rules — structure](#9-generated-firestore-rules--structure)
10. [Workflow](#10-workflow)
11. [Important notes before deploying](#11-important-notes-before-deploying)
12. [Troubleshooting](#12-troubleshooting)
13. [.gitignore](#13-gitignore)
14. [Project tree](#14-project-tree)
15. [License](#15-license)

---

## 1. What the CLI does

- **Discover**: scans source files for Firestore `doc()` / `collection()` calls via `ts-morph`, extracts the collection hierarchy, and writes a suggested config to `rules.config.json.suggested`. Conservative defaults: all schemas marked `REPLACE_WITH_SCHEMA_NAME`, all `allow` flags except `read` set to `false`. Does **not** overwrite `rules.config.json`. At the end of each run it lists every schema from `.zod-mapping.json` so the user knows what can be assigned where.
- **Scan**: finds exported variables with the `@AppSec` JSDoc tag, parses their initializer via `ts-morph`, and extracts type, required status, nested objects, `min`/`max`, `regex`, `enum`, `nullable`, and `strict`.
- **Validate**: checks that all schemas referenced in `rules.config.json` exist in the mapping. On failure it prints the full collection path for each missing schema and lists all available schemas. Collections without a `schema` field trigger a warning, not an error.
- **Generate**: produces a `firestore.rules` file with:
  - `isSignedIn()` and `isOwner(userId)` helpers
  - a `match /security/{document=**}` deny block
  - nested `match` blocks matching the config hierarchy (any depth)
  - per collection: `hasRequired_<Schema>()` with type checks, `min`/`max`, `regex`, `enum`, and `nullable`
  - `allow` lines for `read`, `list`, `create`, `update`, `delete`
  - a `REQUIRES MANUAL` comment block above each `match` when the schema is `strict` or contains `requiresManual` fields

All generated comments are ASCII so they remain readable in any console and any CI log.

---

## 2. What the CLI does not do

- **Does not translate business logic.** `.refine()`, `.superRefine()`, `.transform()`, `z.email()`, `z.url()`, `z.uuid()`, etc. are marked as `requiresManual` and commented in the output. The user implements them themselves.
- **Does not generate `hasOnly` automatically.** `.strict()` schemas receive a commented-out suggestion that the user must consciously activate.
- **Does not guess server fields.** Fields not in the Zod schema (e.g. `createdAt`, `updatedAt`, `uid`) do not appear in the rules. With `.strict()`, the user must add them manually to the `hasOnly` whitelist.
- **No cross-document checks.** Rules such as "`projectId` must exist in `Projects/{projectId}`" cannot be expressed with Firestore rules alone.
- **Not a Cloud Function replacement.** If the actual validation runs in Cloud Functions (the Admin SDK bypasses the rules entirely), the generated field checks are redundant. See Section 11.
- **`discover` does not assign schemas to collections.** It cannot know that `PostSchema` belongs to `Posts/{postId}` — that is an application-level decision. The output uses `REPLACE_WITH_SCHEMA_NAME`; the user assigns each schema manually. `discover` lists available schemas at the end of its run.
- **`discover` uses the parameter names found in code.** If your code uses `post.id`, the suggested path is `Posts/{id}`. If it uses `targetDay`, it is `WorkHours/{targetDay}`. The tool does not guess semantic names — rename them in `rules.config.json` if you prefer different identifiers. Firestore only cares about structure, not parameter names.
- **`validate` only checks one direction.** It verifies that every `schema` referenced in the config exists in the mapping. It does **not** verify that every collection in your source code is present in the config. That direction is the responsibility of `discover` and manual review.
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

### Install `firebase-tools` locally (for the deploy workflow)

The CLI itself does not need `firebase-tools`, but the workflow in Section 10 does. Install it once per target project:

```powershell
cd C:\Path\to\my-project
npm install --save-dev firebase-tools
```

A local install pins the version in `package.json` and makes `npm exec -- firebase ...` find the binary reliably. Don't rely on a global install.

### Verify installation

From the target project:

```powershell
npm exec -- frcli --help
```

Directly from the CLI repo (without `npm link`):

```powershell
node dist/cli.js --help
```

---

## 4. Commands

### `frcli init [-o rules.config.json]`

Creates a template for `rules.config.json` in the current directory. The template contains placeholder collection names and schema names; it is **not** a working config until you replace them.

### `frcli scan-zod [-p "**/*.ts"] [-o .zod-mapping.json]`

Scans TypeScript files for exported variables with the `@AppSec` JSDoc tag. Writes the result as `.zod-mapping.json` in the current directory.

- **Default pattern**: `**/*.ts` — relative to the current working directory.
- **Default output**: `.zod-mapping.json`.

The pattern is matched against the include set of `tsconfig.json`. Files excluded there (e.g. `node_modules`) are ignored.

**Examples:**

```powershell
# All .ts files in the project root and subfolders, excluding node_modules
npm exec -- frcli scan-zod

# Only one subfolder
npm exec -- frcli scan-zod --pattern "validation/**/*.ts"

# Different output path
npm exec -- frcli scan-zod --pattern "**/*.ts" -o ./build/zod-mapping.json
```

Narrow the pattern to the folder that actually contains your `@AppSec` schemas — this makes the scan faster and avoids picking up unrelated schemas.

### `frcli discover [-p "**/*.{ts,tsx}"] [-o rules.config.json.suggested]`

Scans source files for Firestore `doc()` and `collection()` calls, extracts the collection hierarchy, and writes a suggested config.

- **Default pattern**: `**/*.{ts,tsx}` — relative to the current working directory.
- **Default output**: `rules.config.json.suggested`.

The command does **not** write to `rules.config.json` directly. It writes a `.suggested` file that you review and merge manually.

**What it extracts:**

- `doc(db, "Posts", postId, "Comments", commentId)` → `Posts/{postId}/Comments/{commentId}`
- `collection(db, "Posts", postId, "Comments")` → `Posts/{postId}/Comments`
- Paths are merged by collection name: `Posts/{id}` and `Posts/{postId}` become one node, preferring the more descriptive parameter name.

**What it does not do:**

- Does not assign schemas. All collections get `"schema": "REPLACE_WITH_SCHEMA_NAME"`.
- Does not set `allow` flags meaningfully. All default to `read: true`, rest `false`.
- Does not resolve wrapper functions like `fetchPostsApi(userId)`. If the actual `doc()` call is inside the wrapper's implementation, the path is found when that file is scanned — but if the wrapper builds the path dynamically, it may be missed.

**Schema report at the end of each run:**

After writing the suggested config, `discover` prints every schema from `.zod-mapping.json` with field count and manual-check count:

```
ℹ Available schemas from .zod-mapping.json:
  - PostSchema (7 fields)
  - CommentSchema (3 fields (1 require manual))
  ...
```

If `.zod-mapping.json` does not exist, it prints a single warning pointing to `scan-zod`. Run `scan-zod` before `discover` if you want this list.

**Review checklist after running `discover`:**

1. Every collection your app touches must appear in the output. If one is missing, the wrapper hiding it is too complex — add it manually.
2. Replace `REPLACE_WITH_SCHEMA_NAME` with the correct schema from `.zod-mapping.json`.
3. Adjust `allow` flags per collection.
4. Rename parameters (`{id}`, `{uid}`) if you prefer semantic names.
5. Copy the result into `rules.config.json` and run `validate` → `generate`.

### `frcli validate [-c rules.config.json] [-m .zod-mapping.json]`

Checks that all schemas referenced under `schema` in `rules.config.json` are present in the mapping.

**On failure** (schema name not found):

- Prints the full collection path for each failure — e.g. `Posts/{postId}/Comments/{commentId}`
- Lists all schemas that _are_ available in the mapping
- Exits with code 1

**On success with warnings** (collection has no `schema` field):

- Prints a warning for each collection without a `schema` field
- Does **not** exit with an error — a collection without field validation is valid when validation happens in a Cloud Function
- Exits with code 0

**On success without warnings:** prints `Validation passed ✅`.

### `frcli generate [-c rules.config.json] [-m .zod-mapping.json] [-o firestore.rules]`

Reads config and mapping and writes the generated `firestore.rules` to the target directory.

Collections without a `schema` field produce `allow create` / `allow update` lines with only the owner check — no trailing `&& true`.

---

## 5. `rules.config.json` — Format

The config describes the Firestore tree and the access rules per collection. Its shape mirrors your actual Firestore hierarchy — no fixed collection names, no assumed depth, no required structure beyond what you write.

The example below is a generic illustration (posts with nested comments and reactions). Your own project's collection names, nesting depth, and field names are entirely yours — the format is the same.

```json
{
  "collections": [
    {
      "path": "Posts/{postId}",
      "ownerField": "postId",
      "schema": "PostSchema",
      "allow": { "read": true, "create": true, "update": true },
      "subcollections": [
        {
          "path": "Comments/{commentId}",
          "schema": "CommentSchema",
          "allow": { "read": true, "create": true },
          "subcollections": [
            {
              "path": "Reactions/{reactionId}",
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
    },
    {
      "path": "Settings/{settingId}",
      "schema": "SettingsSchema",
      "allow": { "read": true, "update": true }
    }
  ]
}
```

Note: `Reactions` has no `schema` field. That means validation for reactions is expected to happen elsewhere (e.g. a Cloud Function), and only `allow` lines are generated for it.

### Fields

| Field            | Required | Description                                                                                                                                              |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`           | yes      | Firestore path segment with `{param}` placeholders. For subcollections, **relative** to the parent (only the last segment, e.g. `Comments/{commentId}`). |
| `ownerField`     | no       | Name of the field that holds the owner variable (e.g. `"userId"`). Used for `isOwner(userId)` checks. **Inherits to subcollections** if not set there.   |
| `schema`         | no       | Name of a schema from `.zod-mapping.json`. If omitted, no field validation is generated — only `allow` lines.                                            |
| `allow`          | no       | Per-operation flags. See below.                                                                                                                          |
| `subcollections` | no       | Array of subcollection objects, same structure as above. Any nesting depth.                                                                              |
| `customChecks`   | no       | **Not implemented.** Currently ignored. Do not use.                                                                                                      |

### `path` rules

- Top-level: the full segment, e.g. `Posts/{postId}`.
- Subcollection: **only the last segment**, e.g. `Comments/{commentId}` — not the full path.
- The `{param}` is the capture variable in the generated `match` block. It does not need to match a document field name.
- `ownerField` refers to **this same capture variable**, not to a field inside the document.

### `allow` defaults

If `allow` is omitted, the following applies:

```json
{ "read": true, "list": false, "create": true, "update": true, "delete": false }
```

If `allow` is set but individual flags are missing, the defaults apply only to the missing fields.

### Important rule

**Every collection your app touches must be listed in the config.**
Collections not listed do not appear in the generated tree and are denied by Firestore by default.

If a collection has no `@AppSec` schema (because validation happens in a Cloud Function, for example), omit the `schema` field and use only `allow`.

### Building the config from your existing code

If you don't have hand-written Firestore rules yet, `discover` can suggest a starting tree:

```powershell
npm exec -- frcli discover
```

This writes `rules.config.json.suggested`, which you then edit:

1. Replace `REPLACE_WITH_SCHEMA_NAME` per collection with the correct schema from `.zod-mapping.json`. `discover` prints the list of available schemas at the end of its run; `validate` prints it again if a placeholder remains.
2. Set `allow` flags per collection based on your access policy.
3. Rename parameters (`{id}`, `{targetDay}`) if you prefer different names.
4. Copy the result to `rules.config.json`.

Collections without an `@AppSec` schema (e.g. where validation happens in a Cloud Function) should have the `schema` field **omitted entirely** — not set to a placeholder.

---

## 6. `.zod-mapping.json` — Format

`scan-zod` creates one entry per schema found:

```json
{
  "PostSchema": {
    "fields": {
      "title": {
        "type": "string",
        "required": true,
        "min": 1,
        "max": 200
      },
      "body": {
        "type": "string",
        "required": true,
        "hasComplexCheck": true,
        "complexCheckWarning": "Complex validation (refine) detected"
      }
    },
    "strict": true,
    "raw": "z.object({...}).strict()",
    "requiresManual": {
      "body": { "...": "..." }
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

    match /Posts/{postId} {
      // ------------------------------------------------------------
      // WARNING: REQUIRES MANUAL - schema: PostSchema
      // ------------------------------------------------------------
      // .strict() detected - define the field whitelist yourself.
      // Candidates: title, body
      // (add server-managed fields like uid, createdAt if present)
      //
      // - body: Complex validation (refine) detected
      //
      // Suggested create rule (uncomment and adapt):
      // // allow create: if isOwner(postId)
      // //   && request.resource.data.keys().hasOnly([...]);
      // ------------------------------------------------------------
      function hasRequired_PostSchema() {
        return (...);
      }
      allow read:   if isOwner(postId);
      allow list:   if false;
      allow create: if isOwner(postId) && hasRequired_PostSchema();
      allow update: if isOwner(postId) && hasRequired_PostSchema();
      allow delete: if false;

      match /Comments/{commentId} { ... }
    }
  }
}
```

The `REQUIRES MANUAL` blocks are the most important part. They show the user where follow-up work is needed and, for `.strict()`, suggest a concrete `hasOnly` expression that the user can uncomment and adapt.

For collections **without** a `schema` field, `allow create` and `allow update` contain only the owner check — no trailing `&& true`.

---

## 10. Workflow

### Option A — you already have a hand-written `rules.config.json`

```powershell
# 1. Collect all @AppSec schemas
npm exec -- frcli scan-zod

# 2. Validate config against mapping
npm exec -- frcli validate

# 3. Generate rules
npm exec -- frcli generate
```

### Option B — start from your existing code

```powershell
# 1. Collect all @AppSec schemas
npm exec -- frcli scan-zod

# 2. Discover your collection tree from doc()/collection() calls
npm exec -- frcli discover

# 3. Edit rules.config.json.suggested:
#    - assign schemas per collection (discover lists them at the end)
#    - adjust allow flags
#    - copy to rules.config.json when done

# 4. Validate
npm exec -- frcli validate

# 5. Generate rules
npm exec -- frcli generate
```

### Review and roll out

```powershell
# 4. Diff against your current rules file
Compare-Object (Get-Content firebase-rules/firestore.rules) (Get-Content firestore.rules)

# 5. Go through all REQUIRES MANUAL blocks and adjust as needed

# 6. Check syntax against Firebase (no live deploy)
npm exec -- firebase deploy --only firestore:rules --dry-run

# 7. Emulator test against real writes
npm exec -- firebase emulators:start --only firestore

# 8. Only then go live
npm exec -- firebase deploy --only firestore:rules
```

### The `--` in `npm exec --`

`firebase-tools` must be installed locally (Section 3) for `npm exec --` to find it. Always use `--`:

- **Correct:** `npm exec -- firebase deploy --only firestore:rules --dry-run`
- **Wrong:** `npm exec firebase deploy --only firestore:rules --dry-run` — npm interprets `--only firestore:rules` as its own config, deploys **all** targets (Functions, Storage, Firestore), and skips `--dry-run`. This has happened.

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

If a collection or subcollection is missing from the config, it is also missing from the rules. Firestore will then deny all access to it. Before deploying, check the config line by line against the real backend structure.

---

## 12. Troubleshooting

### `Cannot find module 'figures'` or `ERR_REQUIRE_ESM`

The CLI uses CommonJS. `figures` must be installed in version 3.x, `chalk` in version 4.x:

```powershell
npm install chalk@4 figures@3.2.0
```

### `npm exec could not determine executable to run` (when calling `firebase`)

`firebase-tools` is not installed locally. `npm exec --` searches only in the project's `node_modules/.bin`, not the global PATH.

Fix: `npm install --save-dev firebase-tools` in the target project, then `npm exec -- firebase ...`.

### `Schema referenced in config does not exist in mapping`

`validate` found a `schema` value in `rules.config.json` that does not exist in `.zod-mapping.json`. The error output looks like this:

```
Schema referenced in config does not exist in mapping: "REPLACE_WITH_SCHEMA_NAME" (at Posts/{postId}/Comments/{commentId})

Available schemas in .zod-mapping.json:
  - PostSchema
  - CommentSchema
  - ...

Fix: edit rules.config.json and replace the "schema" value, or
     remove the "schema" field if this collection has no @AppSec schema.
```

**Common causes:**

- You ran `discover` and left `REPLACE_WITH_SCHEMA_NAME` in place. Replace it with one of the listed schemas, or remove the `schema` field entirely.
- `scan-zod` did not find the schema. Causes: `@AppSec` tag not directly above `export const`; typo in the schema name; file outside the `--pattern` range; no `src/` folder and scan ran without `--pattern`.

### `Warning: collection ... has no schema`

Not an error. `validate` exits successfully but warns that the collection gets only `allow` rules without field validation. Expected when validation runs in a Cloud Function. Add a `schema` name from `.zod-mapping.json` if you want field validation.

### `Found 0 Zod schemas`

Usually a pattern problem. Causes:

- The `@AppSec` schemas live in a folder not covered by the pattern. Specify explicitly: `--pattern "validation/**/*.ts"`.
- `tsconfig.json` excludes the folder.
- The file is not a `.ts` file (`.tsx` is currently not matched).

### `discover` finds fewer collections than expected

`discover` only sees `doc()` / `collection()` calls with string-literal or simple-variable arguments. Causes for missing paths:

- **Wrapper functions**: `fetchPosts(userId)` hides the actual `doc(db, "Users", uid, "Posts", postId)` in another file. The path is found when that file is scanned — but only if the wrapper file is within the pattern range.
- **Template literals**: `doc(db, `Users/${uid}/Posts`)` is not resolvable. `discover` emits a warning and skips it. Refactor to multi-arg form (`doc(db, "Users", uid, "Posts")`) to fix.
- **Dynamic paths from config**: `doc(db, getPath())` cannot be resolved at scan time.

Check the warning list printed after `discover` for skipped arguments.

### `discover` scans way too many files

If `Files scanned` shows tens of thousands, something outside your source tree is being pulled in. `discover` excludes any path containing `/node_modules/` — top-level and nested. If you still see a huge count:

- The project might have a large `dist/` or generated folder that `tsconfig.json` includes. Check its `exclude` list.
- The pattern might be too broad. Narrow it: `--pattern "src/**/*.ts"` or `--pattern "validation/**/*.ts"`.

### `discover` output contains `REPLACE_WITH_SCHEMA_NAME`

Expected. The command does not know which schema belongs to which collection — that's an application decision. See Section 5 for how to assign schemas. `discover` lists available schemas at the end of its run; `validate` lists them again on failure.

### `Dry run complete!` with many "Invalid function name: has" warnings

These warnings are false positives from the Firebase CLI linter. The `has()` method is a built-in on `keys()` expressions, but the linter doesn't know it. The same applies to `Invalid variable name: request` — `request` is the entry point to Firestore rules context.

The decisive line is `cloud.firestore: rules file ... compiled successfully`. If it is there, the file is valid.

### `Unused function: isSignedIn`

Appears when every collection uses `ownerField`. Cosmetic. `isSignedIn` is kept as a fallback for collections without `ownerField`. Safe to ignore.

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
