// Headless smoke test in Chromium + WebKit, saves screenshots
import { createRequire } from 'module';
const require = createRequire(process.env.PWDIR || '/Users/jurek/Downloads/Claude/Projects/CivicForge/');
const pw = require('playwright-core');
const out = new URL('.', import.meta.url).pathname;
for (const [name, opts] of [
  ['chromium', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ['webkit', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ['webkit-phone', { viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }],
]) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) continue;
  const engine = name.startsWith('webkit') ? pw.webkit : pw.chromium;
  const browser = await engine.launch({ args: name === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
  const page = await browser.newPage(opts);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await page.goto('http://localhost:8817/');
  await page.waitForTimeout(800);
  if (name === 'webkit-phone') await page.tap('#power'); else await page.click('#power');
  await page.waitForTimeout(2500);
  for (const k of 'SPEAKANDGROOVE') { await page.keyboard.press(k.toLowerCase()); await page.waitForTimeout(260); }
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => { const e = window.__sg.engine; return { ctx: e.ctx && e.ctx.state, worklet: !!e.speech, level: e.level, typed: e.typed.join(''), chord: e.chord.name, events: e.events.length }; });
  await page.screenshot({ path: `${out}shot-${name}.png` });
  console.log(name, JSON.stringify(st), 'errors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
}
