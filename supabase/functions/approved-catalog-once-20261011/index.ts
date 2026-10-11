import {createClient} from "npm:@supabase/supabase-js@2";
import products from "./products.json" with {type:"json"};
const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb=createClient(URL,KEY);
const wallet="37bc6d05-eabc-4ffe-8246-35a0c23872d6";
async function rows(t:string){const {data,error}=await sb.from(t).select("*");if(error)throw error;return data!;}
function stable(v:any):string {if(Array.isArray(v))return JSON.stringify(v.map(x=>JSON.parse(stable(x))));if(v&&typeof v==="object")return JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])));return JSON.stringify(v);}
async function counts(){let out:any={};for(const t of ["vouchers","wallets","super_vouchers","catalog_products","catalog_items"]){const {count,error}=await sb.from(t).select("*",{count:"exact",head:true});if(error)throw error;out[t]=count;}return out;}
Deno.serve(async(req)=>{try{
if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
const secret=Deno.env.get("INGEST_SECRET")||"";const incoming=req.headers.get("X-Ingest-Secret")||"";if(!secret||incoming!==secret)return Response.json({error:"unauthorized"},{status:401});
const body=await req.json();if(body.confirm!=="approved-additions-20261011")return Response.json({error:"confirmation_required"},{status:400});
const before=await counts();const originals=(await rows("super_vouchers")).filter(r=>!products.some(p=>p.key===r.catalog_product_key));
if(originals.length!==11||before.vouchers!==259||before.wallets!==49)throw new Error("baseline_changed");
const w=(await rows("wallets")).find(r=>r.id===wallet);if(!w||w.owner_id!=="28892142-5de0-4e1a-bab6-1e96869544f4")throw new Error("wallet_changed");
const existing=await rows("catalog_products");for(const p of products){const e=existing.find(r=>r.product_key===p.key);if(e&&(e.display_name_he!==p.he||e.display_name_en!==p.en||e.source_identity?.source_key!==p.source))throw new Error("product_conflict:"+p.key);}
if(body.dry_run===true)return Response.json({dry_run:true,before,products:products.map(p=>({key:p.key,count:p.count,partial:p.partial})),originals:originals.length});
const done=[];
for(const p of products){
if(!existing.some(r=>r.product_key===p.key)){const {error}=await sb.from("catalog_products").insert({product_key:p.key,display_name_he:p.he,display_name_en:p.en,source_type:p.mode,source_identity:{source_key:p.source},enabled:true,min_expected_count:Math.floor(p.count*.85),max_removal_ratio:.2,schema_version:1,notes:JSON.stringify({partial:p.partial,reviewed_at:"2026-10-11",automatic:false,source_url:p.url})});if(error)throw error;}
const items=p.names.map(n=>({canonical_name:n,aliases:[]}));const bytes=new TextEncoder().encode(JSON.stringify(items));const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(n=>n.toString(16).padStart(2,"0")).join("");
const {data:s,error:e}=await sb.rpc("catalog_apply_snapshot",{p_product_key:p.key,p_source_hash:hash,p_fetched_at:"2026-10-11T18:11:00Z",p_schema_version:1,p_source_identity:{source_key:p.source},p_items:items});if(e)throw e;const snapshot=Array.isArray(s)?s[0]:s;if(snapshot.status!=="applied"||snapshot.item_count!==p.count)throw new Error("snapshot_rejected:"+p.key+":"+JSON.stringify(snapshot));
const defs=await rows("super_vouchers");const found=defs.filter(r=>r.catalog_product_key===p.key);if(found.length>1)throw new Error("duplicate_definition");
if(found.length===0){const {error}=await sb.from("super_vouchers").insert({wallet_id:wallet,name:p.he+" / "+p.en,description:(p.partial?"רשימה חלקית / Partial list. ":"")+"נבדק ב-11.10.2026, ללא סנכרון אוטומטי / Reviewed 11 Oct 2026, not automatically synced. Check issuer, branch and channel restrictions.",stores_manual:[],balance_check_url:p.url,is_global:true,catalog_product_key:p.key,stores_catalog_version:snapshot.snapshot_version});if(error)throw error;}
const actual=(await rows("super_vouchers")).find(r=>r.catalog_product_key===p.key);if(!actual?.is_global||actual.stores.length!==p.count||actual.stores_manual?.length!==0)throw new Error("definition_check_failed:"+p.key);
done.push({key:p.key,count:p.count,partial:p.partial,id:actual.id});
}
const after=await counts();const final=await rows("super_vouchers");if(!originals.every(r=>stable(r)===stable(final.find(x=>x.id===r.id))))throw new Error("existing_definition_changed");
if(after.vouchers!==before.vouchers||after.wallets!==before.wallets||after.super_vouchers!==16||after.catalog_products!==12||after.catalog_items!==6384)throw new Error("final_counts_failed:"+JSON.stringify(after));
return Response.json({success:true,before,after,done,originals_unchanged:true});
}catch(e){return Response.json({success:false,error:String(e)},{status:400});}});
