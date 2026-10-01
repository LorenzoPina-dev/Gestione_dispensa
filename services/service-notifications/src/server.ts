import express from "express";
import { Pool } from "pg";
import crypto from "node:crypto";

const app=express(); app.use(express.json({limit:"1mb"}));
const port=Number(process.env.PORT??3315); const pool=new Pool({connectionString:process.env.DATABASE_URL});
const fail=(res:express.Response,status:number,code:string,message:string)=>res.status(status).json({error:{code,message,details:[],requestId:crypto.randomUUID()}});
function familyId(req:express.Request){return String(req.query.familyId??req.header("x-family-id")??"");}
async function init(){
 await pool.query(`create schema if not exists notifications_domain`);
 await pool.query(`create table if not exists notifications_domain.notifications(
 id uuid primary key, family_id uuid not null, user_id uuid not null, type varchar(64) not null,
 title varchar(300) not null, body text not null, read_at timestamptz, created_at timestamptz not null default now(), version integer not null default 1
 )`);
 await pool.query(`create table if not exists notifications_domain.preferences(
 user_id uuid primary key, expiration boolean not null default true, low_stock boolean not null default true,
 offers boolean not null default false, family boolean not null default true, system boolean not null default true,
 in_app boolean not null default true, email boolean not null default false, push boolean not null default false, version integer not null default 1
 )`);
 await pool.query(`create index if not exists notifications_family_user_idx on notifications_domain.notifications(family_id,user_id,created_at desc)`);
}
app.get("/health/live",(_q,res)=>res.json({status:"ok",service:"service-notifications"}));
app.get("/health/ready",async(_q,res)=>{try{await pool.query("select 1");res.json({status:"ready",service:"service-notifications"})}catch{res.status(503).json({status:"not_ready"})}});
app.get("/api/v1/notifications",async(req,res)=>{
 const f=familyId(req); const u=String(req.header("x-user-id")??""); if(!f||!u)return fail(res,400,"VALIDATION_ERROR","familyId and authenticated user are required.");
 const limit=Math.min(Math.max(Number(req.query.limit??50),1),100); const unread=req.query.unreadOnly==="true";
 const q=await pool.query(`select id,type,title,body,read_at,created_at from notifications_domain.notifications where family_id=$1 and user_id=$2 and ($3=false or read_at is null) order by created_at desc limit $4`,[f,u,unread,limit]);
 return res.json({items:q.rows.map(x=>({notificationId:x.id,type:x.type,title:x.title,body:x.body,readAt:x.read_at,createdAt:x.created_at})),nextCursor:null});
});
app.post("/api/v1/notifications/:notificationId/read",async(req,res)=>{
 const f=familyId(req),u=String(req.header("x-user-id")??""); if(!f||!u)return fail(res,400,"VALIDATION_ERROR","familyId and authenticated user are required.");
 const q=await pool.query(`update notifications_domain.notifications set read_at=coalesce(read_at,now()),version=version+1 where id=$1 and family_id=$2 and user_id=$3 returning *`,[req.params.notificationId,f,u]);
 if(!q.rowCount)return fail(res,404,"NOT_FOUND","Notification not found.");
 const x=q.rows[0];return res.json({data:{notificationId:x.id,type:x.type,title:x.title,body:x.body,readAt:x.read_at,createdAt:x.created_at},version:x.version});
});
app.get("/api/v1/notifications/preferences",async(req,res)=>{
 const u=String(req.header("x-user-id")??"");if(!u)return fail(res,400,"VALIDATION_ERROR","Authenticated user is required.");
 const q=await pool.query(`insert into notifications_domain.preferences(user_id) values($1) on conflict(user_id) do nothing returning *`,[u]);
 const row=q.rowCount?q.rows[0]:(await pool.query(`select * from notifications_domain.preferences where user_id=$1`,[u])).rows[0];
 return res.json({data:{expiration:row.expiration,lowStock:row.low_stock,offers:row.offers,family:row.family,system:row.system,channels:{inApp:row.in_app,email:row.email,push:row.push},version:row.version}});
});
app.put("/api/v1/notifications/preferences",async(req,res)=>{
 const u=String(req.header("x-user-id")??"");if(!u)return fail(res,400,"VALIDATION_ERROR","Authenticated user is required.");
 const b=req.body??{}; const q=await pool.query(`insert into notifications_domain.preferences(user_id,expiration,low_stock,offers,family,system,in_app,email,push) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(user_id) do update set expiration=excluded.expiration,low_stock=excluded.low_stock,offers=excluded.offers,family=excluded.family,system=excluded.system,in_app=excluded.in_app,email=excluded.email,push=excluded.push,version=notifications_domain.preferences.version+1 returning *`,[u,!!b.expiration,!!b.lowStock,!!b.offers,!!b.family,!!b.system,!!b.channels?.inApp,!!b.channels?.email,!!b.channels?.push]);
 const row=q.rows[0];return res.json({data:{expiration:row.expiration,lowStock:row.low_stock,offers:row.offers,family:row.family,system:row.system,channels:{inApp:row.in_app,email:row.email,push:row.push},version:row.version},version:row.version});
});
app.use((_q,res)=>fail(res,404,"NOT_FOUND","Route not found."));
init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-notifications",port}))).catch(e=>{console.error(e);process.exit(1)});
