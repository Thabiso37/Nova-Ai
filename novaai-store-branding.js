(function(){
"use strict";
const bucket="novaai-store-branding";
const $=id=>document.getElementById(id);
const state=()=>window.NOVAAISellerState?.()||{};
const client=()=>window.NOVAAI_SUPABASE_CLIENT;
function node(tag,attrs,text){const e=document.createElement(tag);Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;return e;}
function createBrandingPanel(){
 const mount=$("sp2080StoreMount");if(!mount||$("novaStoreBrandingPanel"))return;
 const panel=node("section",{id:"novaStoreBrandingPanel",class:"nova-branding-panel"});
 panel.innerHTML='<h3>Store Branding</h3><p class="nova-branding-help">Add your store logo and banner. Images are stored separately from product listings.</p><div class="nova-branding-grid"><div class="nova-branding-field"><label for="novaStoreLogoFile">Store logo</label><img id="novaStoreLogoPreview" alt="Store logo preview" hidden><input id="novaStoreLogoFile" type="file" accept="image/png,image/jpeg,image/webp"><div class="nova-branding-actions"><button type="button" id="novaStoreLogoUpload">Upload / Replace logo</button><button type="button" class="secondary" id="novaStoreLogoRemove">Remove</button></div></div><div class="nova-branding-field"><label for="novaStoreBannerFile">Store banner</label><img id="novaStoreBannerPreview" alt="Store banner preview" hidden><input id="novaStoreBannerFile" type="file" accept="image/png,image/jpeg,image/webp"><div class="nova-branding-actions"><button type="button" id="novaStoreBannerUpload">Upload / Replace banner</button><button type="button" class="secondary" id="novaStoreBannerRemove">Remove</button></div></div></div><p id="novaBrandingStatus" role="status"></p><div id="novaStorePublicDetails" class="nova-store-public-details"></div>';
 mount.prepend(panel);
 ["logo","banner"].forEach(kind=>{
  const file=$("novaStore"+(kind==="logo"?"Logo":"Banner")+"File"),preview=$("novaStore"+(kind==="logo"?"Logo":"Banner")+"Preview");
  file.addEventListener("change",()=>{const selected=file.files?.[0];if(!selected){preview.hidden=true;return;}if(!/^image\/(png|jpeg|webp)$/.test(selected.type)||selected.size>5*1024*1024){$("novaBrandingStatus").textContent="Choose a PNG, JPEG or WebP image no larger than 5 MB.";file.value="";return;}preview.src=URL.createObjectURL(selected);preview.hidden=false;});
  $("novaStore"+(kind==="logo"?"Logo":"Banner")+"Upload").addEventListener("click",()=>upload(kind));
  $("novaStore"+(kind==="logo"?"Logo":"Banner")+"Remove").addEventListener("click",()=>remove(kind));
 });
 loadExisting();
}
async function loadExisting(){
 const sb=client(),u=state().user;if(!sb||!u)return;
 const status=$("novaBrandingStatus");status.textContent="Loading store branding…";
 const result=await sb.from("seller_stores").select("store_name,phone,status,store_logo_url,store_banner_url").eq("user_id",u.id).maybeSingle();
 if(result.error){status.textContent=/column .* does not exist|schema cache/i.test(result.error.message||"")?"Branding database setup is awaiting approval. Existing store details remain unchanged.":"Store branding could not be loaded.";return;}
 const d=result.data||{};
 $("novaStorePublicDetails").textContent="Approved store: "+(d.store_name||"Unavailable")+" · Public contact: "+(d.phone||"Not supplied")+" · Approval: "+(d.status||"Unavailable");
 [["logo",d.store_logo_url],["banner",d.store_banner_url]].forEach(([kind,url])=>{const img=$(kind==="logo"?"novaStoreLogoPreview":"novaStoreBannerPreview");if(url){img.src=url;img.hidden=false;}});
 status.textContent="";
}
async function upload(kind){
 const sb=client(),s=state(),u=s.user,store=s.storeData,file=$(kind==="logo"?"novaStoreLogoFile":"novaStoreBannerFile").files?.[0],status=$("novaBrandingStatus");
 if(!sb||!u||!store||store.status!=="approved"){status.textContent="An approved, signed-in seller store is required.";return;}
 if(!file){status.textContent="Choose an image first.";return;}
 const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg",path=u.id+"/"+kind+"-"+Date.now()+"."+ext;
 status.textContent="Uploading image…";
 const {error:uploadError}=await sb.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type});
 if(uploadError){status.textContent="Upload unavailable. The required Storage setup may still be awaiting approval.";return;}
 const url=sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
 const column=kind==="logo"?"store_logo_url":"store_banner_url";
 const {error:updateError}=await sb.from("seller_stores").update({[column]:url}).eq("user_id",u.id);
 if(updateError){await sb.storage.from(bucket).remove([path]);status.textContent="The image uploaded but the store record could not be updated. No existing branding was changed.";return;}
 await loadExisting();status.textContent="Store "+kind+" saved.";
}
async function remove(kind){
 const sb=client(),s=state(),u=s.user,status=$("novaBrandingStatus");if(!sb||!u)return;
 const column=kind==="logo"?"store_logo_url":"store_banner_url";
 const {error}=await sb.from("seller_stores").update({[column]:null}).eq("user_id",u.id);
 if(error){status.textContent="Removal is unavailable until the approved Store Branding database setup is applied.";return;}
 const img=$(kind==="logo"?"novaStoreLogoPreview":"novaStoreBannerPreview");img.removeAttribute("src");img.hidden=true;
 const file=$(kind==="logo"?"novaStoreLogoFile":"novaStoreBannerFile");file.value="";
 status.textContent="Store "+kind+" removed.";await loadExisting();
}
document.addEventListener("DOMContentLoaded",()=>{
 createBrandingPanel();
 const mount=$("sp2080StoreMount");
 if(mount)new MutationObserver(()=>createBrandingPanel()).observe(mount,{childList:true});
});
})();