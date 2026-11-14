import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const sellerFile=resolve(new URL('../../seller.html',import.meta.url).pathname);
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
const variants=[{market:'retail',label:'Retail',tool:'My Products',denied:'motors'},{market:'motors',label:'Motors',tool:'My Vehicles',denied:'retail'},{market:'property',label:'Property',tool:'My Properties',denied:'retail'}];
const sizes=[{width:393,height:852,label:'393x852'},{width:360,height:800,label:'360x800'},{width:1440,height:1000,label:'desktop-1440x1000'}];
const mockSupabase=`window.__mockWrites=0;window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithPassword:async()=>({data:{user:{id:'isolated-fixture-user',email:'preview@example.invalid',user_metadata:{full_name:'Preview Seller'}}},error:null}),signOut:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({data:{user:window.__fixtureUser},error:null})},
 from:(table)=>{const q={select(){return this},eq(){return this},in(){return this},order:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==='seller_stores'?window.__fixtureStore:null,error:null}),single:async()=>({data:null,error:null}),insert(){window.__mockWrites++;return this},update(){window.__mockWrites++;return this},delete(){window.__mockWrites++;return this},then(resolve){resolve({data:table==='seller_marketplace_permissions'?(window.__fixturePermissions||[]):[],error:null})}};return q},
 rpc:async()=>({data:[],error:null}),storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})}
})};`;
const results=[];
async function installMocks(page){await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:mockSupabase}))}
try{
 for(const size of sizes)for(const variant of variants){
  const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1,isMobile:size.width<500,hasTouch:size.width<500});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await installMocks(page);await page.goto(pathToFileURL(sellerFile).href);await page.waitForFunction(()=>!!window.NOVAAISeller2080);
  await page.locator('#sp2080OpenAuth').click();
  if(!(await page.locator('#sp2080Account').evaluate(el=>el.classList.contains('active'))))throw new Error('Sign-in gate did not open Account view');
  if(!(await page.locator('#authForm').isVisible()))throw new Error('Authentication form not visible from Account');
  // Follow the normal seller entry path: select one marketplace before submitting the existing sign-in form.
  await page.evaluate(market=>window.chooseMarketplace(market),variant.market);
  await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('fixture-password');
  await page.evaluate(market=>{window.__fixtureStore={id:'fixture-store-'+market,store_name:'Preview Store',store_slug:'preview-store',status:'approved',primary_marketplace:market};window.__fixturePermissions=[{marketplace:market,status:'approved'}]},variant.market);
  await page.locator('#authForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.getElementById('sp2080Approval')?.textContent.includes('APPROVED'));
  if(await page.locator('#sp2080MarketName').innerText()!==variant.label)throw new Error('Incorrect approved marketplace label');
  if(!(await page.locator('#sp2080Tiles').innerText()).includes(variant.tool))throw new Error('Marketplace-specific listing tile missing');
  if(await page.locator('#changeMarketplaceButton').isVisible().catch(()=>false))throw new Error('Authenticated marketplace switcher visible');
  if(await page.locator('#sellerWorkspace .seller-page-nav').isVisible().catch(()=>false))throw new Error('Legacy navigation visible beside 2080 dashboard');
  if(await page.locator('#sellerWorkspace .selected-market-bar').isVisible().catch(()=>false))throw new Error('Legacy marketplace bar visible beside 2080 dashboard');
  if(await page.locator('html').evaluate(el=>el.scrollWidth>innerWidth))throw new Error('Horizontal overflow at '+size.label);
  await page.screenshot({path:'artifacts/approved-'+variant.market+'-'+size.label+'.png',fullPage:true});
  await page.locator('[data-spview="account"]:visible').first().click();await page.locator('[data-spview="listings"]:visible').first().click();
  if(!(await page.locator('#sp2080Listings').evaluate(el=>el.classList.contains('active'))))throw new Error('Listings view inactive');
  for(const id of ['sellerInventoryPanel','sellerInventoryHeading','sellerInventoryTabs','sellerListingEditorPage','sellerModerationPage','sellerOrdersPage'])if(!(await page.locator('#'+id).isVisible()))throw new Error('Workflow hidden after Account -> Listings: '+id);
  if(!(await page.locator('#sellerForm').isVisible()))throw new Error('Add Listing form hidden');
  if(!(await page.locator('#myProductsList').isVisible()))throw new Error('Existing listings list hidden');
  if(!(await page.locator('#loadOrdersBtn').isVisible()))throw new Error('Orders refresh control hidden');
  await page.locator('#loadOrdersBtn').click();await page.screenshot({path:'artifacts/listings-orders-'+variant.market+'-'+size.label+'.png',fullPage:true});
  if(await page.evaluate(()=>window.__mockWrites)!==0)throw new Error('Unexpected mocked database write');
  if(errors.length)throw new Error(errors.join('; '));
  results.push({viewport:size.label,marketplace:variant.label,accountGate:true,authenticationForm:true,listingsAndOrders:true,legacyNavigationHidden:true,marketplaceSwitcherHidden:true,noHorizontalOverflow:true,mockWrites:0});await page.close();
 }
 for(const variant of variants){
  const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});await installMocks(page);await page.goto(pathToFileURL(sellerFile).href);await page.waitForFunction(()=>!!window.NOVAAISeller2080);
  await page.evaluate(market=>{window.__fixtureStore={id:'fixture-store-'+market,store_name:'Preview Store',store_slug:'preview-store',status:'approved',primary_marketplace:market};window.__fixturePermissions=[{marketplace:market,status:'pending'}]},variant.market);
  await page.evaluate(async(market)=>window.updateUser({id:'isolated-fixture-user',email:'preview@example.invalid',user_metadata:{full_name:'Preview Seller'}}),variant.market);
  await page.waitForFunction(()=>document.getElementById('sp2080Gate')?.classList.contains('active'));await page.evaluate(()=>window.NOVAAISeller2080.navigate('listings'));
  if(!(await page.locator('#sp2080Gate').evaluate(el=>el.classList.contains('active'))))throw new Error('Pending permission did not block Listings: '+variant.label);
  if(await page.locator('#publish').isEnabled())throw new Error('Publish enabled without approved permission: '+variant.label);
  await page.evaluate(other=>window.chooseMarketplace(other),variant.denied);
  if((await page.evaluate(()=>window.NOVAAISellerState())).storeData.primary_marketplace!==variant.market)throw new Error('Cross-market selection changed primary marketplace');
  if(await page.evaluate(()=>window.__mockWrites)!==0)throw new Error('Unexpected mocked database write in restriction test');
  results.push({marketplace:variant.label,pendingPermissionBlocksListings:true,publishDisabled:true,crossMarketplaceRejected:true,mockWrites:0});await page.close();
 }
 console.log('SELLER_PORTAL_2080_REGRESSION_RESULTS='+JSON.stringify(results));
}finally{await browser.close()}
