(function(){
"use strict";
const SUPABASE_URL="https://nxplffvklkopwfjaqexo.supabase.co";
const SUPABASE_KEY="sb_publishable_dsWU7vWNRN2Nzi5D8JzH3g_W9vNsafQ";
const client=()=>window.NOVAAI_SUPABASE_CLIENT||(window.supabase&&window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=v=>"R "+Number(v||0).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2});
function productHref(p){const property=["Property For Sale","Property To Rent"].includes(p.category);return property?"./property-details.html?id="+encodeURIComponent(p.id):"./index.html?product="+encodeURIComponent(p.id);}
async function approvedStores(){
 const sb=client();if(!sb)return new Map();
 const {data,error}=await sb.from("seller_stores").select("user_id,store_slug,store_name").eq("status","approved");
 if(error)throw error;
 return new Map((data||[]).filter(x=>x.user_id&&x.store_slug).map(x=>[String(x.user_id),x]));
}
function addStoreLinks(root,stores){
 root.querySelectorAll("[data-store-owner-id]").forEach(card=>{
  if(card.querySelector(":scope [data-nova-view-store]"))return;
  const store=stores.get(String(card.dataset.storeOwnerId||""));if(!store)return;
  const link=document.createElement("a");link.href="./store-page.html?store="+encodeURIComponent(store.store_slug);
  link.className="nova-store-card-link";link.dataset.novaViewStore="";link.textContent="View Store";
  link.setAttribute("aria-label","View "+store.store_name+" store");
  const host=card.querySelector(".home-product-info,.retail-product-info,.vehicle-card-body,.property-card-info,.property-card-body")||card;
  host.append(link);
 });
}
async function enhanceCards(){
 const sb=client();if(!sb||document.documentElement.dataset.novaStoreLinks==="loading")return;
 document.documentElement.dataset.novaStoreLinks="loading";
 try{
  const stores=await approvedStores();addStoreLinks(document,stores);
  const observer=new MutationObserver(()=>addStoreLinks(document,stores));
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener("click",e=>{const a=e.target.closest("[data-nova-view-store]");if(a)e.stopPropagation();},true);
  document.addEventListener("keydown",e=>{const a=e.target.closest("[data-nova-view-store]");if(a&&(e.key==="Enter"||e.key===" ")){e.stopPropagation();}},true);
  document.documentElement.dataset.novaStoreLinks="ready";
 }catch(error){document.documentElement.dataset.novaStoreLinks="error";console.warn("[NOVAAI Storefront] Store links unavailable",error);}
}
function renderProduct(p){
 const images=Array.isArray(p.images)&&p.images.length?p.images:(p.image_url?[p.image_url]:[]);
 const card=document.createElement("article");card.className="nova-store-product";
 const link=document.createElement("a");link.href=productHref(p);link.className="nova-store-product-main";
 const img=document.createElement("img");img.loading="lazy";img.alt=p.name||"Product";if(images[0])img.src=images[0];
 const name=document.createElement("strong");name.textContent=p.name||"Product";
 const price=document.createElement("span");price.textContent=money(p.price);
 link.append(img,name,price);card.append(link);return card;
}
async function toggleEngagement(sb,table,storeId,userId,button,activeLabel,inactiveLabel){
 button.disabled=true;
 try{
  const {data:existing,error:readError}=await sb.from(table).select("store_user_id").eq("store_user_id",storeId).eq("customer_id",userId).maybeSingle();
  if(readError)throw readError;
  if(existing){const {error}=await sb.from(table).delete().eq("store_user_id",storeId).eq("customer_id",userId);if(error)throw error;}
  else {const {error}=await sb.from(table).insert({store_user_id:storeId,customer_id:userId});if(error)throw error;}
  await refreshEngagement(sb,storeId,userId);
 }catch(error){button.title="This action is not available yet. Please try again later.";console.warn("[NOVAAI Store engagement]",error);}
 finally{button.disabled=false;}
}
async function refreshEngagement(sb,storeId,userId){
 const {data,error}=await sb.rpc("get_seller_store_engagement",{p_store_user_id:storeId});
 const row=Array.isArray(data)?data[0]:data;
 const ok=!error&&!!row;
 const likeCount=document.getElementById("storeLikeCount"),followCount=document.getElementById("storeFollowerCount");
 if(likeCount)likeCount.textContent=ok?String(row.likes_count??0):"—";
 if(followCount)followCount.textContent=ok?String(row.followers_count??0):"—";
 const likeButton=document.getElementById("storeLikeButton"),followButton=document.getElementById("storeFollowButton");
 if(likeButton){likeButton.textContent=row?.liked?"Liked":"Like Store";likeButton.setAttribute("aria-pressed",String(!!row?.liked));}
 if(followButton){followButton.textContent=row?.following?"Following":"Follow Store";followButton.setAttribute("aria-pressed",String(!!row?.following));}
 return ok;
}
async function loadStorePage(){
 const root=document.getElementById("novaStorePage");if(!root)return;
 const sb=client();if(!sb){root.textContent="Store service is unavailable.";return;}
 const slug=new URLSearchParams(location.search).get("store");
 if(!slug){root.textContent="This store link is invalid.";return;}
 root.innerHTML='<div class="nova-store-loading" role="status">Loading approved store…</div>';
 try{
  let result=await sb.from("seller_stores").select("id,user_id,store_name,store_slug,phone,status,store_logo_url,store_banner_url").eq("store_slug",slug).eq("status","approved").maybeSingle();
  if(result.error&&/column .* does not exist|schema cache/i.test(result.error.message||"")){
   result=await sb.from("seller_stores").select("id,user_id,store_name,store_slug,phone,status").eq("store_slug",slug).eq("status","approved").maybeSingle();
  }
  if(result.error)throw result.error;
  const store=result.data;if(!store){root.textContent="This approved store is unavailable.";return;}
  const auth=await sb.auth.getUser();const user=auth.data?.user||null;
  root.innerHTML="";
  const banner=document.createElement("div");banner.className="nova-store-banner";
  if(store.store_banner_url){const image=document.createElement("img");image.src=store.store_banner_url;image.alt=store.store_name+" banner";banner.append(image);}
  const identity=document.createElement("section");identity.className="nova-store-identity";
  if(store.store_logo_url){const logo=document.createElement("img");logo.className="nova-store-logo";logo.src=store.store_logo_url;logo.alt=store.store_name+" logo";identity.append(logo);}
  const info=document.createElement("div");const title=document.createElement("h1");title.textContent=store.store_name;info.append(title);
  const phone=document.createElement("p");phone.className="nova-store-contact";phone.textContent=store.phone?"Public contact: "+store.phone:"Public contact information not supplied.";info.append(phone);
  const counts=document.createElement("div");counts.className="nova-store-counts";counts.innerHTML='<span><b id="storeLikeCount">—</b> likes</span><span><b id="storeFollowerCount">—</b> followers</span>';info.append(counts);
  const actions=document.createElement("div");actions.className="nova-store-actions";
  const like=document.createElement("button");like.id="storeLikeButton";like.type="button";like.textContent="Like Store";
  const follow=document.createElement("button");follow.id="storeFollowButton";follow.type="button";follow.textContent="Follow Store";
  actions.append(like,follow);info.append(actions);identity.append(info);root.append(banner,identity);
  const productHeading=document.createElement("h2");productHeading.className="nova-store-products-heading";productHeading.textContent="Products from this Store";root.append(productHeading);
  const productGrid=document.createElement("div");productGrid.className="nova-store-products";productGrid.id="novaStoreProducts";root.append(productGrid);
  const {data:products,error:productsError}=await sb.from("Products").select("id,name,description,price,category,image_url,images,seller_id,status").eq("seller_id",store.user_id).eq("status","approved").order("created_at",{ascending:false});
  if(productsError)throw productsError;
  (products||[]).forEach(p=>productGrid.append(renderProduct(p)));
  if(!(products||[]).length){const empty=document.createElement("p");empty.className="nova-store-empty";empty.textContent="This store has no public products available right now.";productGrid.append(empty);}
  const engagementReady=await refreshEngagement(sb,store.user_id,user?.id);
  const signedIn=!!user;
  [like,follow].forEach(button=>{button.disabled=!signedIn||!engagementReady;button.title=!signedIn?"Sign in to interact with this store.":!engagementReady?"Store engagement setup is awaiting approval.":"";});
  if(!signedIn||!engagementReady){const hint=document.createElement("p");hint.className="nova-store-signin-hint";hint.textContent=!signedIn?"Sign in to like or follow this store.":"Store likes and follows will become available after the database setup is approved.";actions.after(hint);}
  like.addEventListener("click",()=>toggleEngagement(sb,"seller_store_likes",store.user_id,user.id,like,"Liked","Like Store"));
  follow.addEventListener("click",()=>toggleEngagement(sb,"seller_store_follows",store.user_id,user.id,follow,"Following","Follow Store"));
 }catch(error){console.error("[NOVAAI Store Page]",error);root.textContent="The Store Page could not be loaded. Please try again later.";}
}
document.addEventListener("DOMContentLoaded",()=>{enhanceCards();loadStorePage();});
})();