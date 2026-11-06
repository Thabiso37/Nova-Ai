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
  cart_banner: ['.cart-page-header', '#cartAdBoard img[data-nova-ad-image]', '#cartAdBoard > strong'],
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
}))).reverse();

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
    await page.addInitScript(() => {
      // Capture the original rendered Wishlist board before application handlers mutate it.
      document.addEventListener('DOMContentLoaded',()=>{
        const el=document.getElementById('wishlistAdSlot');
        if(!el)return;
        const r=el.getBoundingClientRect();
        window.__wishlistOriginalRect=r.width>0&&r.height>0?{x:+r.x.toFixed(2),y:+r.y.toFixed(2),width:+r.width.toFixed(2),height:+r.height.toFixed(2)}:null;
      },{once:true});
    });
    page.on('pageerror', error => console.error('[PAGE ERROR]', version, pageSpec.file, error.message));
    const url = origin + '/' + version + '-snapshot/' + pageSpec.file;
    const fullUrl = url + (pageSpec.file.includes('?') ? '&' : '?') + (pageSpec.file.includes('?') ? '' : 'audit=1');
    await page.goto(fullUrl, { waitUntil: 'commit', timeout: 15000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
    await page.evaluate(async () => {
      const bounded=promise=>Promise.race([promise.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,2500))]);
      if(document.fonts?.ready)await bounded(document.fonts.ready);
      await Promise.all(Array.from(document.images).map(img=>img.decode?bounded(img.decode()):Promise.resolve()));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    await page.waitForTimeout(1300);
    let wishlistBeforeRefresh = null;
    if (pageSpec.refreshWishlist) {
      wishlistBeforeRefresh = await page.evaluate(() => window.__wishlistOriginalRect || null);
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
        const visible = el => {
          if(!el||!el.getClientRects().length)return false;
          for(let node=el;node&&node!==document.documentElement;node=node.parentElement){
            const cs=getComputedStyle(node);
            if(node.hidden||node.getAttribute('aria-hidden')==='true'||cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)<=0.01)return false;
          }
          const r=el.getBoundingClientRect();
          return r.width>0&&r.height>0;
        };
        const slotNodes=[...document.querySelectorAll('[data-nova-ad-slot="' + slot + '"]')];
        const outer = slot==='cart_banner'
          ? document.querySelector(outerSel)
          : slotNodes.filter(visible).sort((a,b)=>{
              const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
              return (rb.width*rb.height)-(ra.width*ra.height);
            })[0] || document.querySelector(outerSel) || slotNodes[0] || null;
        const photo = outer?.querySelector(photoSel) || (photoSel ? document.querySelector(photoSel) : null);
        const copy = copySel ? (outer?.querySelector(copySel) || document.querySelector(copySel)) : null;
        const isCarouselIndicator = el => !!el.closest('.nova-live-controls,.shop-tv-controls,.nova-hero-controls,[data-carousel-control],[aria-label^="Advertisement "]');
        const textNodes = slot==='cart_banner'
          ? (outer ? [...outer.querySelectorAll('#cartAdBoard > strong')].filter(visible) : [])
          : copy ? [copy, ...copy.querySelectorAll('h1,h2,h3,p,strong,small,span,a,button')].filter((el,i,a)=>a.indexOf(el)===i && visible(el) && !isCarouselIndicator(el) && (el.children.length===0 || /^(H1|H2|H3|P|STRONG|SMALL|SPAN|A|BUTTON)$/.test(el.tagName))) : (outer ? [...outer.querySelectorAll('strong,span,h1,h2,p,a,button')].filter(el=>visible(el)&&!isCarouselIndicator(el)) : []);
        const text = textNodes.map(el => ({ tag: el.tagName, text: (el.innerText || '').trim().slice(0,100), fontSize: parseFloat(getComputedStyle(el).fontSize), lineHeight: getComputedStyle(el).lineHeight, rect: rect(el) }));
        const isCartChrome = el => slot==='cart_banner' && (el.id==='cartAdBoard' || el.matches('.cart-page-header > button'));
        const cta = outer ? [...outer.querySelectorAll('a,button')].filter(el=>visible(el)&&!isCarouselIndicator(el)&&!isCartChrome(el)).map(el=>({text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,80),rect:rect(el),fontSize:parseFloat(getComputedStyle(el).fontSize),href:el.getAttribute('href'),destination:el.dataset.novaAdDestination||el.getAttribute('href')})) : [];
        const boardLink=slot==='cart_banner'?outer?.querySelector('#cartAdBoard'):(copy?.querySelector('a,button')||outer?.querySelector('a,button'));
        const destination=boardLink?.dataset.novaAdDestination||boardLink?.getAttribute('href')||null;
        const managedSlot=slotNodes[0]||outer;
        const carouselIndicators = outer ? [...outer.querySelectorAll('.nova-live-controls,.shop-tv-controls,.nova-hero-controls')].map(group=>({group:rect(group),items:[...group.querySelectorAll('button,a,[role="button"]')].filter(visible).map(el=>({text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,50),rect:rect(el),fontSize:parseFloat(getComputedStyle(el).fontSize),insideGroup:group.contains(el)}))})) : [];
        const image = outer?.querySelector('img[data-nova-ad-image],video[data-nova-ad-video]') || (photo?.querySelector('img[data-nova-ad-image]') || photo?.querySelector('img'));
        const outerRect=rect(outer), photoRect=rect(photo), copyRect=rect(copy);
        const rightCopy = outerRect ? {x:+(outerRect.x+outerRect.width*.75).toFixed(2), y:outerRect.y, width:+(outerRect.width*.25).toFixed(2),height:outerRect.height} : null;
        const style=outer?getComputedStyle(outer):null;
        const innerWidth=outerRect&&style?outerRect.width-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0)-parseFloat(style.borderLeftWidth||0)-parseFloat(style.borderRightWidth||0):null;
        const ratioBase=(slot==='motors_banner'||slot==='cart_banner')?outerRect?.width:innerWidth;
        const mediaRatio=ratioBase&&photoRect?+(photoRect.width/ratioBase).toFixed(4):null;
        const mediaLoaded = image ? (image.tagName==='VIDEO' ? image.readyState>=1 : image.complete && image.naturalWidth>0) : !!photo;
        const copyMeasure=copyRect;
        const overlap = !!(photoRect&&copyMeasure&&photoRect.x<copyMeasure.right&&photoRect.right>copyMeasure.x&&photoRect.y<copyMeasure.bottom&&photoRect.bottom>copyMeasure.y);
        const copyBase=(slot==='motors_banner'||slot==='cart_banner')?outerRect?.width:innerWidth;
        const copyRatio=copyMeasure&&copyBase?+(copyMeasure.width/copyBase).toFixed(4):null;
        const textOverflow = textNodes.some(el => {
          const cs=getComputedStyle(el);
          return el.scrollWidth > el.clientWidth + 1 && ['hidden','clip'].includes(cs.overflowX)
            || el.scrollHeight > el.clientHeight + 2 && ['hidden','clip'].includes(cs.overflowY)
            || cs.textOverflow==='ellipsis'
            || (cs.webkitLineClamp&&cs.webkitLineClamp!=='none'&&cs.webkitLineClamp!=='0');
        });
        const textOutsideCopy = !!copyMeasure && textNodes.some(el => {
          const r=el.getBoundingClientRect();
          return r.width>0&&(r.left<copyMeasure.x-1||r.right>copyMeasure.right+1||r.top<copyMeasure.y-1||r.bottom>copyMeasure.bottom+1);
        });
        const wordBreaks = [];
        textNodes.forEach(el => {
          const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
          let node;
          while((node=walker.nextNode())){
            const re=/\S+/g;let match;
            while((match=re.exec(node.nodeValue||''))){
              const range=document.createRange();
              range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
              const fragments=[...range.getClientRects()].map(r=>({x:+r.x.toFixed(2),y:+r.y.toFixed(2),width:+r.width.toFixed(2),height:+r.height.toFixed(2)}));
              if(fragments.length>1)wordBreaks.push({word:match[0],fragments});
            }
          }
        });
        const awkwardBreak = wordBreaks.length>0 || textNodes.some(el => {
          const cs=getComputedStyle(el);
          return cs.wordBreak==='break-all'||cs.overflowWrap==='anywhere';
        });
        const textClip = textNodes.some(el => {
          const cs=getComputedStyle(el),r=el.getBoundingClientRect();
          return (['hidden','clip'].includes(cs.overflowY)&&el.scrollHeight>el.clientHeight+1)
            || (['hidden','clip'].includes(cs.overflowX)&&el.scrollWidth>el.clientWidth+1)
            || (copy&&r.width>0&&(r.left<copy.getBoundingClientRect().left-1||r.right>copy.getBoundingClientRect().right+1||r.top<copy.getBoundingClientRect().top-1||r.bottom>copy.getBoundingClientRect().bottom+1));
        });
        const controls=outer?[...outer.querySelectorAll('.nova-live-controls,.shop-tv-controls,.nova-hero-controls')].map(el=>{
          const cs=getComputedStyle(el);
          return {rect:rect(el),position:cs.position,left:cs.left,right:cs.right,width:cs.width,display:cs.display};
        }):[];
        return {slot, found:!!outer, outer:outerRect, originalSize:outer?{width:Number(outer.dataset.novaOriginalWidth)||null,height:Number(outer.dataset.novaOriginalHeight)||null}:null, photo:photoRect, copy:copyMeasure, expectedRightCopy:rightCopy, photoRatio:mediaRatio, copyRatio, text, cta, destination, campaignCode:managedSlot?.dataset.novaCampaignCode||null, carouselIndicators, controls, mediaLoaded, overlap, textOverflow:textOverflow||textClip, textOutsideCopy, awkwardBreak, wordBreaks, hasManagedCampaign:!!managedSlot?.dataset.novaManagedCampaign};
      }, { slot, outerSel, photoSel, copySel });
      if (slot === 'wishlist_banner') measurement.wishlistBeforeRefresh = wishlistBeforeRefresh;
      results[slot] = measurement;
      await page.screenshot({ path: path.join(outDir, version + '-' + viewport.name + '-' + slot + '.png'), fullPage: false });
    }
    await page.close();
  }
  return results;
}

