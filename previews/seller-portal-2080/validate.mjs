import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const sellerFile = resolve(new URL('../../seller.html', import.meta.url).pathname);
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });
const variants = [
  { market:'retail', label:'Retail', tool:'My Products' },
  { market:'motors', label:'Motors', tool:'My Vehicles' },
  { market:'property', label:'Property', tool:'My Properties' }
];
const sizes = [
  { width:393,height:852,label:'393x852' },
  { width:360,height:800,label:'360x800' },
  { width:1440,height:1000,label:'desktop-1440x1000' }
];
const mockSupabase = `window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
 from:(table)=>{const q={select(){return this},eq(){return this},in(){return this},order:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==='seller_stores'?window.__fixtureStore:table==='seller_public_locations'?null:null,error:null}),single:async()=>({data:null,error:null}),then(resolve){resolve({data:table==='seller_marketplace_permissions'?[{marketplace:window.__fixtureStore.primary_marketplace,status:'approved'}]:[],error:null})}};return q},
 rpc:async()=>({data:[],error:null}),storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})}
})};`;
const results=[];
try{
 for(const size of sizes) for(const variant of variants){
  const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1,isMobile:size.width<500,hasTouch:size.width<500});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:mockSupabase}));
  await page.goto(pathToFileURL(sellerFile).href);
  await page.waitForFunction(()=>!!window.NOVAAISeller2080);
  await page.evaluate((market)=>{window.__fixtureStore={id:'fixture-store-'+market,store_name:'Preview Store',store_slug:'preview-store',status:'approved',primary_marketplace:market};},variant.market);
  await page.evaluate(async()=>{await window.updateUser({id:'isolated-fixture-user',email:'preview@example.invalid',user_metadata:{full_name:'Preview Seller'}})});
  await page.waitForFunction(()=>document.getElementById('sp2080Approval')?.textContent.includes('APPROVED'));
  const shown=await page.locator('#sp2080MarketName').innerText();
  if(shown!==variant.label)throw new Error(size.label+'/'+variant.label+': wrong marketplace '+shown);
  const tileText=await page.locator('#sp2080Tiles').innerText();
  if(!tileText.includes(variant.tool))throw new Error(size.label+'/'+variant.label+': missing '+variant.tool);
  const switcher=await page.locator('#changeMarketplaceButton').isVisible().catch(()=>false);
  if(switcher)throw new Error('Authenticated dashboard exposes marketplace switching');
  if(await page.locator('html').evaluate(el=>el.scrollWidth>window.innerWidth))throw new Error(size.label+': horizontal overflow');
  await page.screenshot({path:'artifacts/integrated-'+variant.market+'-'+size.label+'.png',fullPage:true});
  await page.locator('[data-spview="store"]').first().click();
  if(!(await page.locator('#sp2080Store').evaluate(el=>el.classList.contains('active'))))throw new Error('My Store navigation failed');
  await page.locator('[data-spview="listings"]').first().click();
  if(!(await page.locator('#sp2080Listings').evaluate(el=>el.classList.contains('active'))))throw new Error('Listings navigation failed');
  if(errors.length)throw new Error(errors.join('; '));
  results.push({viewport:size.label,marketplace:variant.label,correctTool:variant.tool,noMarketplaceSwitcher:!switcher,noHorizontalOverflow:true,storeNavigation:true,listingNavigation:true});
  await page.close();
 }
 console.log('SELLER_PORTAL_2080_INTEGRATION_RESULTS='+JSON.stringify(results));
}finally{await browser.close()}
