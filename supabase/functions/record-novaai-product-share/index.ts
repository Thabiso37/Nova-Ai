import { createClient } from "npm:@supabase/supabase-js@2";
const allowedOrigin="https://thabiso37.github.io";
const corsHeaders={"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"};
function jsonResponse(status:number,body:Record<string,unknown>,extra:Record<string,string>={}){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,...extra}})}
function getDefaultKey(raw:string|undefined):string|null{if(!raw)return null;try{const p=JSON.parse(raw);return typeof p.default==="string"?p.default:null}catch{return null}}
const supabaseUrl=Deno.env.get("SUPABASE_URL"),secretKey=getDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS"))??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),publishableKey=getDefaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))??Deno.env.get("SUPABASE_ANON_KEY");
if(!supabaseUrl||!secretKey||!publishableKey)throw new Error("Required Supabase Edge Function environment configuration is missing");
const supabaseAdmin=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,productIdPattern=/^[1-9][0-9]{0,17}$/;
const marketplaces=new Set(["retail","motors","property"]),shareLocations=new Set(["product_card","detail_page"]);
function getClientIp(req:Request):string|null{const direct=req.headers.get("cf-connecting-ip")??req.headers.get("x-real-ip"),forwarded=req.headers.get("x-forwarded-for"),candidate=(direct||(forwarded?forwarded.split(",")[0]:"")).trim();if(!candidate||candidate.length>64||!/^[0-9a-fA-F:.]+$/.test(candidate))return null;return candidate}
async function fingerprintClientIp(ip:string):Promise<string>{const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secretKey!),{name:"HMAC",hash:"SHA-256"},false,["sign"]),signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(ip));return Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,"0")).join("")}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS"){if(req.headers.get("origin")!==allowedOrigin)return jsonResponse(403,{error:"Origin not allowed"});return new Response("ok",{status:200,headers:corsHeaders})}
 if(req.method!=="POST")return jsonResponse(405,{error:"Method not allowed"});
 if(req.headers.get("origin")!==allowedOrigin)return jsonResponse(403,{error:"Origin not allowed"});
 if(req.headers.get("apikey")!==publishableKey)return jsonResponse(401,{error:"Invalid API key"});
 const length=Number(req.headers.get("content-length")||0);if(length>2048)return jsonResponse(413,{error:"Request body is too large"});
 let payload:unknown;try{payload=await req.json()}catch{return jsonResponse(400,{error:"Invalid JSON body"})}
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||JSON.stringify(payload).length>2048)return jsonResponse(400,{error:"Invalid request body"});
 const b=payload as Record<string,unknown>,eventId=typeof b.event_id==="string"?b.event_id.trim():"",productId=typeof b.product_id==="string"?b.product_id.trim():"",marketplace=typeof b.marketplace==="string"?b.marketplace.trim():"",shareLocation=typeof b.share_location==="string"?b.share_location.trim():"";
 if(!uuidPattern.test(eventId))return jsonResponse(400,{error:"A valid event UUID is required"});
 if(!productIdPattern.test(productId))return jsonResponse(400,{error:"A valid product ID is required"});
 if(!marketplaces.has(marketplace))return jsonResponse(400,{error:"Unknown marketplace"});
 if(!shareLocations.has(shareLocation))return jsonResponse(400,{error:"Unknown share location"});
 const ip=getClientIp(req);if(!ip)return jsonResponse(503,{error:"Product share tracking is temporarily unavailable"});
 let fingerprint:string;try{fingerprint=await fingerprintClientIp(ip)}catch(err){console.error("Product share fingerprint failed:",err);return jsonResponse(503,{error:"Product share tracking is temporarily unavailable"})}
 const {data:allowed,error:limitError}=await supabaseAdmin.rpc("consume_novaai_product_share_rate_limit_v1",{p_client_fingerprint:fingerprint});
 if(limitError){console.error("Product share rate-limit failed:",limitError.message);return jsonResponse(503,{error:"Product share tracking is temporarily unavailable"})}
 if(allowed!==true)return jsonResponse(429,{error:"Product share rate limit exceeded"},{"Retry-After":"60"});
 const {data:recorded,error:recordError}=await supabaseAdmin.rpc("record_novaai_product_share_v1",{p_event_id:eventId,p_product_id:productId,p_marketplace:marketplace,p_share_location:shareLocation});
 if(recordError){console.error("Product share event recording failed:",recordError.message);if(recordError.message.includes("Approved product not found"))return jsonResponse(400,{error:"Approved product not found in the selected marketplace"});return jsonResponse(500,{error:"Product share event could not be recorded"})}
 return jsonResponse(200,{ok:true,recorded:recorded===true,duplicate:recorded===false});
});
