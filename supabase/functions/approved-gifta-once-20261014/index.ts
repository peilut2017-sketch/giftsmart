import {createClient} from "npm:@supabase/supabase-js@2";
const names:string[]=["13 אווניו","JLY","LI&LA לי ולה","Lusso","The gallery","אביבית","אביבית ויצמן","אדור","אהבה קטנה","אורדמן","אורות","אי המטמון","איצקוביץ","אלתר ספרים","אמירוז","אנג'לס","אסתי פאשן","אצה סושי בר","ארטקס","בגיר","בזאר שטראוס","בזאר שטראוס צעצועים","בייבי דרימס","בייבי סטאר","בלו וויב","בלינק","בננה","בציר","ברודווי","בריליאנט מתנות","ג'ודי","גולד בייבי","גולדיס","גולף","גולף אנד קו","גולף קידס","גלורי","גלינסקי","גרביים עד הבית","דיאמונד טיים","דקור מור","האני בי","הד אובר הילס","הדס","היינה","הכי טוב לבית","הכל בו","הכל לבית","הקולינריום","וופל בר","חיה ג'ולרי","חלום שלי","חן פאשן","חן פלוס","חשמל רוזנברג","טיפטופ","יסכה","יפה נוף פלדהיים","יצא לאור","יריד החשמל והמיזוג","כיתן","כל בו רוטשילד","כלבו בר אילן","לדורות יודאיקה","לה בורסה","לידר","לייבוביץ","ליידיס","לייקרה","ליס הום","מזל חזוט","מיגייט","מיין שיך","מילא","מילר","מיניסט","מלאנז'","מלכות וקסברגר","מנטור","מעיין שטוב עמוס","מעיין שטוב קינג ג'ורג","מצעי עילית","מצעית","מקימי","מקסיגו","מרטי","מרכז התתים","מרקיז","משכן התכלת","מתגים","ניו בורן","ניו וויר פלוס","ניו שוז","נסגל","נעה NOA KIDS&HOME","נעלי גיל","סאטן","סאנשיין צעצועים","סושי אנד בייגל","סושי טוקיו","סושי טיים","סטייליש","סטרצ'","סיליפלוס","סימפוני","סנטר הלבשה בעלזא","ספיישלי","סקול","עולם הפלא-חלוק לכל אחת","עלי כותרת","ענק המשחק","פאביו","פאפיה","פוד אפיל","פוטו מגנה","פולגת","פונפנו","פורצלן","פיין טופ","פיינשילד תכשיטים","פינתה גלידה","פיצה אורי","פמילי פאשן","פנינת החלוק","פסטל בלו","פסיפלורה","פרינסס","פרסטר","צורף","צרכניית הלבשה","קאזה בלה CasaBella","קומיקס","קידישיק","קידס בייסיק","קינדר טויס","קנגרו","קרוקס","רפאלי","רקורד","שאנטי","שהחיינו קולורס","שוזים","שמחונים","שמיז Chemise","שעוני איכות","שף לייזרוביץ","שפירא","שרייבר","תכשיק"];
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY="gifta", SRC="gifta-rashatot-mechabdot", DEF="5029a563-f831-4180-9f08-caa609b9a472";
async function rows(t:string){const {data,error}=await sb.from(t).select("*");if(error)throw error;return data!;}
function stable(v:any):string{if(Array.isArray(v))return JSON.stringify(v.map(x=>JSON.parse(stable(x))));if(v&&typeof v==="object")return JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])));return JSON.stringify(v);}
async function counts(){const o:any={};for(const t of ["vouchers","wallets","super_vouchers","catalog_products"]){const {count,error}=await sb.from(t).select("*",{count:"exact",head:true});if(error)throw error;o[t]=count;}return o;}
Deno.serve(async(req)=>{try{
if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
const secret=Deno.env.get("INGEST_SECRET")||"";if(!secret||(req.headers.get("X-Ingest-Secret")||"")!==secret)return Response.json({error:"unauthorized"},{status:401});
const body=await req.json();if(body.confirm!=="approved-gifta-link-20261014")return Response.json({error:"confirmation_required"},{status:400});
const before=await counts();const defs=await rows("super_vouchers");const g=defs.find(r=>r.id===DEF);
if(!g||g.name!=="גיפטא"||g.catalog_product_key!==null)throw new Error("gifta_row_not_as_expected");
const oldManual:string[]=g.stores_manual||[];const oldStores:string[]=g.stores||[];
if(oldManual.length!==141||oldStores.length!==141)throw new Error("gifta_baseline_changed");
const others=defs.filter(r=>r.id!==DEF);
const prods=await rows("catalog_products");const existing=prods.find(p=>p.product_key===KEY);
const union=new Set([...oldStores,...(names as string[])]);
if(body.dry_run===true)return Response.json({dry_run:true,before,product_exists:!!existing,product_enabled:existing?.enabled??null,names:(names as string[]).length,union:union.size,new_names:(names as string[]).filter(n=>!oldStores.includes(n))});
if(!existing){const {error}=await sb.from("catalog_products").insert({product_key:KEY,display_name_he:"גיפטא",display_name_en:"Gifta",source_type:"gifta",source_identity:{source_key:SRC},enabled:true,min_expected_count:100,max_removal_ratio:0.2,schema_version:1,notes:JSON.stringify({reviewed_at:"2026-10-14",automatic:false})});if(error)throw error;}
else if(!existing.enabled){const {error}=await sb.from("catalog_products").update({enabled:true}).eq("product_key",KEY);if(error)throw error;}
const items=(names as string[]).map(n=>({canonical_name:n,aliases:[]}));
const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(items))))).map(n=>n.toString(16).padStart(2,"0")).join("");
const {data:s,error:e}=await sb.rpc("catalog_apply_snapshot",{p_product_key:KEY,p_source_hash:hash,p_fetched_at:"2026-10-13T23:26:28Z",p_schema_version:1,p_source_identity:{source_key:SRC},p_items:items});if(e)throw e;
const snap=Array.isArray(s)?s[0]:s;if(snap.status!=="applied")throw new Error("snapshot_rejected:"+JSON.stringify(snap));
const {error:le}=await sb.from("super_vouchers").update({catalog_product_key:KEY,stores_manual:oldManual,stores_catalog_version:snap.snapshot_version}).eq("id",DEF);if(le)throw le;
const after=await counts();const final=await rows("super_vouchers");const ng=final.find(r=>r.id===DEF)!;
if(!others.every(r=>stable(r)===stable(final.find(x=>x.id===r.id))))throw new Error("other_definition_changed");
if(stable(ng.stores_manual)!==stable(oldManual))throw new Error("manual_layer_changed");
if(![...union].every(n=>ng.stores.includes(n)))throw new Error("union_missing_names");
if(after.vouchers!==before.vouchers||after.wallets!==before.wallets||after.super_vouchers!==before.super_vouchers)throw new Error("counts_changed");
return Response.json({success:true,before,after,stores_before:oldStores.length,stores_after:ng.stores.length,manual_unchanged:true,others_unchanged:true,snapshot:snap});
}catch(e){return Response.json({success:false,error:String(e)},{status:400});}});
