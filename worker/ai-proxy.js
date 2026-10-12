export async function handle(request, env, upstreamFetch = fetch) {
  const origin=request.headers.get('Origin')||'';
  const cors={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN||'https://nishad.ai','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400','Vary':'Origin'};
  if(request.method==='OPTIONS') return origin===cors['Access-Control-Allow-Origin']?new Response(null,{status:204,headers:cors}):new Response(null,{status:403});
  if(origin!==cors['Access-Control-Allow-Origin']) return Response.json({error:'origin_not_allowed'},{status:403});
  if(request.method!=='POST') return Response.json({error:'method_not_allowed'},{status:405,headers:cors});
  const raw=await request.arrayBuffer();
  if(raw.byteLength>32768) return Response.json({error:'payload_too_large'},{status:413,headers:cors});
  try { const body=JSON.parse(new TextDecoder().decode(raw)); if(!Array.isArray(body?.messages)) throw new Error(); } catch { return Response.json({error:'invalid_json'},{status:400,headers:cors}); }
  if(!env.MAC_UPSTREAM) return Response.json({error:'mac_not_configured'},{status:503,headers:cors});
  const headers=new Headers(request.headers);headers.set('X-Real-IP',request.headers.get('CF-Connecting-IP')||'unknown');headers.set('User-Agent','curl/8.7.1');
  let upstream;try{upstream=await upstreamFetch(env.MAC_UPSTREAM+'/',{method:'POST',headers,body:raw,redirect:'manual'});}catch(_){return Response.json({error:'mac_unreachable'},{status:502,headers:cors});}
  const out=new Headers(upstream.headers);for(const[k,v]of Object.entries(cors))out.set(k,v);out.set('Cache-Control','no-store, no-transform');
  return new Response(upstream.body,{status:upstream.status,headers:out});
}
export const resetMemory=()=>{};
export default {fetch:(request,env)=>handle(request,env)};
