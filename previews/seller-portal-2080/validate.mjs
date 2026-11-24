import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const sellerFile=resolve(new URL('../../seller.html',import.meta.url).pathname);
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
const variants=[{market:'retail',label:'Retail',tool:'My Products',denied:'motors'},{market:'motors',label:'Motors',tool:'My Vehicles',denied:'retail'},{market:'property',label:'Property',tool:'My Properties',denied:'retail'}];
const sizes=[{width:393,height:852,label:'393x852'},{width:360,height:800,label:'360x800'},{width:1440,height:1000,label:'desktop-1440x1000'}];
const mockSupabase=`window.__mockWrites=0;window.__locationUpserts=0;window.__lastLocationPayload=null;window.__fixtureStore=window.__persistedStore||null;window.__fixturePermissions=window.__persistedPermissions||[];window.__fixtureLocation=window.__persistedLocation||null;window.__locationRpcCalls=0;window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithPassword:async()=>({data:{user:{id:'isolated-fixture-user',email:'preview@example.invalid',user_metadata:{full_name:'Preview Seller'}}},error:null}),signOut:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({data:{user:window.__fixtureUser},error:null})},
 from:(table)=>{const q={select(){return this},eq(k,v){if(table==='seller_public_locations')window.__locationLookupFilter={column:k,value:v};return this},in(){return this},order:async()=>({data:[],error:null}),maybeSingle:async()=>window.__locationLoadError&&table==='seller_public_locations'?({data:null,error:{message:'fixture location read failure'}}):({data:table==='seller_stores'?window.__fixtureStore:table==='seller_public_locations'?(window.__fixtureLocation||null):null,error:null}),single:async()=>({data:null,error:null}),insert(){window.__mockWrites++;return this},update(){window.__mockWrites++;return this},upsert(payload){if(table==='seller_public_locations'){window.__mockWrites++;window.__locationUpserts++;window.__lastLocationPayload={...payload};const old=window.__fixtureLocation||{};const changed=['province','city','suburb','latitude','longitude','public_location_enabled'].some(k=>String(old[k]??'')!==String(payload[k]??''));window.__fixtureLocation={...old,...payload,approval_status:changed&&String(old.approval_status||'').toLowerCase()==='approved'?'pending':old.approval_status};window.__persistedLocation=window.__fixtureLocation;}return Promise.resolve({error:null})},delete(){window.__mockWrites++;return this},then(resolve){resolve({data:table==='seller_marketplace_permissions'?(window.__fixturePermissions||[]):[],error:null})}};return q},
 rpc:async(fn)=>{if(fn==='get_my_seller_public_location'){window.__locationRpcCalls++;return window.__locationLoadError?({data:null,error:{message:'fixture location read failure'}}):({data:window.__fixtureLocation,error:null})}return {data:[],error:null}},storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})}
})};`;
const results=[];
let testIteration=0;
async function installMocks(page){await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:mockSupabase}))}
try{
 for(const size of sizes)for(const variant of variants){
  const iteration=++testIteration;
  const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1,isMobile:size.width<500,hasTouch:size.width<500});
  const consoleErrors=[];const pageErrors=[];const rejectedPromises=[];
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('pageerror',e=>pageErrors.push(e.stack||e.message));
  await page.addInitScript(()=>{window.__previewRejectedPromises=[];window.addEventListener('unhandledrejection',event=>{const reason=event.reason;window.__previewRejectedPromises.push(reason?.stack||reason?.message||String(reason))});window.__persistedStore={id:'fixture-store-retail',store_name:'Preview Store',store_slug:'preview-store',status:'approved',primary_marketplace:'retail'};window.__persistedPermissions=[{marketplace:'retail',status:'approved'}];window.__persistedLocation={province:'Gauteng',city:'Pretoria',suburb:'Centurion',latitude:null,longitude:null,public_location_enabled:true,approval_status:'approved'};});await installMocks(page);await page.goto(pathToFileURL(sellerFile).href);await page.waitForFunction(()=>!!window.NOVAAISeller2080);
  // Follow the real unauthenticated seller entry path first. Selecting a marketplace opens the existing sign-in panel and makes the 2080 Account view visible.
  await page.evaluate(market=>window.chooseMarketplace(market),variant.market);
  if(!(await page.locator('#sp2080Account').evaluate(el=>el.classList.contains('active'))))throw new Error('Marketplace selection did not open the Account view');
  if(!(await page.locator('#authForm').isVisible()))throw new Error('Authentication form not visible after marketplace selection');
  await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('fixture-password');
  await page.evaluate(market=>{window.__fixtureStore={id:'fixture-store-'+market,store_name:'Preview Store',store_slug:'preview-store',status:'approved',primary_marketplace:market};window.__persistedStore=window.__fixtureStore;window.__fixturePermissions=[{marketplace:market,status:'approved'}];window.__persistedPermissions=window.__fixturePermissions;window.__fixtureLocation={province:'Gauteng',city:'Pretoria',suburb:'Centurion',latitude:null,longitude:null,public_location_enabled:true,approval_status:'approved'};window.__persistedLocation=window.__fixtureLocation},variant.market);
  await page.locator('#authForm button[type="submit"]').click();
  try{
   await page.waitForFunction(()=>document.getElementById('sp2080Approval')?.textContent.includes('APPROVED'));
  }catch(error){
   const diagnostic=await page.evaluate(market=>{let sellerState=null;try{sellerState=typeof window.NOVAAISellerState==='function'?window.NOVAAISellerState():null}catch(e){sellerState={stateReadError:e?.stack||String(e)}};return{marketplaceVariant:market,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},authenticatedUser:sellerState?.user??sellerState?.authUser??null,storeData:sellerState?.storeData??null,marketplacePermissions:sellerState?.marketplacePermissions??null,approvalText:document.getElementById('sp2080Approval')?.textContent??null,rejectedPromises:window.__previewRejectedPromises||[]}},variant.market).catch(e=>({diagnosticReadError:e?.stack||String(e)}));
   console.error('SELLER_PORTAL_2080_APPROVAL_DIAGNOSTIC='+JSON.stringify({iteration,marketplace:variant.market,viewport:{width:size.width,height:size.height,label:size.label},...diagnostic,consoleErrors,pageErrors,waitError:error?.stack||String(error)},null,2));
   throw error;
  }
  if(await page.locator('#sp2080MarketName').innerText()!==variant.label)throw new Error('Incorrect approved marketplace label');
  if(!(await page.locator('#sp2080Tiles').innerText()).includes(variant.tool))throw new Error('Marketplace-specific listing tile missing');
  if(await page.locator('#changeMarketplaceButton').isVisible().catch(()=>false))throw new Error('Authenticated marketplace switcher visible');
  if(await page.locator('#sellerWorkspace .seller-page-nav').isVisible().catch(()=>false))throw new Error('Legacy navigation visible beside 2080 dashboard');
  if(await page.locator('#sellerWorkspace .selected-market-bar').isVisible().catch(()=>false))throw new Error('Legacy marketplace bar visible beside 2080 dashboard');
  if(await page.locator('html').evaluate(el=>el.scrollWidth>innerWidth))throw new Error('Horizontal overflow at '+size.label);
  await page.screenshot({path:'artifacts/approved-'+variant.market+'-'+size.label+'.png',fullPage:true});
  await page.locator('[data-spview="store"]:visible').first().click();
  if(!(await page.locator('#sp2080Store').evaluate(el=>el.classList.contains('active')))||!(await page.locator('#sellerPublicLocationPanel').isVisible()))throw new Error('My Store/Public Location workflow not visible');
  await page.waitForFunction(()=>document.getElementById('sellerLocProvince')?.value==='Gauteng'&&document.getElementById('sellerLocCity')?.value==='Pretoria'&&document.getElementById('sellerLocSuburb')?.value==='Centurion');
  if(!(await page.locator('#sellerLocPublic').isChecked()))throw new Error('Saved public-location consent was not restored');
  if(await page.evaluate(()=>window.__locationRpcCalls)<1)throw new Error('Seller public location was not loaded through the authenticated get_my_seller_public_location RPC');
  const approvedLocationStatus=await page.locator('#sellerLocStatus').innerText();
  if(!approvedLocationStatus.includes('Approved location area')||!approvedLocationStatus.includes('GPS pin unavailable')||approvedLocationStatus.includes('visible in Nearby Search'))throw new Error('Approved location status is inaccurate when coordinates are absent: '+approvedLocationStatus);
  await page.evaluate(()=>window.loadSellerPublicLocation());
  if(await page.locator('#sellerLocSuburb').inputValue()!=='Centurion')throw new Error('Refreshing My Store did not reload the saved location');
  await page.locator('#sellerLocSave').click();
  if(await page.evaluate(()=>window.__locationUpserts)!==0)throw new Error('Saving an unchanged approved location issued a database upsert');
  if(await page.evaluate(()=>window.__fixtureLocation.approval_status)!=='approved')throw new Error('Saving an unchanged approved location removed administrator approval');
  if(!(await page.locator('#sellerLocPublic').isChecked()))throw new Error('Saving an unchanged approved location removed consent');
  if(!(await page.locator('#sellerLocStatus').innerText()).includes('No changes were needed'))throw new Error('Unchanged approved save did not report that no update was necessary');
  if(size.label==='393x852'&&variant.market==='retail'){
   await page.reload();await page.waitForFunction(()=>!!window.NOVAAISeller2080);
   await page.evaluate(()=>window.chooseMarketplace('retail'));
   if(!(await page.locator('#authForm').isVisible()))throw new Error('Authentication form not visible after marketplace selection on reload');
   await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('fixture-password');await page.locator('#authForm button[type="submit"]').click();
   await page.waitForFunction(()=>document.getElementById('sp2080Approval')?.textContent.includes('APPROVED'));
   await page.locator('[data-spview="store"]:visible').first().click();
   await page.waitForFunction(()=>document.getElementById('sellerLocStatus')?.textContent.includes('Approved location area'));
   if(await page.evaluate(()=>window.__fixtureLocation.approval_status)!=='approved')throw new Error('Ordinary page refresh reset approved location status');
   if(await page.evaluate(()=>window.__mockWrites)!==0)throw new Error('Ordinary page refresh wrote to seller records');
   await page.locator('#sellerLocSuburb').fill('Hatfield');await page.locator('#sellerLocSave').click();
   if(await page.evaluate(()=>window.__locationUpserts)!==1)throw new Error('Intentional approved-location change was not saved for review');
   if(await page.evaluate(()=>window.__lastLocationPayload.approval_status)!==undefined)throw new Error('Seller save attempted to write administrator approval status');
   if(await page.evaluate(()=>window.__fixtureLocation.approval_status)!=='pending')throw new Error('Intentional approved-location change did not enter pending administrator review');
   if(!(await page.locator('#sellerLocPublic').isChecked()))throw new Error('Intentional location change unexpectedly removed existing consent');
   await page.evaluate(()=>window.__locationLoadError=true);
   await page.locator('#sellerLocProvince').selectOption('');
   await page.locator('#sellerLocCity').fill('');
   await page.locator('#sellerLocSuburb').fill('');
   await page.locator('#sellerLocSave').click();
   if(await page.evaluate(()=>window.__locationUpserts)!==1)throw new Error('Save overwrote the record after its authenticated location could not be loaded');
  }

  await page.locator('[data-spview="dashboard"]:visible').first().click();
  await page.locator('#sp2080Tiles [data-spview="access"]').click();
  if(!(await page.locator('#sp2080Access').evaluate(el=>el.classList.contains('active')))||!(await page.locator('#marketplaceAccessStatus').isVisible()))throw new Error('Marketplace Access workflow not visible');
  await page.locator('[data-spview="account"]:visible').first().click();await page.locator('[data-spview="listings"]:visible').first().click();
  if(!(await page.locator('#sp2080Listings').evaluate(el=>el.classList.contains('active'))))throw new Error('Listings view inactive');
  for(const id of ['sellerInventoryPanel','sellerInventoryHeading','sellerInventoryTabs','sellerListingEditorPage','sellerModerationPage','sellerOrdersPage'])if(!(await page.locator('#'+id).isVisible()))throw new Error('Workflow hidden after Account -> Listings: '+id);
  if(!(await page.locator('#sellerForm').isVisible()))throw new Error('Add Listing form hidden');
  if(!(await page.locator('#myProductsList').isVisible()))throw new Error('Existing listings list hidden');
  if(!(await page.locator('#loadOrdersBtn').isVisible()))throw new Error('Orders refresh control hidden');
  await page.locator('#loadOrdersBtn').click();await page.screenshot({path:'artifacts/listings-orders-'+variant.market+'-'+size.label+'.png',fullPage:true});
  const expectedWrites=size.label==='393x852'&&variant.market==='retail'?1:0;if(await page.evaluate(()=>window.__mockWrites)!==expectedWrites)throw new Error('Unexpected mocked database write count: '+await page.evaluate(()=>window.__mockWrites));
  if(consoleErrors.length||pageErrors.length)throw new Error([...consoleErrors,...pageErrors].join('; '));
  results.push({viewport:size.label,marketplace:variant.label,accountGate:true,authenticationForm:true,listingsAndOrders:true,legacyNavigationHidden:true,marketplaceSwitcherHidden:true,noHorizontalOverflow:true,mockWrites:await page.evaluate(()=>window.__mockWrites)});await page.close();
 }
 for(const variant of variants)for(const restriction of ['store-pending','permission-pending']){
  const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});await installMocks(page);await page.goto(pathToFileURL(sellerFile).href);await page.waitForFunction(()=>!!window.NOVAAISeller2080);
  await page.evaluate(({market,restriction})=>{
   window.__fixtureStore={id:'fixture-store-'+market,store_name:'Preview Store',store_slug:'preview-store',status:restriction==='store-pending'?'pending':'approved',primary_marketplace:market};
   window.__fixturePermissions=[{marketplace:market,status:restriction==='permission-pending'?'pending':'approved'}];window.__fixtureLocation={province:'Gauteng',city:'Pretoria',suburb:'Centurion',latitude:null,longitude:null,public_location_enabled:true,approval_status:'pending'};
  },{market:variant.market,restriction});
  await page.evaluate(async()=>window.updateUser({id:'isolated-fixture-user',email:'preview@example.invalid',user_metadata:{full_name:'Preview Seller'}}));
  await page.waitForFunction(()=>document.getElementById('sp2080Gate')?.classList.contains('active'));await page.evaluate(()=>window.NOVAAISeller2080.navigate('store'));await page.waitForFunction(()=>document.getElementById('sellerLocStatus')?.textContent.includes('Pending administrator approval'));if((await page.locator('#sellerLocStatus').innerText()).includes('Approved location area'))throw new Error('Pending public location was presented as approved');await page.evaluate(()=>window.NOVAAISeller2080.navigate('listings'));
  if(!(await page.locator('#sp2080Gate').evaluate(el=>el.classList.contains('active'))))throw new Error(restriction+' did not block Listings: '+variant.label);
  if(await page.locator('#publish').isEnabled())throw new Error('Publish enabled without full approval: '+variant.label+'/'+restriction);
  await page.evaluate(other=>window.chooseMarketplace(other),variant.denied);
  if((await page.evaluate(()=>window.NOVAAISellerState())).storeData.primary_marketplace!==variant.market)throw new Error('Cross-market selection changed primary marketplace');
  if(await page.evaluate(()=>window.__mockWrites)!==0)throw new Error('Unexpected mocked database write in restriction test');
  results.push({marketplace:variant.label,restriction,blocksListings:true,publishDisabled:true,crossMarketplaceRejected:true,mockWrites:0});await page.close();
 }
 console.log('SELLER_PORTAL_2080_REGRESSION_RESULTS='+JSON.stringify(results));
}finally{await browser.close()}
