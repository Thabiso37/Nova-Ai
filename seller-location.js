async function loadSellerPublicLocation(){
 const box=document.getElementById("sellerLocStatus");if(!user)return;
 const {data,error}=await sb.from("seller_public_locations").select("province,city,suburb,latitude,longitude,public_location_enabled,approval_status").eq("user_id",user.id).maybeSingle();
 if(error){if(box)box.textContent="Location settings could not be loaded: "+error.message;return;}
 const v=data||{};
 document.getElementById("sellerLocProvince").value=v.province||"";
 document.getElementById("sellerLocCity").value=v.city||"";
 document.getElementById("sellerLocSuburb").value=v.suburb||"";
 document.getElementById("sellerLocLatitude").value=v.latitude??"";
 document.getElementById("sellerLocLongitude").value=v.longitude??"";
 document.getElementById("sellerLocPublic").checked=!!v.public_location_enabled;
 if(box)box.textContent=!data?"Add your public business/listing area. It remains private until you consent and an administrator approves it.":(v.public_location_enabled?(v.approval_status==="approved"?"Your public business location is approved and visible in Nearby Search.":v.approval_status==="rejected"?"Your location was rejected. Update the details and save again to request a new review.":"Your location is submitted and waiting for administrator approval."):"Your location is saved privately and is not visible to shoppers.");
}
document.getElementById("sellerLocUseGps").addEventListener("click",function(){
 const box=document.getElementById("sellerLocStatus");
 if(!navigator.geolocation){box.textContent="Device location is not supported. Enter coordinates manually.";return;}
 box.textContent="Waiting for permission. Only save this pin if it represents a public business/listing area, not your home.";
 navigator.geolocation.getCurrentPosition(function(p){
  document.getElementById("sellerLocLatitude").value=p.coords.latitude.toFixed(5);
  document.getElementById("sellerLocLongitude").value=p.coords.longitude.toFixed(5);
  box.textContent="Coordinates filled in. They will be rounded to a public area marker for privacy. Review the consent before saving.";
 },function(e){box.textContent=e.code===1?"Permission declined. Enter public coordinates manually.":"Could not detect location. Enter coordinates manually."},{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
});
document.getElementById("sellerLocSave").addEventListener("click",async function(){
 const box=document.getElementById("sellerLocStatus");if(!user){box.textContent="Sign in before saving your location.";return;}
 const lat=document.getElementById("sellerLocLatitude").value.trim(),lon=document.getElementById("sellerLocLongitude").value.trim();
 const payload={user_id:user.id,province:document.getElementById("sellerLocProvince").value||null,city:document.getElementById("sellerLocCity").value.trim()||null,suburb:document.getElementById("sellerLocSuburb").value.trim()||null,latitude:lat===""?null:Number(Number(lat).toFixed(2)),longitude:lon===""?null:Number(Number(lon).toFixed(2)),public_location_enabled:document.getElementById("sellerLocPublic").checked,updated_at:new Date().toISOString()};
 if((lat==="")!==(lon==="")){box.textContent="Enter both latitude and longitude, or leave both blank.";return;}
 if(lat!==""&&(!Number.isFinite(payload.latitude)||payload.latitude < -90||payload.latitude > 90||!Number.isFinite(payload.longitude)||payload.longitude < -180||payload.longitude > 180)){box.textContent="Enter valid GPS coordinates.";return;}
 if(payload.public_location_enabled&&(!payload.province||!payload.city)){box.textContent="Select a province and enter a city/town before making the area public.";return;}
 if(payload.public_location_enabled&&!confirm("Confirm this is a public business/listing area and not your private residential address."))return;
 box.textContent="Saving…";const {error}=await sb.from("seller_public_locations").upsert(payload,{onConflict:"user_id"});
 if(error){box.textContent="Could not save location: "+error.message;return;}
 document.getElementById("sellerLocLatitude").value=payload.latitude??"";
 document.getElementById("sellerLocLongitude").value=payload.longitude??"";
 box.textContent=payload.public_location_enabled?"Location submitted for administrator approval. It will appear in Nearby Search only after approval. Coordinates are rounded to an approximate 1 km area for privacy.":"Location saved privately. It is not visible to shoppers."; await loadSellerPublicLocation();
});