import fs from "node:fs";

/**
 * GUARD AGAINST MIXED `.next` ARTIFACTS
 *
 * `next dev` and `next build` write incompatible output into the same
 * `.next` directory, and neither cleans up after the other. Switching modes
 * leaves a manifest referencing chunk files the other mode has removed, and
 * the failure surfaces much later as a runtime `Cannot find module './27.js'`
 * on whichever route happened to own that chunk.
 *
 * It is a confusing failure because the source is fine: nothing in the
 * application changed, and the error names a file no developer ever wrote.
 * It was observed twice on this project — once on /app/rankings, once on
 * /app/signals — and both times the "fix" was to delete a build directory,
 * which is not a thing anyone should have to guess.
 *
 * `BUILD_ID` is the discriminator: `next build` writes it, `next dev` does
 * not. So a `.next` carrying BUILD_ID is a production build, and one without
 * is a dev cache. Starting the other mode over it clears it first.
 */

const mode = process.argv[2];
if (mode !== "dev" && mode !== "build") {
  console.error("usage: guard-next-artifacts.mjs <dev|build>");
  process.exit(2);
}

if (!fs.existsSync(".next")) process.exit(0);

const isProductionBuild = fs.existsSync(".next/BUILD_ID");
const conflicting =
  (mode === "dev" && isProductionBuild) || (mode === "build" && !isProductionBuild);

if (!conflicting) process.exit(0);

const found = isProductionBuild ? "a production build" : "a dev cache";
console.log(`[strata] .next holds ${found}; clearing it before \`next ${mode}\`.`);
fs.rmSync(".next", { recursive: true, force: true });
