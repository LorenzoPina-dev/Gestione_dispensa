import {createServer} from "node:http";
const port=Number(process.env.PORT??3315);
const service=process.env.SERVICE_NAME??"service-notifications";
const server=createServer((req,res)=>{if(req.url==="/health/live"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({status:"ok",service}));}if(req.url==="/health/ready"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({status:"ready",service}));}res.writeHead(404,{"content-type":"application/json"});res.end(JSON.stringify({error:{code:"NOT_FOUND",message:"Route not found."}}));});
server.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service,port})));
