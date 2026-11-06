import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const origin = process.env.NOVAAI_TEST_ORIGIN || 'http://127.0.0.1:4173';
const outDir = path.resolve('pr-snapshot/test-results/pr9-ad-layout-audit');
fs.mkdirSync(outDir, { recursive: true });

const viewports = [{ name: 'desktop-1365', width: 1365, height: 900 }, { name: 'mobile-360', width: 360, height: 800 }, { name: 'mobile-320', width: 320, height: 740 }];
const pages = [
  { file: 'index.html', slots: ['home_hero'] },
  { file: 'retail.html', slots: ['shop_tv', 'shop_footer'] },
  { file: 'retail.html?view=wishlist', slots: ['wishlist_banner'], refreshWishlist: true },
  { file: 'retail.html?view=cart', slots: ['cart_banner'] },
  { file: 'seller-motors-houses.html?market=motors', slots: ['motors_banner', 'motors_footer'] },
  { file: 'seller-motors-houses.html?market=property', slots: ['property_banner', 'property_footer'] }
];
const selectors = {
  home_hero: ['#novaHeroCarousel', '.nova-hero-art', '.nova-hero-copy'],
  shop_tv: ['#shopTvAds', '.shop-tv-art', '.shop-tv-copy'],
  cart_banner: ['#cartAdBoard', 'img[data-nova-ad-image]', null],
  wishlist_banner: ['#wishlistAdSlot', '.nova-footer-ad-image img[data-nova-ad-image], #wishlistAdSlot img[data-nova-ad-image]', '.nova-footer-ad-copy'],
  motors_banner: ['#motorsWelcomeAd', 'img[data-nova-ad-image]', '.motors-hero-copy'],
  property_banner: ['#propertyAdSlot', '.property-promo-photo', '.property-promo-copy'],
  shop_footer: ['#shopFooterAd', '.nova-footer-ad-image img[data-nova-ad-image], .nova-footer-ad-image', '.nova-footer-ad-copy'],
  motors_footer: ['#motorsFooterAd', '.nova-footer-ad-image img[data-nova-ad-image], .nova-footer-ad-image', '.nova-footer-ad-copy'],
  property_footer: ['#propertyFooterAd', '.nova-footer-ad-image img[data-nova-ad-image], .nova-footer-ad-image', '.nova-footer-ad-copy']
};
const campaignSlots = Object.keys(selectors);
const campaigns = campaignSlots.flatMap((slot, i) => [0, 1].map((n) => ({
  campaign_id: 'AUDIT-' + slot + '-' + n,
  slot_id: slot,
  title: n === 0 ? 'Priority campaign headline' : 'Second rotating campaign',
  description: 'Clear campaign description with enough words to test normal wrapping and line spacing on narrow mobile screens.',
  creative_type: 'image',
  creative_url: 'https://ads.test/creative-' + i + '-' + n + '.svg',
  destination_url: 'https://example.com/novaai-ad-audit/' + slot,
  status: 'active',
  starts_at: '2026-01-01T00:00:00.000Z',
  ends_at: '2035-01-01T00:00:00.000Z',
  priority: n === 0 ? 100 : 50,
  duration_seconds: 2
})));

