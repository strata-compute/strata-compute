import path from "node:path";
import puppeteer from "puppeteer-core";

/**
 * Builds the X/Twitter package for Strata Compute: one header and the avatars
 * that sit on it.
 *
 * The header is the Bands layout, with the two grey plates removed — what is
 * left is the accent rule running the full width, interrupted by the lockup
 * sitting on it, on the brand ground and nothing else.
 *
 * Two constraints shape it, and they are why this is not a share card made
 * wide:
 *
 *   1. The profile avatar covers the bottom-left corner permanently, so that
 *      corner is empty and the composition is centred.
 *   2. Narrow viewports crop top and bottom, so nothing that matters goes near
 *      either edge.
 *
 * The avatars are square but X renders them as circles, so the mark is set
 * well inside the inscribed circle rather than filling the plate.
 */

const T = {
  bg: "#080a09",
  border: "#202621",
  ink: "#f2f5f3",
  muted: "#8a938d",
  faint: "#5b635e",
  accent: "#ccff00",
};

const W = 1500;
const H = 500;
const AVATAR = 400;

/** Reserved for the avatar on the header, approximately. */
const AVATAR_ZONE = { cx: 200, cy: 500, r: 132 };

/** The chosen mark, at any size and in any two colours. */
function mark(size, ink = T.ink, accent = T.accent) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block">
    <rect x="5"    y="4.6"  width="14"  height="3.1" rx="1.2" fill="${ink}"/>
    <rect x="5"    y="10.4" width="14"  height="3.1" rx="1.2" fill="${accent}"/>
    <rect x="5"    y="16.2" width="14"  height="3.1" rx="1.2" fill="${ink}"/>
    <rect x="5"    y="4.6"  width="3.1" height="8.9" rx="1.2" fill="${ink}"/>
    <rect x="15.9" y="10.4" width="3.1" height="8.9" rx="1.2" fill="${ink}"/>
  </svg>`;
}

/** The wordmark, holding the tracking ratio the live nav uses. */
function wordmark(s = 46) {
  return `<span style="display:flex;flex-direction:column;line-height:1">
    <span style="font-size:${s}px;font-weight:600;letter-spacing:.13em;color:${T.ink}">STRATA</span>
    <span style="margin-top:${s * 0.24}px;font-size:${s / 1.37}px;font-weight:500;letter-spacing:.28em;color:${T.faint}">COMPUTE</span>
  </span>`;
}

const mono = `font-family:'JetBrains Mono',ui-monospace,monospace`;
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`;

/**
 * The header.
 *
 * The lockup carries its own ground colour so the accent rule appears to pass
 * behind it rather than through it — that break is the whole composition, and
 * it is why the rule is a single line and not a band.
 */
const header = `
  <div style="position:absolute;left:0;right:0;top:246px;height:8px;background:${T.accent};opacity:.9"></div>
  <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="display:flex;align-items:center;gap:34px;background:${T.bg};padding:0 54px">
      ${mark(126)}${wordmark(46)}
    </div>
    <div style="${mono};margin-top:40px;background:${T.bg};padding:0 26px;font-size:15px;letter-spacing:.24em;text-transform:uppercase;color:${T.muted}">Stocks, crypto, onchain &mdash; measured the same way</div>
  </div>`;

function plate(w, h, body, ground = T.bg) {
  return `<!doctype html><meta charset="utf-8">
<style>
  ${FONTS}
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${w}px; height:${h}px; background:${ground}; overflow:hidden;
         font-family:Inter,system-ui,sans-serif; position:relative; }
</style>
${body}`;
}

/** The page tone behind a profile, one step off the header so the ring reads. */
const PAGE = "#0e1210";

/** Avatar: the mark centred, sized to sit inside the circular crop. */
function avatarPlate(ground, ink, accent) {
  return plate(
    AVATAR,
    AVATAR,
    `<div style="position:absolute;inset:0;background:${ground};display:grid;place-items:center">
       ${mark(214, ink, accent)}
     </div>`,
  );
}

/**
 * A mock of the finished profile, so the pair can be judged together rather
 * than one file at a time — this is where a header that ignores the avatar
 * gets found out.
 */
const preview = plate(
  W,
  880,
  `<div style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;background:${T.bg}">${header}</div>
   <div style="position:absolute;left:${AVATAR_ZONE.cx - AVATAR_ZONE.r}px;top:${AVATAR_ZONE.cy - AVATAR_ZONE.r}px;
               width:${AVATAR_ZONE.r * 2}px;height:${AVATAR_ZONE.r * 2}px;border-radius:50%;
               background:${T.bg};box-shadow:0 0 0 7px ${PAGE};display:grid;place-items:center;overflow:hidden">
     ${mark(140)}
   </div>
   <div style="position:absolute;left:${AVATAR_ZONE.cx - AVATAR_ZONE.r}px;top:${AVATAR_ZONE.cy + AVATAR_ZONE.r + 26}px">
     <div style="font-size:30px;font-weight:600;letter-spacing:-.02em;color:${T.ink}">Strata Compute</div>
     <div style="${mono};margin-top:10px;font-size:15px;color:${T.faint}">@stratacompute</div>
     <div style="margin-top:20px;font-size:17px;color:${T.muted};max-width:640px;line-height:1.5">
       Every market on one scale.
     </div>
   </div>
   <div style="position:absolute;right:64px;top:${H + 40}px;${mono};font-size:12px;letter-spacing:.2em;color:${T.faint}">MOCK &mdash; NOT AN X SCREENSHOT</div>`,
  PAGE,
);

/** The header with the reserved zones drawn on, for checking rather than trusting. */
const guides = plate(
  W,
  H,
  `${header}
   <div style="position:absolute;inset:0;pointer-events:none">
     <div style="position:absolute;left:${AVATAR_ZONE.cx - AVATAR_ZONE.r}px;top:${AVATAR_ZONE.cy - AVATAR_ZONE.r}px;
                 width:${AVATAR_ZONE.r * 2}px;height:${AVATAR_ZONE.r * 2}px;border-radius:50%;
                 border:2px dashed #ff4b4b;background:rgb(255 75 75 / .12)"></div>
     <div style="position:absolute;inset:56px 0;border-top:2px dashed #4c8dff;border-bottom:2px dashed #4c8dff"></div>
     <div style="position:absolute;left:${AVATAR_ZONE.cx - AVATAR_ZONE.r}px;top:${AVATAR_ZONE.cy - AVATAR_ZONE.r - 30}px;${mono};font-size:12px;color:#ff4b4b">AVATAR</div>
     <div style="position:absolute;left:24px;top:24px;${mono};font-size:12px;color:#4c8dff">CROP-SAFE BAND</div>
   </div>`,
);

const OUT = "c:/Strata Compute/logoreferensi";
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
  console.log(`  ${file}`);
}

await shoot(plate(W, H, header), "x-header.png", W, H);
await shoot(avatarPlate(T.bg, T.ink, T.accent), "x-avatar.png", AVATAR, AVATAR);
await shoot(avatarPlate(T.accent, T.bg, T.bg), "x-avatar-lime.png", AVATAR, AVATAR);
await shoot(preview, "x-preview.png", W, 880);
await shoot(guides, "x-header-safe-area.png", W, H);

await browser.close();
