let sellerLocationLoadSequence=0;
let sellerLocationRecord=null;

async function loadSellerPublicLocation(){
 const box=document.getElementById("sellerLocStatus");
 const targetUser=user;
 if(!targetUser){if(box)box.textContent="Sign in to manage your public seller location.";return null;}
 const request=++sellerLocationLoadSequence;
 if(box)box.textContent="Loading your saved public location…";
 const {data,error}=await sb.from("seller_public_locations")
  .select("province,city,suburb,latitude,longitude,public_location_enabled,approval_status")
  .eq("user_id",targetUser.id).maybeSingle();
 if(request!==sellerLocationLoadSequence||user!==targetUser)return null;
 if(error){if(box)box.textContent="Location settings could not be loaded. Please try again.";console.error("[NOVAAI seller public location]",error);return null;}
 const v=data||{};
 sellerLocationRecord=data?{...v}:null;
 const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value??"";};
 set("sellerLocProvince",v.province);
 set("sellerLocCity",v.city);
 set("sellerLocSuburb",v.suburb);
 set("sellerLocLatitude",v.latitude);
 set("sellerLocLongitude",v.longitude);
 const consent=document.getElementById("sellerLocPublic");if(consent)consent.checked=v.public_location_enabled===true;
 if(!box)return data;
 if(!data){box.textContent="No saved public location was found. Add an area only if you want to share it.";return null;}
 const area=[v.suburb,v.city,v.province].filter(x=>typeof x==="string"&&x.trim()).join(", ");
 const lat=v.latitude,lon=v.longitude;
 const hasPin=lat!==null&&lat!==undefined&&lon!==null&&lon!==undefined&&String(lat).trim()!==""&&String(lon).trim()!==""&&Number.isFinite(Number(lat))&&Number(lat)>=-90&&Number(lat)<=90&&Number.isFinite(Number(lon))&&Number(lon)>=-180&&Number(lon)<=180;
 const approved=v.public_location_enabled===true&&String(v.approval_status||"").toLowerCase()==="approved";
 if(approved){
  box.textContent="Approved location area: "+(area||"Saved area")+". "+(hasPin?"An approximate public GPS pin is available.":"GPS pin unavailable — coordinates not submitted. A map pin and Nearby Search distance are unavailable.");
 }else if(v.public_location_enabled===true&&String(v.approval_status||"").toLowerCase()==="rejected"){
  box.textContent="Location review status: Rejected. The area is not approved for public display.";
 }else if(v.public_location_enabled===true){
  box.textContent="Location review status: Pending administrator approval. The area is not yet approved for public display.";
 }else{
  box.textContent="Location saved privately. Public sharing consent is disabled; this area is not visible to shoppers.";
 }
 return data;
}
window.loadSellerPublicLocation=loadSellerPublicLocation;

document.getElementById("sellerLocUseGps").addEventListener("click",function(){
 const box=document.getElementById("sellerLocStatus");
 if(!navigator.geolocation){box.textContent="Device location is not supported. Enter coordinates manually.";return;}
 box.textContent="Waiting for permission. Only save this pin if it represents a public business/listing area, not your home.";
 navigator.geolocation.getCurrentPosition(function(p){
  document.getElementById("sellerLocLatitude").value=p.coords.latitude.toFixed(5);
  document.getElementById("sellerLocLongitude").value=p.coords.longitude.toFixed(5);
  box.textContent="Coordinates filled in. They will be rounded to a public area marker for privacy. Review the consent before saving.";
 },function(e){box.textContent=e.code===1?"Permission declined. Enter public coordinates manually.":"Could not detect location. Coordinates are optional.";},{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
});
document.getElementById("sellerLocSave").addEventListener("click",async function(){
 const box=document.getElementById("sellerLocStatus"),targetUser=user;
 if(!targetUser){box.textContent="Sign in before saving your location.";return;}
 const lat=document.getElementById("sellerLocLatitude").value.trim(),lon=document.getElementById("sellerLocLongitude").value.trim();
 const province=document.getElementById("sellerLocProvince").value||null;
 const city=document.getElementById("sellerLocCity").value.trim()||null;
 const suburb=document.getElementById("sellerLocSuburb").value.trim()||null;
 const consent=document.getElementById("sellerLocPublic").checked;
 const payload={user_id:targetUser.id,province,city,suburb,latitude:lat===""?null:Number(Number(lat).toFixed(2)),longitude:lon===""?null:Number(Number(lon).toFixed(2)),public_location_enabled:consent,updated_at:new Date().toISOString()};
 if((lat==="")!==(lon==="")){box.textContent="Enter both latitude and longitude, or leave both blank.";return;}
 if(lat!==""&&(!Number.isFinite(payload.latitude)||payload.latitude < -90||payload.latitude > 90||!Number.isFinite(payload.longitude)||payload.longitude < -180||payload.longitude > 180)){box.textContent="Enter valid GPS coordinates.";return;}
 if(consent&&(!province||!city)){box.textContent="Select a province and enter a city/town before making the area public.";return;}
 const alreadyApproved=sellerLocationRecord?.public_location_enabled===true&&String(sellerLocationRecord?.approval_status||"").toLowerCase()==="approved";
 if(consent&&!alreadyApproved&&!confirm("Confirm this is a public business/listing area and not your private residential address."))return;

 // Avoid an UPDATE/UPSERT when the seller has not changed any persisted value.
 // Some existing database review triggers re-queue approval on location UPDATEs;
 // a no-op save must therefore never reach the database.
 const sameText=(a,b)=>String(a??"").trim()===String(b??"").trim();
 const sameCoordinate=(a,b)=>{
  if(a===null||a===undefined||a===""||b===null||b===undefined||b==="")return (a===null||a===undefined||a==="")&&(b===null||b===undefined||b==="");
  return Number(a)===Number(b);
 };
 const saved=sellerLocationRecord;
 const unchanged=!!saved&&
  sameText(saved.province,province)&&sameText(saved.city,city)&&sameText(saved.suburb,suburb)&&
  sameCoordinate(saved.latitude,payload.latitude)&&sameCoordinate(saved.longitude,payload.longitude)&&
  saved.public_location_enabled===consent;
 if(unchanged){
  await loadSellerPublicLocation();
  if(box)box.textContent=alreadyApproved
   ? "Approved location area remains approved. No changes were needed; administrator approval and consent were preserved."
   : box.textContent;
  return;
 }
 box.textContent="Saving…";
 const {error}=await sb.from("seller_public_locations").upsert(payload,{onConflict:"user_id"});
 if(user!==targetUser)return;
 if(error){box.textContent="Could not save location: "+error.message;return;}
 const latitude=document.getElementById("sellerLocLatitude"),longitude=document.getElementById("sellerLocLongitude");
 if(latitude)latitude.value=payload.latitude??"";
 if(longitude)longitude.value=payload.longitude??"";
 await loadSellerPublicLocation();
});
