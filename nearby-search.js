(function(){
"use strict";
var URL="https://nxplffvklkopwfjaqexo.supabase.co";
var KEY="sb_publishable_dsWU7vWNRN2Nzi5D8JzH3g_W9vNsafQ";
var SEARCH_ENDPOINT=URL+"/functions/v1/nearby-search";
var CONTACT_ENDPOINT=URL+"/functions/v1/property-contact-action";
var point=null, market="all", searchRunId=0, manualSearchTimer=null;
function el(id){return document.getElementById(id)}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function money(n){return "R "+new Intl.NumberFormat("en-ZA",{maximumFractionDigits:2}).format(Number(n)||0)}
function pageMarket(){var requested=new URLSearchParams(location.search).get("market");if(requested==="motors"||requested==="property")return requested;if(document.body.classList.contains("motors-mode"))return "motors";if(document.body.classList.contains("property-mode"))return "property";if(location.pathname.endsWith("retail.html")||location.pathname.endsWith("seller-motors-houses.html"))return "retail";return "all"}
function styles(){if(el("novaNearbyStyles"))return;var s=document.createElement("style");s.id="novaNearbyStyles";s.textContent="#novaNearbyOpen{border:0;border-radius:9px;background:#f5b900;color:#10284b;padding:10px 12px;font-weight:850;white-space:nowrap}#novaNearbyModal{position:fixed;inset:0;z-index:20000;background:#07152dcc;display:none;align-items:flex-end;justify-content:center}#novaNearbyModal.open{display:flex}.nova-nearby-panel{width:min(100%,760px);max-height:94vh;overflow:auto;background:#f5f7fb;border-radius:22px 22px 0 0;padding:17px;color:#172033}.nova-nearby-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.nova-nearby-head h2{font-size:20px;color:#10284b;margin:0}.nova-nearby-close{border:0;background:#e8eef7;border-radius:50%;width:38px;height:38px;font-size:22px;color:#10284b}.nova-nearby-fields{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.nova-nearby-fields input,.nova-nearby-fields select{width:100%;min-width:0;padding:11px;border:1px solid #dce3ed;border-radius:10px;background:#fff}.nova-nearby-wide{grid-column:1/-1}.nova-nearby-actions{display:flex;gap:8px;margin-top:10px}.nova-nearby-actions button{flex:1;border:0;border-radius:10px;padding:12px;font-weight:850}#novaNearbyUse{background:#fff1b8;color:#10284b}#novaNearbySearch{background:#174ea6;color:#fff}#novaNearbyStatus{font-size:12px;color:#5d6b80;line-height:1.5;margin:10px 2px}.nova-nearby-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.nova-nearby-card{min-width:0;background:#fff;border:1px solid #e3e8f0;border-radius:13px;overflow:hidden}.nova-nearby-card img{width:100%;height:150px;object-fit:contain;background:#fff;display:block}.nova-nearby-card-body{padding:10px}.nova-nearby-card h3{font-size:13px;line-height:1.35;margin:0 0 6px;color:#172033}.nova-nearby-price{font-size:17px;font-weight:900;color:#10284b}.nova-nearby-meta{font-size:11px;line-height:1.5;color:#657187;margin-top:5px}.nova-nearby-contact{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.nova-nearby-call,.nova-nearby-wa{display:block;text-align:center;color:#fff;border-radius:8px;padding:9px;margin-top:0;font-size:12px;font-weight:850;text-decoration:none}.nova-nearby-call{background:#174ea6}.nova-nearby-wa{background:#16834a}@media(max-width:420px){.nova-nearby-fields{grid-template-columns:1fr}.nova-nearby-wide{grid-column:auto}.nova-nearby-card img{height:125px}.nova-nearby-panel{padding:14px}}";document.head.appendChild(s)}
function modal(){if(el("novaNearbyModal"))return;var m=document.createElement("div");m.id="novaNearbyModal";m.innerHTML='<section class="nova-nearby-panel" role="dialog" aria-modal="true" aria-labelledby="novaNearbyTitle"><div class="nova-nearby-head"><h2 id="novaNearbyTitle">Search Near Me</h2><button class="nova-nearby-close" id="novaNearbyClose" aria-label="Close">×</button></div><div class="nova-nearby-fields"><input id="novaNearbyQuery" class="nova-nearby-wide" type="search" placeholder="Search products, vehicles or properties"><input id="novaNearbyCity" type="search" placeholder="City / town (manual search)"><input id="novaNearbySuburb" type="search" placeholder="Suburb / area (optional)"><select id="novaNearbyProvince" aria-label="Province (optional)"><option value="">All South African provinces</option><option value="Eastern Cape">Eastern Cape</option><option value="Free State">Free State</option><option value="Gauteng">Gauteng</option><option value="KwaZulu-Natal">KwaZulu-Natal</option><option value="Limpopo">Limpopo</option><option value="Mpumalanga">Mpumalanga</option><option value="North West">North West</option><option value="Northern Cape">Northern Cape</option><option value="Western Cape">Western Cape</option></select><select id="novaNearbyRadius" aria-label="Search radius"><option value="5">Within 5 km</option><option value="10">Within 10 km</option><option value="25" selected>Within 25 km</option><option value="50">Within 50 km</option><option value="100">Within 100 km</option></select></div><div class="nova-nearby-actions"><button id="novaNearbyUse" type="button">Use my location</button><button id="novaNearbySearch" type="button">Search listings</button></div><p id="novaNearbyStatus" aria-live="polite">You can search by city or suburb without sharing your device location. Device coordinates stay in this browser and are not saved to your account. Seller map pins are rounded to about 1 km for privacy, so distances are approximate.</p><div id="novaNearbyResults" class="nova-nearby-results"></div></section>';m.addEventListener("click",function(e){if(e.target===m)close()});document.body.appendChild(m);el("novaNearbyRadius").disabled=true;el("novaNearbyClose").onclick=close;el("novaNearbyUse").onclick=useLocation;el("novaNearbySearch").onclick=search;el("novaNearbyQuery").onkeydown=el("novaNearbyCity").onkeydown=el("novaNearbySuburb").onkeydown=function(e){if(e.key==="Enter")search()};el("novaNearbyProvince").addEventListener("change",function(){scheduleManualSearch(true)});["novaNearbyCity","novaNearbySuburb"].forEach(function(id){var field=el(id);field.addEventListener("input",function(){scheduleManualSearch(false)});field.addEventListener("change",function(){scheduleManualSearch(true)})})}
function close(){el("novaNearbyModal").classList.remove("open")}
function scheduleManualSearch(immediate){if(manualSearchTimer){clearTimeout(manualSearchTimer);manualSearchTimer=null}if(immediate){search();return}manualSearchTimer=setTimeout(function(){manualSearchTimer=null;search()},450)}
function normalizePlace(value){return String(value==null?"":value).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("en-ZA").replace(/\s+/g," ").trim()}
function open(){market=pageMarket();el("novaNearbyModal").classList.add("open");el("novaNearbyStatus").textContent=point?"Your device location is active for this search only.":"Search by city or suburb, or choose Use my location. Sharing device location is optional."}
var locationRequestInProgress=false;
function locationErrorMessage(e){
 if(e&&e.code===1)return "Location permission denied. In Android Settings, allow Location for Chrome and allow this site to access location. You can still search manually by city or suburb.";
 if(e&&e.code===2)return "Your device could not determine a position. Turn on Android Location, check GPS/Wi-Fi, move near a window and retry, or search manually by city or suburb.";
 if(e&&e.code===3)return "Location timed out after two attempts. Check Android Location and Chrome site permission, then retry. You can search manually by city or suburb.";
 return "Location could not be detected. Check Android Location and Chrome site permission, then retry or search manually by city or suburb.";
}
function useLocation(){
 var s=el("novaNearbyStatus"),b=el("novaNearbyUse");
 console.log("[NOVAAI] Use My Location click fired");
 if(locationRequestInProgress){
  s.textContent="A location request is already running. Please wait for it to finish.";
  return;
 }
 if(!navigator.geolocation){
  s.textContent="Location is not supported by this browser. Enter a city or suburb instead.";
  return;
 }
 locationRequestInProgress=true;
 if(b){b.disabled=true;b.textContent="Finding your location..."}
 s.textContent="Finding your location… This may take up to 55 seconds. You can also search manually by city or suburb.";
 var finished=false;
 function finish(){
  if(finished)return;
  finished=true;
  locationRequestInProgress=false;
  if(b){b.disabled=false;b.textContent="Use my location"}
 }
 function success(p){
  if(finished)return;
  if(!p||!p.coords||!Number.isFinite(p.coords.latitude)||!Number.isFinite(p.coords.longitude)){
   finish();s.textContent="The device returned invalid coordinates. No location was used. Please retry or search manually.";return;
  }
  point={lat:p.coords.latitude,lon:p.coords.longitude};
  el("novaNearbyRadius").disabled=false;
  finish();
  s.textContent="Device location found. Searching nearby approved listings…";
  search();
 }
 function fail(e,attempt){
  if(finished)return;
  if(e&&e.code===1){
   point=null;el("novaNearbyRadius").disabled=true;finish();s.textContent=locationErrorMessage(e);return;
  }
  if(attempt===1&&(e&& (e.code===2||e.code===3))){
   s.textContent=e.code===3
    ?"The first GPS attempt timed out. Retrying once with a longer 30-second window…"
    :"GPS is temporarily unavailable. Retrying once with a longer 30-second window…";
   navigator.geolocation.getCurrentPosition(success,function(retryError){
    point=null;el("novaNearbyRadius").disabled=true;finish();s.textContent=locationErrorMessage(retryError);
   },{enableHighAccuracy:false,timeout:30000,maximumAge:0});
   return;
  }
  point=null;el("novaNearbyRadius").disabled=true;finish();s.textContent=locationErrorMessage(e);
 }
 // Prefer a recent cached position when available; low accuracy is sufficient
 // for approximate seller pins and avoids slow high-accuracy GPS acquisition.
 navigator.geolocation.getCurrentPosition(success,function(e){fail(e,1);},
  {enableHighAccuracy:false,timeout:25000,maximumAge:600000});
}
function which(c){c=String(c||"").toLowerCase();if(c==="auto"||c==="motors & vehicles")return "motors";if(c==="property for sale"||c==="property to rent")return "property";return "retail"}
function photo(p){var u=p.image_url||"";if(!u&&Array.isArray(p.images)){for(var i=0;i<p.images.length;i++){if(typeof p.images[i]==="string"){u=p.images[i];break}if(p.images[i]&&p.images[i].url){u=p.images[i].url;break}}}try{var x=new URL(u);return x.protocol==="http:"||x.protocol==="https:"?x.href:""}catch(e){return ""}}
async function search(){
 var status=el("novaNearbyStatus"),box=el("novaNearbyResults"),q=normalizePlace(el("novaNearbyQuery").value),city=normalizePlace(el("novaNearbyCity").value),suburb=normalizePlace(el("novaNearbySubufunction contactUrl(listingId,action){var u=new URL(CONTACT_ENDPOINT);u.searchParams.set("listing_id",String(listingId));u.searchParams.set("action",action);return u.href}
async function search(){
 var status=el("novaNearbyStatus"),box=el("novaNearbyResults"),q=String(el("novaNearbyQuery").value||"").trim(),city=String(el("novaNearbyCity").value||"").trim(),suburb=String(el("novaNearbySuburb").value||"").trim(),province=String(el("novaNearbyProvince").value||"").trim(),radius=Number(el("novaNearbyRadius").value),runId=++searchRunId;
 status.textContent="Searching approved listings…";box.innerHTML="";
 var searchButton=el("novaNearbySearch");if(searchButton)searchButton.textContent="Searching…";
 try{
  var payload={p_marketplace:market,p_lat:point?point.lat:null,p_lon:point?point.lon:null,p_radius_km:radius,p_search_text:q||null,p_city:city||null,p_suburb:suburb||null,p_province:province||null,p_limit:50};
  var response=await fetch(SEARCH_ENDPOINT,{method:"POST",headers:{"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",credentials:"omit"});
  if(!response.ok){var failure=null;try{failure=await response.json()}catch(_e){}throw new Error(failure&&failure.error?failure.error:"Nearby Search is temporarily unavailable (HTTP "+response.status+").")}
  var rows=await response.json();if(!Array.isArray(rows))throw new Error("The Nearby Search service returned an invalid response.");
  if(runId!==searchRunId)return;
  if(!rows.length){
   var title,message;
   if(point){title="No nearby approved listings";message="No eligible approved listings with an approved public business area were found within the selected radius."}
   else if(city||suburb||province){title="No matching approved listings";message="No approved listings matched this marketplace and public locality. Try another city, suburb or province."}
   else if(q){title="No matching approved listings";message="No approved listing matched your search. Try another search term."}
   else{title="No eligible approved listings";message="No approved listings are currently available for this marketplace."}
   box.innerHTML='<div style="grid-column:1/-1;padding:18px;color:#667085;font-size:13px;background:#fff;border-radius:12px"><strong style="display:block;color:#10284b;margin-bottom:6px">'+esc(title)+'</strong>'+esc(message)+'</div>';
   status.textContent=title+". Seller approval and public-location consent checks are enforced by the server.";return;
  }
  box.innerHTML=rows.map(function(p){
   var loc=[p.public_suburb,p.public_city,p.public_province].filter(Boolean).join(", ")||"Seller location not provided";
   var distance=p.distance_band?"Approx. "+p.distance_band+" away":"";
   var img=photo(p),id=String(p.listing_id||""),call=id?contactUrl(id,"call"):"",wa=id?contactUrl(id,"whatsapp"):"";
   var html='<article class="nova-nearby-card">';
   html+=img?'<img src="'+esc(img)+'" alt="'+esc(p.listing_name||"Listing")+'" loading="lazy">':'<div style="height:150px;display:grid;place-items:center;background:#f0f3f8;color:#8290a5;font-size:12px">Image unavailable</div>';
   html+='<div class="nova-nearby-card-body"><h3>'+esc(p.listing_name||"Listing")+'</h3><div class="nova-nearby-price">'+money(p.price)+'</div><div class="nova-nearby-meta">Seller: '+esc(p.seller_display_name||"Approved seller")+'<br>Location: '+esc(loc)+(distance?"<br>"+esc(distance):"")+'</div>';
   if(call||wa)html+='<div class="nova-nearby-contact">'+(call?'<a class="nova-nearby-call" href="'+esc(call)+'">Call seller</a>':"")+(wa?'<a class="nova-nearby-wa" href="'+esc(wa)+'" target="_blank" rel="noopener noreferrer">WhatsApp seller</a>':"")+'</div>';
   html+='</div></article>';return html;
  }).join("");
  status.textContent=rows.length+" approved "+(market==="all"?"marketplace":market)+" listing(s) found. "+(point?"Sorted by server-calculated distance bands using your device location.":"Results are filtered by public locality; no distance is shown without device location.");
 }catch(e){if(runId!==searchRunId)return;status.textContent="Search could not be completed: "+(e.message||"Please try again.")}
 finally{if(runId===searchRunId&&searchButton)searchButton.textContent="Search listings"}
}
fresh.addEventListener("click",function(e){e.preventDefault();console.log("[NOVAAI] Marketplace Near me button click fired");open();useLocation()})}
 else{var head=document.querySelector("header .head");if(head){var b=document.createElement("button");b.id="novaNearbyOpen";b.type="button";b.textContent="📍 Search Near Me";b.onclick=function(){open()};head.appendChild(b)}}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attach);else attach();
window.NOVAAIOpenNearbySearch=open;
})();