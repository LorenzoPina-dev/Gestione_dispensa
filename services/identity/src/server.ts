import http from "node:http";
import { randomUUID } from "node:crypto";
const port=Number(process.env.PORT??3010),service=process.env.SERVICE_NAME??"identity";
const keycloak=process.env.KEYCLOAK_INTERNAL_URL??"http://keycloak:8080",realm=process.env.KEYCLOAK_REALM??"dispensa";
let requests=0,errors=0,totalMs=0,inFlight=0;
const json=(res:http.ServerResponse,status:number,body:unknown,requestId:string)=>{res.statusCode=status;res.setHeader("content-type","application/json");res.setHeader("x-request-id",requestId);res.end(JSON.stringify(body));};
const log=(level:string,event:string,fields:Record<string,unknown>={})=>console.log(JSON.stringify({ts:new Date().toISOString(),level,service,event,...fields}));
const metrics=(res:http.ServerResponse)=>{res.statusCode=200;res.setHeader("content-type","text/plain; version=0.0.4");res.end(`# TYPE http_requests_total counter
http_requests_total ${requests}
# TYPE http_errors_total counter
http_errors_total ${errors}
# TYPE http_request_duration_ms_sum counter
http_request_duration_ms_sum ${totalMs}
# TYPE http_requests_in_flight gauge
http_requests_in_flight ${inFlight}
`);};
const server=http.createServer(async(req,res)=>{
const started=process.hrtime.bigint(),requestId=String(req.headers["x-request-id"]??randomUUID()),traceparent=String(req.headers.traceparent??"");
inFlight++;res.setHeader("x-request-id",requestId);if(traceparent)res.setHeader("traceparent",traceparent);
try{
if(req.url==="/metrics"){metrics(res);return;}
if(req.url==="/health/live"){json(res,200,{status:"ok",service},requestId);return;}
if(req.url==="/health/ready"){try{const r=await fetch(keycloak+"/realms/"+realm,{signal:AbortSignal.timeout(2000)});json(res,r.ok?200:503,{status:r.ok?"ok":"not_ready",service,keycloakStatus:r.status},requestId);}catch(error){json(res,503,{status:"not_ready",service},requestId);log("error","keycloak.readiness_failed",{requestId},error);}return;}
if(req.url==="/auth/me"){
const auth=req.headers.authorization;
if(!auth?.startsWith("Bearer ")){json(res,401,{error:"missing_token"},requestId);return;}
const t=Date.now();try{
const r=await fetch(keycloak+"/realms/"+realm+"/protocol/openid-connect/userinfo",{headers:{authorization:auth,"x-request-id":requestId,...(traceparent?{traceparent}:{})},signal:AbortSignal.timeout(5000)});
const body=await r.text();res.statusCode=r.status;res.setHeader("content-type","application/json");res.end(body||"{}");
log(r.ok?"info":"warn","keycloak.userinfo",{requestId,status:r.status,durationMs:Date.now()-t});
}catch(error){json(res,502,{error:"identity_provider_unreachable"},requestId);log("error","keycloak.userinfo_failed",{requestId,durationMs:Date.now()-t},error);}return;
}
json(res,404,{error:"route_not_found",service},requestId);
}catch(error){errors++;json(res,500,{error:"internal_error",requestId},requestId);log("error","request.failed",{requestId},error);}
finally{inFlight--;const duration=Number(process.hrtime.bigint()-started)/1e6;requests++;totalMs+=duration;log("info","http.request",{requestId,method:req.method,path:req.url,status:res.statusCode,durationMs:Math.round(duration*10)/10});}
});
server.listen(port,"0.0.0.0",()=>log("info","service.started",{port}));