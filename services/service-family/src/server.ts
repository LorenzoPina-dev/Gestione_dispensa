import { randomUUID } from "node:crypto";
import express from "express";
import { PostgresClient, resolveDatabaseUrl } from "./db/postgres-client.js";
import { OidcTokenVerifier } from "./identity/oidc.js";
import { FamilyService } from "./family/service.js";
import { InviteService } from "./family/invites.js";
import { MembershipService } from "./family/membership.js";
import { PostgresFamilyRepository, PostgresFamilyMembershipReader, PostgresInviteRepository, PostgresMembershipRepository, PostgresUserFamiliesReader } from "./family/postgres.js";
import { FamilyController } from "./family/controller.js";
import { buildFamilyRouter } from "./http/routes/family.js";
import { buildMeta, sendFailure } from "./http/envelope.js";
import { corsMiddleware, requestMetaMiddleware } from "./http/middleware.js";
const port=Number(process.env.PORT??3311); const app=express(); app.use(corsMiddleware()); app.use(requestMetaMiddleware()); app.use(express.json({limit:"2mb"}));
const pg=PostgresClient.create({connectionString:resolveDatabaseUrl()});
const issuer=process.env.OIDC_ISSUER!; const audience=process.env.OIDC_AUDIENCE!;
const verifier=await OidcTokenVerifier.fromIssuer(issuer,audience,fetch,{...(process.env.OIDC_DISCOVERY_URL ? {discoveryUrl:process.env.OIDC_DISCOVERY_URL} : {}),...(process.env.OIDC_JWKS_URL ? {jwksUrl:process.env.OIDC_JWKS_URL} : {})});
const memberships=new MembershipService(new PostgresMembershipRepository(pg));
const families=new FamilyService(new PostgresFamilyRepository(pg),{next:randomUUID},{now:()=>new Date()});
const invites=new InviteService(new PostgresInviteRepository(pg),{next:randomUUID},{now:()=>new Date()});
const controller=new FamilyController(families,invites,new PostgresFamilyMembershipReader(pg),memberships,new PostgresUserFamiliesReader(pg));
app.get('/health/live',(_req,res)=>res.json({status:'ok',service:'service-family'})); app.get('/health/ready',async(_req,res)=>{try{await pg.ping();res.json({status:'ready',service:'service-family'})}catch{res.status(503).json({status:'not_ready'})}});
app.use('/api/v1',buildFamilyRouter({controller,verifier}));

// Never let an unexpected domain/database exception fall through to Express's HTML 500.
// The gateway/web contract is JSON, and a structured 5xx is essential for diagnosing
// bootstrap failures such as a missing profile or an unapplied migration.
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[service-family] unhandled request error", error);
  if (res.headersSent) return;
  const message = error instanceof Error ? error.message : "Internal server error.";
  sendFailure(res, 500, "INTERNAL_ERROR", message, req.meta ?? buildMeta(req));
});

app.use((req,res)=>sendFailure(res,404,'NOT_FOUND_OR_NOT_VISIBLE','The resource is not available.',req.meta??buildMeta(req)));
app.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({service:'service-family',port})));
