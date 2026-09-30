import http from "node:http";
const port=Number(process.env.PORT??3010),service=process.env.SERVICE_NAME??"identity";
const keycloak=process.env.KEYCLOAK_INTERNAL_URL??"http://keycloak:8080",realm=process.env.KEYCLOAK_REALM??"dispensa";
const json=(res:http.ServerResponse,status:number,body:unknown)=>{res.statusCode=status;res.setHeader("content-type","application/json");res.end(JSON.stringify(body));};
http.createServer(async(req,res)=>{
if(req.url==="/health/live")return json(res,200,{status:"ok",service});
if(req.url==="/health/ready"){try{const r=await fetch(keycloak+"/realms/"+realm);return json(res,r.ok?200:503,{status:r.ok?"ok":"not_ready",service});}catch{return json(res,503,{status:"not_ready",service});}}
if(req.url==="/auth/me"){const auth=req.headers.authorization;if(!auth?.startsWith("Bearer "))return json(res,401,{error:"missing_token"});try{const r=await fetch(keycloak+"/realms/"+realm+"/protocol/openid-connect/userinfo",{headers:{authorization:auth}});const body=await r.text();res.statusCode=r.status;res.setHeader("content-type","application/json");res.end(body||"{}");}catch{return json(res,502,{error:"identity_provider_unreachable"});}return;}
return json(res,404,{error:"route_not_found",service});
}).listen(port,"0.0.0.0");