async function auditVersion(browser, version, viewport) {
  const results = {};
  for (const pageSpec of pages) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await page.route('**/nxplffvklkopwfjaqexo.supabase.co/rest/v1/rpc/**', async route => {
      const u = route.request().url();
      if (u.includes('get_live_novaai_ad_campaigns')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(campaigns) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
    });
    await page.route('https://ads.test/**', async route => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#1763a8"/><circle cx="850" cy="260" r="190" fill="#f5b900"/></svg>';
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
    });
    await page.addInitScript(() => {\n      const remember = () => { const el=document.querySelector('#wishlistAdSlot'); if(el && !window.__wishlistInitialRect){ const r=el.getBoundingClientRect(); window.__wishlistInitialRect={x:r.x,y:r.y,width:r.width,height:r.height}; } };\n      new MutationObserver(remember).observe(document,{childList:true,subtree:true});\n      document.addEventListener('DOMContentLoaded',remember,{once:true});\n    });\n    page.on('pageerror', error => console.error('[PAGE ERROR]', version, pageSpec.file, error.message));
    const url = origin + '/' + version + '-snapshot/' + pageSpec.file;
    const fullUrl = url + (pageSpec.file.includes('?') ? '&' : '?') + (pageSpec.file.includes('?') ? '' : 'audit=1');
    await page.goto(fullUrl, { waitUntil: 'commit', timeout: 15000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1300);
    let wishlistBeforeRefresh = null;
    if (pageSpec.refreshWishlist) {
      wishlistBeforeRefresh = await page.evaluate(() => window.__wishlistInitialRect || (() => { const el=document.querySelector('#wishlistAdSlot'); if(!el)return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })());
      await page.evaluate(() => { if (typeof window.renderWishlist === 'function') window.renderWishlist(); });
      await page.waitForTimeout(500);
    }
    for (const slot of pageSpec.slots) {
      const [outerSel, photoSel, copySel] = selectors[slot];
      const measurement = await page.evaluate(({ slot, outerSel, photoSel, copySel }) => {
        const rect = el => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) };
        };
        const outer = document.querySelector(outerSel) || document.querySelector('[data-nova-ad-slot="' + slot + '"]');
        const photo = outer?.querySelector(photoSel) || (photoSel ? document.querySelector(photoSel) : null);
        const copy = copySel ? (outer?.querySelector(copySel) || document.querySelector(copySel)) : null;
        const visible = el => !!el && !!(el.getClientRects().length) && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
        const textNodes = copy ? [copy, ...copy.querySelectorAll('h1,h2,h3,p,strong,small,span,a,button')].filter((el,i,a)=>a.indexOf(el)===i && visible(el) && (el.children.length===0 || /^(H1|H2|H3|P|STRONG|SMALL|SPAN|A|BUTTON)$/.test(el.tagName))) : (outer ? [...outer.querySelectorAll('strong,span,h1,h2,p,a,button')].filter(visible) : []);
        const text = textNodes.map(el => ({ tag: el.tagName, text: (el.innerText || '').trim().slice(0,100), fontSize: parseFloat(getComputedStyle(el).fontSize), lineHeight: getComputedStyle(el).lineHeight, rect: rect(el) }));
        const cta = outer ? [...outer.querySelectorAll('a,button')].filter(visible).map(el=>({text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,80),rect:rect(el),fontSize:parseFloat(getComputedStyle(el).fontSize),href:el.getAttribute('href')})) : [];
        const image = outer?.querySelector('img[data-nova-ad-image],video[data-nova-ad-video]') || (photo?.querySelector('img[data-nova-ad-image]') || photo?.querySelector('img'));
        const outerRect=rect(outer), photoRect=rect(photo), copyRect=rect(copy);
        const rightCopy = outerRect ? {x:+(outerRect.x+outerRect.width*.75).toFixed(2), y:outerRect.y, width:+(outerRect.width*.25).toFixed(2),height:outerRect.height} : null;
        const style=outer?getComputedStyle(outer):null;
        const innerWidth=outerRect&&style?outerRect.width-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0)-parseFloat(style.borderLeftWidth||0)-parseFloat(style.borderRightWidth||0):null;
        const mediaRatio=innerWidth&&photoRect?+(photoRect.width/innerWidth).toFixed(4):(outerRect&&photoRect?+(photoRect.width/outerRect.width).toFixed(4):null);
        const mediaLoaded = image ? (image.tagName==='VIDEO' ? image.readyState>=1 : image.complete && image.naturalWidth>0) : !!photo;
        const overlap = !!(photoRect&&copyRect&&photoRect.x<copyRect.right&&photoRect.right>copyRect.x&&photoRect.y<copyRect.bottom&&photoRect.bottom>copyRect.y);
        const textOverflow = textNodes.some(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2);
        return {slot, found:!!outer, outer:outerRect, photo:photoRect, copy:copyRect, expectedRightCopy:rightCopy, photoRatio:mediaRatio, text, cta, mediaLoaded, overlap, textOverflow, hasManagedCampaign:!!outer?.dataset.novaManagedCampaign};
      }, { slot, outerSel, photoSel, copySel });
      if (slot === 'wishlist_banner') measurement.wishlistBeforeRefresh = wishlistBeforeRefresh;
      results[slot] = measurement;
      await page.screenshot({ path: path.join(outDir, version + '-' + viewport.name + '-' + slot + '.png'), fullPage: false });
    }
    await page.close();
  }
  return results;
}

