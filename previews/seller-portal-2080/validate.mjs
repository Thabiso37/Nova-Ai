import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const sellerFile=resolve(new URL('../../seller.html',import.meta.url).pathname);
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
const variants=[
  {market:'retail',label:'Retail'},
  {market:'motors',label:'Motors'},
  {market:'property',label:'Property'}
];
const sizes=[
  {width:393,height:852,label:'393x852'},
  {width:360,height:800,label:'360x800'},
  {width:1440,height:1000,label:'desktop-1440x1000'}
];
const mockSupabase=`window.__signUpCalls=[];window.supabase={createClient:()=>({
 auth:{
  getSession:async()=>({data:{session:null},error:null}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
  signUp:async(args)=>{window.__signUpCalls.push(args);return {data:{user:{id:'preview-seller',email:args.email,user_metadata:args.options.data},session:null},error:null};},
  signInWithPassword:async()=>({data:{user:null,session:null},error:{message:'Preview sign-in is disabled'}}),
  signOut:async()=>({error:null})
 },
 from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null}),then(resolve){resolve({data:[],error:null})}}),
 rpc:async()=>({data:null,error:null}),
 storage:{from:()=>({upload:async()=>({error:{message:'Preview upload disabled'}}),getPublicUrl:()=>({data:{publicUrl:''}})})}
})};`;
const results=[];
try{
 for(const size of sizes){
  for(const variant of variants){
   const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1,isMobile:size.width<500,hasTouch:size.width<500});
   const pageErrors=[];
   page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
   page.on('console',message=>{if(message.type()==='error')pageErrors.push(message.text());});
   await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:mockSupabase}));
   await page.goto(pathToFileURL(sellerFile).href,{waitUntil:'load'});
   await page.locator('#marketplacePicker').waitFor({state:'visible'});
   await page.locator('[data-marketplace="'+variant.market+'"] button').click();
   if(!(await page.locator('#sellerWorkspace').isVisible()))throw new Error('Seller workspace did not open for '+variant.label);
   if(!(await page.locator('#sellerAccountPanel').isVisible()))throw new Error('Seller sign-in panel did not open for '+variant.label);
   if(!(await page.locator('#authForm').isVisible()))throw new Error('Existing sign-in form is not visible for '+variant.label);
   if(await page.locator('#applicationMarketplace').inputValue()!==variant.market)throw new Error('Selected marketplace was not carried into application for '+variant.label);
   await page.locator('#signup').click();
   if(!(await page.locator('#newSellerFields').isVisible()))throw new Error('New seller application fields did not open for '+variant.label);
   if(!(await page.locator('#sellerSafePolicyAccepted').isVisible()))throw new Error('Safe Meeting acknowledgement is not visible for '+variant.label);
   if(!(await page.locator('#sellerSafePolicyAccepted').isChecked().catch(()=>false))&&!(await page.locator('#sellerSafePolicyAccepted').isVisible()))throw new Error('Policy checkbox unavailable');
   await page.locator('#email').fill('preview@example.invalid');
   await page.locator('#password').fill('fixture-password');
   await page.locator('#sellerRealName').fill('Preview Seller');
   await page.locator('#sellerApplicationStoreName').fill('Preview Store');
   await page.locator('#sellerPhone').fill('0820000000');
   await page.locator('#applicationMarketplace').selectOption(variant.market);
   await page.locator('#signup').click();
   const policyMessage=await page.locator('#authMsg').innerText();
   if(!policyMessage.includes('Please read and accept the Safe Meeting'))throw new Error('Application was not blocked when policy acknowledgement was unchecked: '+policyMessage);
   if(await page.evaluate(()=>window.__signUpCalls.length)!==0)throw new Error('Auth signup ran before policy acknowledgement');
   await page.locator('#sellerSafePolicyAccepted').check();
   await page.locator('#signup').click();
   await page.waitForFunction(()=>window.__signUpCalls.length===1);
   const payload=await page.evaluate(()=>window.__signUpCalls[0]);
   if(payload.options.data.seller_safe_meeting_policy_version!=='1.0'||payload.options.data.seller_safe_meeting_policy_accepted!==true||!payload.options.data.seller_safe_meeting_policy_accepted_at)throw new Error('Policy acceptance metadata missing or incomplete');
   if(payload.options.data.seller_primary_marketplace!==variant.market)throw new Error('Application metadata has the wrong primary marketplace');
   if(!payload.options.emailRedirectTo.includes('market='+variant.market))throw new Error('Email confirmation redirect lost selected marketplace');
   if(!(await page.locator('#authForm button[type="submit"]').isVisible()))throw new Error('Existing sign-in action disappeared');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow at '+size.label);
   await page.screenshot({path:'artifacts/seller-application-'+variant.market+'-'+size.label+'.png',fullPage:true});
   if(pageErrors.length)throw new Error('Browser errors: '+pageErrors.join(' | '));
   results.push({viewport:size.label,marketplace:variant.label,signInFormVisible:true,applicationFieldsVisible:true,policyAcknowledgementRequired:true,signupBlockedWithoutAcknowledgement:true,policyMetadataRecorded:true,marketplacePreserved:true,noHorizontalOverflow:true});
   await page.close();
  }
 }
 console.log('SELLER_APPLICATION_BROWSER_RESULTS='+JSON.stringify(results));
}finally{await browser.close();}
