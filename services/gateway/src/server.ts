import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);
const service = process.env.SERVICE_NAME ?? 'gateway';

const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health/live') return void res.end(JSON.stringify({ status: 'ok', service }));
  if (req.url === '/health/ready') return void res.end(JSON.stringify({ status: 'ok', service, ready: true }));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'route_not_implemented', service }));
});
server.listen(port, '0.0.0.0');
