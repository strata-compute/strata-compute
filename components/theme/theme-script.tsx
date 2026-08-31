import * as React from "react";
import { THEME_STORAGE_KEY } from "./theme";

/**
 * Runs before first paint, ahead of any stylesheet-dependent rendering.
 *
 * The server always emits `data-theme="dark"`, so a reader with no stored
 * preference — and a reader with JavaScript disabled — gets the dark product
 * exactly as designed. This script only ever *narrows* that: it switches the
 * attribute to light when the reader has actually asked for it, either
 * explicitly or by choosing "system" on a light desktop.
 *
 * It is inlined rather than imported because a network round trip here is a
 * visible flash of the wrong theme.
 */
const SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var p=localStorage.getItem(k);
if(p!=="dark"&&p!=="light"&&p!=="system")p="dark";
var r=p==="system"
  ?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")
  :p;
document.documentElement.setAttribute("data-theme",r);
}catch(e){/* private mode, blocked storage: dark stands */}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
