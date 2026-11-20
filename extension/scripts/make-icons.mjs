#!/usr/bin/env node
// Renders icons/sieve.svg to public/icons/icon-{16,32,48,128}.png with Playwright's Chromium (50 section 12.6).
// Run once; the PNGs are committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const svg = readFileSync(join(ROOT, 'icons', 'sieve.svg'), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img id="i" src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.locator('#i').evaluate((img) => /** @type {HTMLImageElement} */ (img).decode());
    const png = await page.locator('#i').screenshot({ omitBackground: true });
    writeFileSync(join(ROOT, 'public', 'icons', `icon-${size}.png`), png);
    console.log(`icons: icon-${size}.png`);
  }
} finally {
  await browser.close();
}
