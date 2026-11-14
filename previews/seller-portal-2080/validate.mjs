import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const file = pathToFileURL(new URL('./index.html', import.meta.url).pathname).href;
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });
const variants = [
  { value: 'retail', name: 'Retail', expected: 'My Products', absent: 'My Vehicles' },
  { value: 'motors', name: 'Motors', expected: 'My Vehicles', absent: 'My Products' },
  { value: 'property', name: 'Property', expected: 'My Properties', absent: 'My Vehicles' },
];
const results = [];
try {
  for (const viewport of [{ width: 393, height: 852, label: '393x852' }, { width: 360, height: 800, label: '360x800' }]) {
    for (const variant of variants) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(file);
      await page.locator('#market-demo').selectOption(variant.value);
      await page.waitForTimeout(150);
      const approved = await page.locator('#hero-market').innerText();
      if (approved !== variant.name) throw new Error(viewport.label + '/' + variant.name + ': approved marketplace showed ' + approved);
      const tiles = await page.locator('#dashboard-tiles').innerText();
      if (!tiles.includes(variant.expected)) throw new Error(viewport.label + '/' + variant.name + ': missing ' + variant.expected);
      if (variant.absent && tiles.includes(variant.absent)) throw new Error(viewport.label + '/' + variant.name + ': leaked tool ' + variant.absent);
      if (await page.locator('button:has-text("Store Reputation")').isEnabled()) throw new Error('Store Reputation must remain disabled');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error(viewport.label + '/' + variant.name + ': horizontal overflow');
      if (!(await page.locator('.mobile-bottom').isVisible())) throw new Error('Android bottom navigation is not visible');
      await page.screenshot({ path: 'artifacts/seller-portal-' + variant.value + '-' + viewport.label + '.png', fullPage: true });
      await page.locator('.mobile-bottom button[data-view="store"]').click();
      if (!(await page.locator('#view-store').isVisible())) throw new Error('Bottom navigation My Store did not open');
      if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
      results.push({ viewport: viewport.label, marketplace: variant.name, approved, expectedTool: variant.expected, noHorizontalOverflow: true, bottomNavigation: true, reputationDisabled: true, screenshot: 'seller-portal-' + variant.value + '-' + viewport.label + '.png' });
      await page.close();
    }
  }
  console.log('SELLER_PORTAL_PREVIEW_RESULTS=' + JSON.stringify(results));
} finally {
  await browser.close();
}