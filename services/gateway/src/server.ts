import http from "node:http";
const port=Number(process.env.PORT??3000);
const routes=[{prefix:"/api/v1/auth",target:process.env.IDENTITY_URL??"http://identity:3010",upstreamPrefix:"/auth"}];
const proxy=async(req:http.IncomingMessage,res:http.ServerResponse,target:string,path:string)=>{
try{const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(k!=="host"&&v)headers.set(k,Array.isArray(v)?v.join(","):v);const upstream=await fetch(target+path,{method:req.method,headers});res.statusCode=upstream.status;upstream.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await upstream.arrayBuffer());}catch{res.statusCode=502;res.setHeader("content-type","application/json");res.end(JSON.stringify({error:"upstream_unavailable"}));}};
http.createServer(async(req,res)=>{
if(req.url==="/health/live")return void(res.end(JSON.stringify({status:"ok",service:"gateway"})));
if(req.url==="/health/ready")return void(res.end(JSON.stringify({status:"ok",service:"gateway",ready:true})));
const match=routes.find(r=>req.url?.startsWith(r.prefix));
if(match){const path=match.upstreamPrefix+(req.url!.slice(match.prefix.length)||"/");return void proxy(req,res,match.target,path);}
res.statusCode=404;res.setHeader("content-type","application/json");res.end(JSON.stringify({error:"route_not_found",service:"gateway"}));
}).listen(port,"0.0.0.0");