const browser = await chromium.launch({ headless: true });
const report = { generatedAt: new Date().toISOString(), viewports, versions: {} };
for (const viewport of viewports) {
  report.versions[viewport.name] = {};
  for (const version of ['main', 'pr']) report.versions[viewport.name][version] = await auditVersion(browser, version, viewport);
}
await browser.close();

const failures = [];
for (const viewport of viewports) {
  const base = report.versions[viewport.name].main;
  const pr = report.versions[viewport.name].pr;
  for (const slot of campaignSlots) {
    const a = base[slot], b = pr[slot];
    if (slot === 'wishlist_banner') {
      const original = a?.wishlistBeforeRefresh;
      if (!original || !b?.found) { failures.push(viewport.name + ' wishlist_banner: original or refreshed board missing'); continue; }
      if (Math.abs(original.width-b.outer.width)>1 || Math.abs(original.height-b.outer.height)>1) failures.push(viewport.name + ' wishlist_banner: dimensions changed during refresh');
    } else if (!a?.found || !b?.found) { failures.push(viewport.name + ' ' + slot + ': board missing'); continue; }
    if (slot !== 'wishlist_banner' && (!a.outer || !b.outer || Math.abs(a.outer.width-b.outer.width)>1 || Math.abs(a.outer.height-b.outer.height)>1)) failures.push(viewport.name + ' ' + slot + ': outer dimensions differ from main');
    if (!b.mediaLoaded) failures.push(viewport.name + ' ' + slot + ': creative media did not load');
    if (b.overlap) failures.push(viewport.name + ' ' + slot + ': photo and copy containers overlap');
    if (b.textOverflow) failures.push(viewport.name + ' ' + slot + ': text overflow/clipping detected');
    if (b.text.some(t => t.fontSize < 11)) failures.push(viewport.name + ' ' + slot + ': text below 11px');
    if (b.cta.some(c => c.fontSize < 11)) failures.push(viewport.name + ' ' + slot + ': CTA below 11px');
    if (slot !== 'cart_banner' && b.cta.length===0) failures.push(viewport.name + ' ' + slot + ': no visible CTA');
    if (slot === 'home_hero' && b.cta.length) {
      const cr=b.copy, c=b.cta[0].rect;
      if (cr && c && (c.x<cr.x-1 || c.right>cr.right+1)) failures.push(viewport.name + ' home_hero: carousel CTA/control outside copy area');
    }
    if (slot !== 'wishlist_banner' || b.photoRatio!==null) {
      if (b.photoRatio!==null && Math.abs(b.photoRatio-.75)>.03) failures.push(viewport.name + ' ' + slot + ': measured photo width is not 75%');
    }
  }
}
report.failures = failures;
fs.writeFileSync(path.join(outDir,'measurements.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify({failures, output:path.join(outDir,'measurements.json'), versions:Object.fromEntries(Object.entries(report.versions).map(([v,sets])=>[v,Object.fromEntries(Object.entries(sets).map(([ver,slots])=>[ver,Object.fromEntries(Object.entries(slots).map(([s,m])=>[s,{outer:m.outer,photo:m.photo,copy:m.copy,photoRatio:m.photoRatio,fonts:m.text?.map(t=>t.fontSize),cta:m.cta?.map(c=>({text:c.text,fontSize:c.fontSize,rect:c.rect})),overlap:m.overlap,textOverflow:m.textOverflow,mediaLoaded:m.mediaLoaded}]))]))]))},null,2));
if (failures.length) process.exitCode = 1;
