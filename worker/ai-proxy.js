export default {
  async fetch(request, env) {
    const origin=request.headers.get('Origin')||'';
    const cors={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400','Vary':'Origin'};
    if(request.method==='OPTIONS') return origin===env.ALLOWED_ORIGIN?new Response(null,{status:204,headers:cors}):new Response(null,{status:403});
    if(origin!==env.ALLOWED_ORIGIN) return Response.json({error:'origin_not_allowed'},{status:403});
    if(request.method!=='POST') return Response.json({error:'method_not_allowed'},{status:405,headers:cors});
    const headers=new Headers(request.headers);
    headers.set('X-Real-IP',request.headers.get('CF-Connecting-IP')||'unknown');
    headers.set('User-Agent','curl/8.7.1');
    let upstream;
    try{upstream=await fetch(env.MAC_UPSTREAM+'/',{method:'POST',headers,body:request.body,redirect:'manual'});}catch(_){return Response.json({error:'mac_unreachable'},{status:502,headers:cors});}
    const out=new Headers(upstream.headers);for(const[k,v]of Object.entries(cors))out.set(k,v);out.set('Cache-Control','no-store, no-transform');
    return new Response(upstream.body,{status:upstream.status,headers:out});
  }
};
