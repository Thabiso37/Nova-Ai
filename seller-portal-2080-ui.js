(function(){
"use strict";
const labels={retail:"Retail",motors:"Motors",property:"Property"};
const icon={dashboard:"⌂",store:"▤",listings:"◇",analytics:"▥",location:"◎",access:"⬡",account:"⚙",orders:"▣",support:"☏"};
let active="dashboard",ready=false,approved=false,market=null,partsAllowed=false;
const $=id=>document.getElementById(id);
function addNav(parent,id,label,ico,disabled=false){const b=document.createElement("button");b.type="button";b.className="sp2080-nav";b.dataset.spview=id;b.dataset.icon=ico;b.textContent=label;if(disabled){b.disabled=true;const s=document.createElement("span");s.className="sp2080-future";s.textContent="Future";b.append(s)}parent.append(b);return b}
function makeTile(id,label,desc,ico,disabled=false){const b=document.createElement("button");b.type="button";b.className="sp2080-tile";b.dataset.spview=id;b.disabled=disabled;const i=document.createElement("span");i.className="sp2080-tileico";i.textContent=ico;const t=document.createElement("span");const strong=document.createElement("b");strong.textContent=label;const small=document.createElement("small");small.textContent=desc;t.append(strong,small);const arrow=document.createElement("span");arrow.className="sp-arrow";arrow.textContent=disabled?"Future":"›";b.append(i,t,arrow);return b}
function createShell(){
 if(ready)return;ready=true;document.body.classList.add("sp2080");
 const shell=document.createElement("div");shell.className="sp2080-shell";shell.id="sp2080Shell";
 shell.innerHTML='<header class="sp2080-top"><div><div class="sp2080-brand">NOVA<span>AI</span></div><div class="sp2080-edition">Seller Portal · 2080 Edition</div></div><div class="sp2080-topright"><span class="sp2080-chip" id="sp2080MarketChip">SELLER CENTRE</span><span class="sp2080-avatar" id="sp2080Avatar">S</span></div></header><div class="sp2080-layout"><aside class="sp2080-side"><nav id="sp2080SideNav"></nav><div class="sp2080-trust">✦ NOVAAI TRUST SHIELD<small>Secure · Trusted · Local</small></div></aside><main class="sp2080-main"><section id="sp2080Dashboard" class="sp2080-view active"><div class="sp2080-welcome"><div><div class="sp2080-kicker">Your business command centre</div><h1>Welcome back, <span id="sp2080SellerName">Seller</span></h1><p>Manage your NOVAAI business from one secure workspace.</p><button class="btn" type="button" data-spview="store">Manage Your Store →</button></div><div class="sp2080-market"><small>Your approved marketplace</small><strong id="sp2080MarketName">Checking…</strong><em id="sp2080Approval">VERIFYING APPROVAL</em></div></div><div class="sp2080-sectionhead"><h2>Business tools</h2><small id="sp2080Caption">Approved seller workspace</small></div><div class="sp2080-tiles" id="sp2080Tiles"></div><div class="sp2080-content"><h3>My Store</h3><p id="sp2080StoreSummary">Your existing store information will appear here after it is verified.</p><button class="btn outline" type="button" data-spview="store">Open My Store →</button></div></section><section id="sp2080Store" class="sp2080-view"><div class="sp2080-content"><h2>My Store</h2><p>Existing store details and approved public location.</p><div id="sp2080StoreMount"></div></div></section><section id="sp2080Listings" class="sp2080-view"><div class="sp2080-content"><h2 id="sp2080ListingsTitle">My Listings</h2><p>Existing listing editor, moderation and order tools are retained below.</p><div id="sp2080ListingMount"></div></div></section><section id="sp2080Access" class="sp2080-view"><div class="sp2080-content"><h2>Marketplace Access</h2><div id="sp2080AccessMount"></div></div></section><section id="sp2080Analytics" class="sp2080-view"><div class="sp2080-content"><h2>Business Analytics</h2><p>Verified business performance data will appear here when supported data sources are available.</p><div class="sp2080-authgate">No analytics are fabricated or estimated in this preview.</div></div></section><section id="sp2080Notifications" class="sp2080-view"><div class="sp2080-content"><h2>Notifications</h2><div class="sp2080-authgate">No live notification source is connected to this integration preview.</div></div></section><section id="sp2080Account" class="sp2080-view"><div class="sp2080-content"><h2>Account &amp; Security</h2><div id="sp2080AccountMount"></div></div></section><section id="sp2080Support" class="sp2080-view"><div class="sp2080-content"><h2>Help &amp; Support</h2><p>Contact NOVAAI support for help with your seller account or application.</p></div></section><section id="sp2080Gate" class="sp2080-view"><div class="sp2080-authgate"><h2 id="sp2080GateTitle">Seller account status</h2><p id="sp2080GateText">Sign in to continue.</p><button class="btn" type="button" id="sp2080OpenAuth">Open seller sign-in</button></div></section></main></div><nav class="sp2080-bottom" aria-label="Seller quick navigation" id="sp2080Bottom"></nav></div>';
 document.body.append(shell);
 const side=$("sp2080SideNav");
 [["dashboard","Dashboard"],["store","My Store"],["listings","My Listings"],["analytics","Business Analytics"],["reputation","Store Reputation"],["notifications","Notifications"],["account","Account & Security"],["support","Help & Support"]].forEach(([id,l])=>addNav(side,id,l,icon[id]||"✧",["reputation"].includes(id)));
 const bottom=$("sp2080Bottom");[["dashboard","Home"],["store","My Store"],["listings","Listings"],["account","Account"],["support","Support"]].forEach(([id,l])=>{const b=document.createElement("button");b.type="button";b.dataset.spview=id;b.innerHTML='<span>'+({dashboard:"⌂",store:"▤",listings:"◇",account:"⚙",support:"☏"}[id])+'</span><span>'+l+'</span>';bottom.append(b)});
 const picker=$("marketplacePicker");if(picker){picker.classList.add("sp2080-registration");shell.before(picker)}
 const workspace=$("sellerWorkspace");if(workspace){workspace.classList.add("hidden")}
 $("sp2080OpenAuth").addEventListener("click",()=>{const p=$("marketplacePicker");p?.scrollIntoView({behavior:"smooth"});$("authForm")?.scrollIntoView({behavior:"smooth"})});
 shell.addEventListener("click",e=>{const b=e.target.closest("[data-spview]");if(b&&!b.disabled)navigate(b.dataset.spview)});
}
function mountExisting(){
 const location=$("sellerPublicLocationPanel"),access=$("marketplaceAccessStatus"),account=$("sellerAccountPanel"),inventory=$("sellerInventoryPanel");
 if(location)$("sp2080StoreMount").append(location);
 if(access)$("sp2080AccessMount").append(access);
 if(account)$("sp2080AccountMount").append(account);
 if(inventory)$("sp2080ListingMount").append(inventory);
 const workspace=$("sellerWorkspace");if(workspace)workspace.classList.add("hidden");
}
function navigate(id){
 if(!approved && !["account","support","gate"].includes(id)){showGate("Marketplace approval is required before seller tools can be opened.");return}
 active=id;
 document.querySelectorAll(".sp2080-view").forEach(x=>x.classList.remove("active"));
 const target=$("sp2080"+({dashboard:"Dashboard",store:"Store",listings:"Listings",access:"Access",analytics:"Analytics",notifications:"Notifications",account:"Account",support:"Support",gate:"Gate"}[id]||"Dashboard"));
 target?.classList.add("active");
 document.querySelectorAll("[data-spview]").forEach(x=>x.classList.toggle("active",x.dataset.spview===id));
 if(id==="store"){ $("sellerPublicLocationPanel")?.classList.remove("hidden");$("marketplaceAccessStatus")?.classList.add("hidden");$("sellerAccountPanel")?.classList.add("hidden");$("sellerInventoryPanel")?.classList.add("hidden")}
 if(id==="access"){$("marketplaceAccessStatus")?.classList.remove("hidden");$("sellerPublicLocationPanel")?.classList.add("hidden")}
 if(id==="account"){$("sellerAccountPanel")?.classList.remove("hidden")}
 if(id==="listings"){$("sellerInventoryPanel")?.classList.remove("hidden");$("sellerInventoryHeading")?.classList.remove("hidden");$("sellerInventoryTabs")?.classList.remove("hidden");$("sellerListingEditorPage")?.classList.remove("hidden");$("sellerModerationPage")?.classList.remove("hidden");$("sellerOrdersPage")?.classList.remove("hidden")}
}
function showGate(message){$("sp2080GateTitle").textContent="Application status";$("sp2080GateText").textContent=message||"Your marketplace application is awaiting administrator approval.";navigate("gate")}
function refresh(){
 createShell();mountExisting();
 const state=window.NOVAAISellerState?.()||{}; const u=state.user,store=state.storeData,perms=state.marketplacePermissions||[];
 if(!u){approved=false;showGate("Sign in or apply as a new seller to access your seller workspace.");return}
 market=store?.primary_marketplace;
 const allowed=!!market&&typeof window.hasMarketplaceAccess==="function"&&window.hasMarketplaceAccess(market);
 approved=allowed;
 $("sp2080Avatar").textContent=(u.email||"S").charAt(0).toUpperCase();
 $("sp2080MarketChip").textContent=market?labels[market]?.toUpperCase()||"SELLER CENTRE":"SELLER APPLICATION";
 $("sp2080SellerName").textContent=store?.store_name||u.user_metadata?.full_name||"Seller";
 $("sp2080StoreSummary").textContent=store?.store_name?store.store_name+" · Store status: "+String(store.status||"not available"):"Existing store information is unavailable.";
 if(!store){showGate("No seller store record was found for this account. Existing registration support remains available.");return}
 if(!allowed){showGate("Your "+(labels[market]||"marketplace")+" application is "+String(store.status||"pending")+". Seller tools remain unavailable until both store and marketplace permission are approved.");return}
 $("sp2080MarketName").textContent=labels[market]||"Approved marketplace";
 $("sp2080Approval").textContent="● STORE & MARKETPLACE APPROVED";
 $("sp2080Caption").textContent=(labels[market]||"Seller")+" seller workspace";
 buildTiles(market);
 $("sp2080ListingsTitle").textContent=({retail:"My Products",motors:"My Vehicles",property:"My Properties"})[market];
 navigate(active==="gate"?"dashboard":active);
}
function buildTiles(market){
 const title=({retail:"My Products",motors:"My Vehicles",property:"My Properties"})[market];
 const tiles=$("sp2080Tiles");tiles.replaceChildren();
 [[ "store","My Store","Store details and public location","▤"],["listings",title,"Manage existing marketplace listings","◇"],["analytics","Business Analytics","Verified data only · no invented figures","▥"],["reputation","Store Reputation","Future feature · unavailable","✦"],["notifications","Notifications","No unverified alerts","♧"],["access","Marketplace Access","View your application status","⬡"],["account","Account & Security","Your existing NOVAAI account","⚙"],["support","Help & Support","Seller assistance","☏"]].forEach(t=>tiles.append(makeTile(t[0],t[1],t[2],t[3],t[0]==="reputation")));
}
window.NOVAAISeller2080={refresh,navigate};
document.addEventListener("DOMContentLoaded",()=>{createShell();mountExisting();refresh()});
})();