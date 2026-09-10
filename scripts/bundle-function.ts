/**
 * Inlines generate-cover-letter's sibling module into one file.
 *
 * The Supabase dashboard editor deploys a single file, but the
 * function is written as index.ts + prompt.ts so the prompt and the
 * response validation can be unit-tested and benched without a
 * Supabase project. This produces the paste-ready version from those
 * two, so the tested source stays the source of truth.
 *
 *   deno run --allow-read --allow-write scripts/bundle-function.ts
 */
const DIR = "supabase/functions/generate-cover-letter";
const OUT = "supabase/functions/generate-cover-letter/_deploy.single.ts";

const prompt = await Deno.readTextFile(`${DIR}/prompt.ts`);
const index = await Deno.readTextFile(`${DIR}/index.ts`);

// Pull every import off index.ts, drop the one for the module we're
// about to paste inline, and hoist the rest to the top of the
// bundle. Naively regexing out "the import block" swallows the
// supabase-js import along with it, and the result only fails at
// typecheck — which is exactly the sort of thing that reaches the
// dashboard unnoticed.
const IMPORT = /^import\s+(?:type\s+)?[\s\S]*?from\s+"[^"]+";\s*$/gm;
const imports = index.match(IMPORT) ?? [];
const kept = imports.filter((i) => !i.includes('"./prompt.ts"'));

if (kept.length === imports.length) {
  console.error("Expected an import of ./prompt.ts in index.ts; found none.");
  Deno.exit(1);
}

const indexBody = index.replace(IMPORT, "").trimStart();

const header = `// ─────────────────────────────────────────────────────────────
// GENERATED FILE — do not edit.
//
// Built from ${DIR}/index.ts and prompt.ts by
// scripts/bundle-function.ts. Paste this into the Supabase
// dashboard's function editor; edit the two source files and
// re-run the bundler, never this.
//
// Generated ${new Date().toISOString().slice(0, 10)}
// ─────────────────────────────────────────────────────────────

`;

await Deno.writeTextFile(
  OUT,
  [header + kept.join("\n"), prompt.trim(), indexBody].join("\n\n") + "\n"
);
console.log(`wrote ${OUT} (${kept.length} import(s) hoisted)`);
