(function(){
"use strict";
const bucket="novaai-store-branding";
const $=id=>document.getElementById(id);
const state=()=>window.NOVAAISellerState?.()||{};
const client=()=>window.NOVAAI_SUPABASE_CLIENT;
function node(tag,attrs,text){const e=document.createElement(tag);Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;return e;}
function createBrandingPanel(){
 const mount=$("sp2080StoreMount");if(!mount||$("novaStoreBrandingPanel"))return;
 const style=node("style");style.textContent=".nova-branding-panel{margin:14px 0;padding:16px;border:1px solid #087fe0;border-radius:14px;background:#081a3d}.nova-branding-panel h3{margin:0 0 6px;color:#edf6ff}.nova-branding-help,.nova-branding-panel label,.nova-store-public-details{color:#9eb8dc;font-size:12px}.nova-branding-field{min-width:0;padding:12px;border:1px solid #174a83;border-radius:10px}.nova-branding-field img{display:block;width:100%;max-height:160px;object-fit:cover;margin:8px 0;border-radius:8px;background:#fff}.nova-branding-field input{display:block;width:100%;margin:8px 0;color:#edf6ff;font-size:12px}.nova-branding-actions{display:flex;flex-wrap:wrap;gap:7px}.nova-branding-actions button{border:0;border-radius:7px;padding:8px 10px;background:#087fe0;color:white;font-weight:800;font-size:11px}.nova-branding-actions button.secondary{background:#17335c;border:1px solid #42648e}";
 document.head.append(style);
 const panel=node("section",{id:"novaStoreBrandingPanel",class:"nova-branding-panel"});
 panel.innerHTML='<h3>Store Banner</h3><p class="nova-branding-help">Upload a public banner image for your approved store. PNG, JPEG or WebP, maximum 5 MB.</p><div class="nova-branding-field"><label for="novaStoreBannerFile">Store banner</label><img id="novaStoreBannerPreview" alt="Store banner preview" hidden><input id="novaStoreBannerFile" type="file" accept="image/png,image/jpeg,image/webp"><div class="nova-branding-actions"><button type="button" id="novaStoreBannerUpload">Upload / Replace banner</button><button type="button" class="secondary" id="novaStoreBannerRemove">Remove</button></div></div><p id="novaBrandingStatus" role="status"></p><div id="novaStorePublicDetails" class="nova-store-public-details"></div><p class="nova-branding-help">Store reputation: <strong id="novaSellerLikeCount">—</strong> likes · <strong id="novaSellerFollowerCount">—</strong> followers</p>';
 mount.prepend(panel);
 const file=$("novaStoreBannerFile"),preview=$("novaStoreBannerPreview");
 file.addEventListener("change",()=>{const selected=file.files?.[0];if(!selected){preview.hidden=true;return;}if(!/^image\/(png|jpeg|webp)$/.test(selected.type)||selected.size>5*1024*1024){$("novaBrandingStatus").textContent="Choose a PNG, JPEG or WebP image no larger than 5 MB." ;file.value="";return;}preview.src=URL.createObjectURL(selected);preview.hidden=false;});
 $("novaStoreBannerUpload").addEventListener("click",()=>upload());
 $("novaStoreBannerRemove").addEventListener("click",()=>remove());
 loadExisting();
}
function oldAssetPath(url){const marker="/storage/v1/object/public/"+bucket+"/";const i=String(url||"").indexOf(marker);if(i<0)return null;try{return decodeURIComponent(String(url).slice(i+marker.length).split("?")[0]);}catch(_){return null;}}
async function loadExisting(){
 const sb=client(),u=state().user;if(!sb||!u)return;
 const status=$("novaBrandingStatus");status.textContent="Loading store banner…";
 const result=await sb.from("seller_stores").select("store_name,phone,status,store_banner_url").eq("user_id",u.id).maybeSingle();
 if(result.error){status.textContent="Store banner details could not be loaded.";return;}
 const d=result.data||{};
 $("novaStorePublicDetails").textContent="Approved store: "+(d.store_name||"Unavailable")+" · Public contact: "+(d.phone||"Not supplied")+" · Approval: "+(d.status||"Unavailable");
 const img=$("novaStoreBannerPreview");if(d.store_banner_url){img.src=d.store_banner_url;img.hidden=false;}
 const reputation=await sb.rpc("get_seller_store_engagement",{p_store_user_id:u.id});
 const row=Array.isArray(reputation.data)?reputation.data[0]:reputation.data;
 $("novaSellerLikeCount").textContent=reputation.error?"—":String(row?.likes_count??0);
 $("novaSellerFollowerCount").textContent=reputation.error?"—":String(row?.followers_count??0);
 status.textContent="";
}
async function upload(){
 const sb=client(),s=state(),u=s.user,store=s.storeData,file=$("novaStoreBannerFile").files?.[0],status=$("novaBrandingStatus");
 if(!sb||!u||!store||store.status!=="approved"){status.textContent="An approved, signed-in seller store is required.";return;}
 if(!file){status.textContent="Choose a banner image first.";return;}
 const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg",path=u.id+"/banner-"+Date.now()+"."+ext;
 status.textContent="Uploading banner…";
 const {error:uploadError}=await sb.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type});
 if(uploadError){status.textContent="Banner upload failed: "+uploadError.message;return;}
 const url=sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
 const previous=await sb.from("seller_stores").select("store_banner_url").eq("user_id",u.id).maybeSingle();
 const oldPath=previous.data?oldAssetPath(previous.data.store_banner_url):null;
 const {error:updateError}=await sb.from("seller_stores").update({store_banner_url:url}).eq("user_id",u.id);
 if(updateError){await sb.storage.from(bucket).remove([path]);status.textContent="The banner uploaded but the store record could not be updated: "+updateError.message;return;}
 if(oldPath)await sb.storage.from(bucket).remove([oldPath]);
 $("novaStoreBannerFile").value="";
 await loadExisting();status.textContent="Store banner saved.";
}
async function remove(){
 const sb=client(),s=state(),u=s.user,status=$("novaBrandingStatus");if(!sb||!u)return;
 const existing=await sb.from("seller_stores").select("store_banner_url").eq("user_id",u.id).maybeSingle();
 if(existing.error){status.textContent="Banner removal is unavailable: "+existing.error.message;return;}
 const oldPath=oldAssetPath(existing.data?.store_banner_url);
 const {error}=await sb.from("seller_stores").update({store_banner_url:null}).eq("user_id",u.id);
 if(error){status.textContent="Banner removal is unavailable: "+error.message;return;}
 if(oldPath){const removed=await sb.storage.from(bucket).remove([oldPath]);if(removed.error){status.textContent="Banner URL cleared, but the old image could not be deleted: "+removed.error.message;return;}}
 const img=$("novaStoreBannerPreview");img.removeAttribute("src");img.hidden=true;
 $("novaStoreBannerFile").value="";
 status.textContent="Store banner removed.";await loadExisting();
}
document.addEventListener("DOMContentLoaded",()=>{
 createBrandingPanel();
 const mount=$("sp2080StoreMount");
 if(mount)new MutationObserver(()=>createBrandingPanel()).observe(mount,{childList:true});
});
})();