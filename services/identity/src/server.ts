import { createServer } from 'node:http';
const port=Number(process.env.PORT??3010); const service=process.env.SERVICE_NAME??'identity';
createServer((req,res)=>{res.setHeader('content-type','application/json'); if(req.url==='/health/live'||req.url==='/health/ready'){res.end(JSON.stringify({status:'ok',service,ready:true}));return;} res.statusCode=404;res.end(JSON.stringify({error:'route_not_implemented',service}));}).listen(port,'0.0.0.0');
