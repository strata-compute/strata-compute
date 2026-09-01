import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

/**
 * Builds the two images GitHub shows, into .github/.
 *
 *   banner.png          the README header — the first thing anyone sees
 *   social-preview.png  the card GitHub renders when the repo link is shared
 *
 * Same composition as the X header, deliberately: the accent rule running the
 * full width with the lockup sitting on it, carrying its own ground so the
 * rule reads as passing behind. One brand, one construction, three surfaces.
 *
 * They live in .github/ rather than a docs folder so they are out of the way
 * of the source tree while still being committed — a README banner served from
 * an external host is a broken image waiting to happen.
 */

const T = {
  bg: "#080a09",
  ink: "#f2f5f3",
  muted: "#8a938d",
  faint: "#5b635e",
  accent: "#ccff00",
};

function mark(size) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block">
    <rect x="5"    y="4.6"  width="14"  height="3.1" rx="1.2" fill="${T.ink}"/>
    <rect x="5"    y="10.4" width="14"  height="3.1" rx="1.2" fill="${T.accent}"/>
    <rect x="5"    y="16.2" width="14"  height="3.1" rx="1.2" fill="${T.ink}"/>
    <rect x="5"    y="4.6"  width="3.1" height="8.9" rx="1.2" fill="${T.ink}"/>
    <rect x="15.9" y="10.4" width="3.1" height="8.9" rx="1.2" fill="${T.ink}"/>
  </svg>`;
}

function wordmark(s) {
  return `<span style="display:flex;flex-direction:column;line-height:1">
    <span style="font-size:${s}px;font-weight:600;letter-spacing:.13em;color:${T.ink}">STRATA</span>
    <span style="margin-top:${s * 0.24}px;font-size:${s / 1.37}px;font-weight:500;letter-spacing:.28em;color:${T.faint}">COMPUTE</span>
  </span>`;
}

const mono = `font-family:'JetBrains Mono',ui-monospace,monospace`;
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`;

function plate(w, h, body) {
  return `<!doctype html><meta charset="utf-8">
<style>
  ${FONTS}
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${w}px; height:${h}px; background:${T.bg}; overflow:hidden;
         font-family:Inter,system-ui,sans-serif; position:relative; }
</style>
${body}`;
}

/** README header. Wide, so the rule has room to run. */
const banner = plate(
  1600,
  340,
  `<div style="position:absolute;left:0;right:0;top:164px;height:7px;background:${T.accent};opacity:.9"></div>
   <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
     <div style="display:flex;align-items:center;gap:30px;background:${T.bg};padding:0 50px">
       ${mark(112)}${wordmark(42)}
     </div>
     <div style="${mono};margin-top:30px;background:${T.bg};padding:0 24px;font-size:14px;letter-spacing:.24em;text-transform:uppercase;color:${T.muted}">Every market on one scale</div>
   </div>`,
);

/**
 * The link card. GitHub crops this to 2:1 and shows it small, so it carries
 * less: the lockup, the line, and the domain.
 */
const social = plate(
  1280,
  640,
  `<div style="position:absolute;left:0;right:0;top:316px;height:8px;background:${T.accent};opacity:.9"></div>
   <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
     <div style="display:flex;align-items:center;gap:34px;background:${T.bg};padding:0 54px">
       ${mark(126)}${wordmark(46)}
     </div>
     <div style="${mono};margin-top:40px;background:${T.bg};padding:0 26px;font-size:15px;letter-spacing:.24em;text-transform:uppercase;color:${T.muted}">Every market on one scale</div>
     <div style="${mono};position:absolute;bottom:56px;font-size:13.5px;letter-spacing:.2em;color:${T.faint}">stratacompute.app</div>
   </div>`,
);

const OUT = "c:/Strata Compute/.github";
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});

async function shoot(html, file, width, height) {
  const p = await browser.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: "networkidle0" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(OUT, file) });
  await p.close();
  console.log(`  .github/${file}`);
}

await shoot(banner, "banner.png", 1600, 340);
await shoot(social, "social-preview.png", 1280, 640);

await browser.close();