async function verifyCampaignRotation(browser) {
  const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
  const tracked=[];
  await page.route('**/nxplffvklkopwfjaqexo.supabase.co/rest/v1/rpc/**',async route=>{
    const u=route.request().url();
    if(u.includes('get_live_novaai_ad_campaigns'))await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(campaigns)});
    else {
      try{tracked.push(JSON.parse(route.request().postData()||'{}').p_event_type);}catch{}
      await route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
  });
  await page.route('https://ads.test/**',async route=>{
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#1763a8"/><circle cx="850" cy="260" r="190" fill="#f5b900"/></svg>';
    await route.fulfill({status:200,contentType:'image/svg+xml',body:svg});
  });
  await page.route('https://example.com/**',async route=>route.fulfill({status:200,contentType:'text/plain',body:'audit destination'}));
  await page.goto(origin+'/pr-snapshot/index.html?audit=rotation',{waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(()=>!!document.querySelector('#novaHeroCarousel')?.dataset.novaCampaignCode,null,{timeout:15000});
  const first=await page.locator('#novaHeroCarousel').evaluate(el=>el.dataset.novaCampaignCode);
  await page.waitForFunction(previous=>{
    const slot=document.querySelector('#novaHeroCarousel');
    return !!slot?.dataset.novaCampaignCode&&slot.dataset.novaCampaignCode!==previous;
  },first,{timeout:8000});
  const second=await page.locator('#novaHeroCarousel').evaluate(el=>el.dataset.novaCampaignCode);
  const link=page.locator('.nova-hero-copy a').first();
  const href=await link.getAttribute('href');
  const destination=await link.getAttribute('data-nova-ad-destination');
  await page.waitForTimeout(250);
  await link.click();
  await page.waitForTimeout(500);
  await page.close();
  return {rotated:!!first&&!!second&&first!==second,first,second,href,destination,impressionTracked:tracked.includes('impression'),clickTracked:tracked.includes('click'),tracked};
}

const browser = await chromium.launch({ headless: true });
const report = { generatedAt: new Date().toISOString(), viewports, versions: {} };
for (const viewport of viewports) {
  report.versions[viewport.name] = {};
  for (const version of ['main', 'pr']) report.versions[viewport.name][version] = await auditVersion(browser, version, viewport);
}
report.behavior = await verifyCampaignRotation(browser);
await browser.close();

const failures = [];
if(!report.behavior.rotated)failures.push('Campaign rotation: second campaign did not replace the first');
if(!report.behavior.impressionTracked)failures.push('Campaign tracking: impression event was not sent');
if(!report.behavior.clickTracked)failures.push('Campaign tracking: click event was not sent');
if(report.behavior.href!=='https://example.com/novaai-ad-audit/home_hero'||report.behavior.destination!==report.behavior.href)failures.push('Campaign navigation: hero destination/href mismatch');
for (const viewport of viewports) {
  const base = report.versions[viewport.name].main;
  const pr = report.versions[viewport.name].pr;
  for (const slot of campaignSlots) {
    const a = base[slot], b = pr[slot];
    if (slot === 'wishlist_banner') {
      const original = a?.wishlistBeforeRefresh;
      if (!original || !b?.found) { failures.push(viewport.name + ' wishlist_banner: original or refreshed board missing'); continue; }
      if (Math.abs(original.width-b.outer.width)>0.5 || Math.abs(original.height-b.outer.height)>0.5) failures.push(viewport.name + ' wishlist_banner: dimensions changed during refresh');
    } else if (!a?.found || !b?.found) { failures.push(viewport.name + ' ' + slot + ': board missing'); continue; }
    if (slot !== 'wishlist_banner' && (!a.outer || !b.outer || Math.abs(a.outer.width-b.outer.width)>0.5 || Math.abs(a.outer.height-b.outer.height)>0.5)) failures.push(viewport.name + ' ' + slot + ': outer dimensions differ from main');
    if (!b.outer || !b.photo || !b.copy || !Number.isFinite(b.outer.width) || !Number.isFinite(b.outer.height) || !Number.isFinite(b.photo.width) || !Number.isFinite(b.copy.width)) failures.push(viewport.name + ' ' + slot + ': required outer/photo/copy measurement is missing or null');
    if (!b.mediaLoaded) failures.push(viewport.name + ' ' + slot + ': creative media did not load');
    if (b.campaignCode !== 'AUDIT-' + slot + '-0') failures.push(viewport.name + ' ' + slot + ': highest-priority campaign was not selected first');
    if (!b.hasManagedCampaign) failures.push(viewport.name + ' ' + slot + ': managed campaign was not applied');
    if (b.destination!=='https://example.com/novaai-ad-audit/'+slot) failures.push(viewport.name + ' ' + slot + ': campaign destination mismatch');
    if (b.overlap) failures.push(viewport.name + ' ' + slot + ': photo and copy containers overlap');
    if (b.textOverflow) failures.push(viewport.name + ' ' + slot + ': text overflow/clipping detected');
    if (b.textOutsideCopy) failures.push(viewport.name + ' ' + slot + ': text extends outside copy area');
    if (b.awkwardBreak) failures.push(viewport.name + ' ' + slot + ': CSS forces mid-word wrapping');
    if (b.text.some(t => (/^(H1|H2|H3|STRONG)$/.test(t.tag) && t.fontSize < (slot.endsWith('_footer')||slot==='wishlist_banner'?11.5:14)) || (/^(P|SMALL)$/.test(t.tag) && t.fontSize < (slot.endsWith('_footer')||slot==='wishlist_banner'?11.5:12)) || (/^SPAN$/.test(t.tag) && t.fontSize < 11))) failures.push(viewport.name + ' ' + slot + ': headline/body/kicker readability threshold failed');
    if (b.copyRatio===null || Math.abs(b.copyRatio-.25)>.01) failures.push(viewport.name + ' ' + slot + ': measured copy width is not 25%');
    if (b.cta.some(c => c.text && c.fontSize < 12 && !/^(‹|›|Advertisement )/.test(c.text))) failures.push(viewport.name + ' ' + slot + ': CTA below 12px');
    if (slot !== 'cart_banner' && b.cta.length===0) failures.push(viewport.name + ' ' + slot + ': no visible CTA');
    if (slot !== 'cart_banner' && b.copy && b.cta.length) {
      for (const c of b.cta) if (c.rect && (c.rect.x < b.copy.x-1 || c.rect.right > b.copy.right+1 || c.rect.y < b.copy.y-1 || c.rect.bottom > b.copy.bottom+1)) failures.push(viewport.name + ' ' + slot + ': CTA outside copy area');
    }
    if (b.copy) {
      for (const group of b.carouselIndicators||[]) {
        if(group.group&&(group.group.x<b.copy.x-1||group.group.right>b.copy.right+1||group.group.y<b.copy.y-1||group.group.bottom>b.copy.bottom+1)) failures.push(viewport.name + ' ' + slot + ': carousel controls outside copy area');
        for(const item of group.items||[])if(item.rect&&(item.rect.x<b.copy.x-1||item.rect.right>b.copy.right+1||item.rect.y<b.copy.y-1||item.rect.bottom>b.copy.bottom+1))failures.push(viewport.name + ' ' + slot + ': carousel item outside copy area');
      }
    }
    if (slot !== 'wishlist_banner' || b.photoRatio!==null) {
      if (b.photoRatio===null || Math.abs(b.photoRatio-.75)>.01) failures.push(viewport.name + ' ' + slot + ': measured photo width is not 75%');
    }
  }
}
report.failures = failures;
fs.writeFileSync(path.join(outDir,'measurements.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify({failures, output:path.join(outDir,'measurements.json'), versions:Object.fromEntries(Object.entries(report.versions).map(([v,sets])=>[v,Object.fromEntries(Object.entries(sets).map(([ver,slots])=>[ver,Object.fromEntries(Object.entries(slots).map(([s,m])=>[s,{outer:m.outer,photo:m.photo,copy:m.copy,photoRatio:m.photoRatio,fonts:m.text?.map(t=>t.fontSize),cta:m.cta?.map(c=>({text:c.text,fontSize:c.fontSize,rect:c.rect})),overlap:m.overlap,textOverflow:m.textOverflow,mediaLoaded:m.mediaLoaded}]))]))]))},null,2));
if (failures.length) process.exitCode = 1;
