import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {Feishu} from './feishu.js';import {env,ROOT,requireKeys}from './config.js';
import {FIELDS} from './schema.js';
import {SharedStore,ConflictError} from './shared-store.js';
requireKeys(['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_APP_TOKEN','FEISHU_TABLE_SKU','FEISHU_TABLE_BATCH','FEISHU_TABLE_SETTINGS','TEAM_PASSWORD']);
if(env('TEAM_PASSWORD').length<16)throw Error('TEAM_PASSWORD 必须至少16位');
const api=new Feishu(),PORT=Number(env('PORT')||3000),STATIC=path.join(ROOT,'public');
const refreshMinutes=Number(env('FEISHU_REFRESH_MINUTES')||20);
if(!Number.isFinite(refreshMinutes)||refreshMinutes<10||refreshMinutes>1440)throw Error('FEISHU_REFRESH_MINUTES 必须为10–1440分钟');
const store=new SharedStore(api,{refreshMs:refreshMinutes*60000});
let queue=Promise.resolve();
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function authorized(req){const bearer=req.headers.authorization||'',password=env('TEAM_PASSWORD');if(!bearer.startsWith('Bearer '))return false;
 const value=Buffer.from(bearer.slice(7));const expected=Buffer.from(password);return value.length===expected.length&&crypto.timingSafeEqual(value,expected);}
function checkOperations(raw){if(!Array.isArray(raw)||raw.length<1||raw.length>100)throw Error('每次只允许1–100项操作');
 return raw.map(o=>{if(!o||!['SKU','BATCH','SETTINGS'].includes(o.kind)||!['UK','DE','FR'].includes(o.country)||!['create','update','delete'].includes(o.action)||typeof o.id!=='string'||o.id.length>100||!o.id)throw Error('操作类型、站点或记录 ID 无效');
  if(o.kind==='SETTINGS'&&(o.id!==o.country||o.action==='delete'))throw Error('站点设置操作不合法');
  if(o.action!=='delete'&&(!o.changes||typeof o.changes!=='object'||Array.isArray(o.changes)))throw Error('缺少修改字段');
  const clean={};for(const [k,v]of Object.entries(o.changes||{})){
   if(k==='id'&&o.action==='create'&&o.kind!=='SETTINGS'){
    if(v!==o.id)throw Error('新增记录 ID 不一致');
    clean.id=v;continue;
   }
   if(!FIELDS[o.kind][k]||k==='country'||k==='id'||['__proto__','constructor','prototype'].includes(k))throw Error('非法字段 '+k);
   if(v!==null&&typeof v!=='string'&&typeof v!=='number')throw Error('字段值类型错误：'+k);
   if(typeof v==='string'&&v.length>500)throw Error('字段文字过长');
   clean[k]=v;
  }
  if(o.action==='create'&&o.kind!=='SETTINGS'){
   for(const field of Object.keys(FIELDS[o.kind])){if(['id','country'].includes(field))continue;if(!Object.hasOwn(clean,field))throw Error('新增记录缺少字段 '+field);}
  }
  let expected;
  if(o.action!=='create'){
   if(!o.expected||typeof o.expected!=='object'||Array.isArray(o.expected))throw Error('缺少版本对照数据，请刷新网页');
   expected={};for(const [k,v] of Object.entries(o.expected)){
    if(!FIELDS[o.kind][k]||['id','country','__proto__','constructor','prototype'].includes(k))throw Error('非法对照字段 '+k);
    if(v!==null&&typeof v!=='string'&&typeof v!=='number')throw Error('对照值类型错误：'+k);
    expected[k]=v;
   }
   if(o.action==='update'&&Object.keys(clean).some(k=>!Object.hasOwn(expected,k)))throw Error('版本对照字段不完整');
   if(o.action==='delete'&&!Object.keys(expected).length)throw Error('删除操作缺少对照数据');
  }
  return{kind:o.kind,country:o.country,id:o.id,action:o.action,changes:clean,expected};
 });
}
function readBody(req){return new Promise((resolve,reject)=>{let buffer='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>150000){reject(Error('请求过大'));req.destroy();return;}buffer+=chunk;});req.on('end',()=>{try{resolve(JSON.parse(buffer));}catch{reject(Error('JSON 格式不正确'));}});req.on('error',reject);});}
function serialized(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Content-Type-Options','nosniff');
  if(url.pathname.startsWith('/api/')){
   if(!authorized(req))return send(res,401,{ok:false,error:'访问口令错误或已失效'});
   if(url.pathname==='/api/state'&&req.method==='GET'){
    const data=await serialized(()=>store.get());return send(res,200,{ok:true,...data});
   }
   if(url.pathname==='/api/refresh'&&req.method==='POST'){
    const data=await serialized(()=>store.get(true));
    return send(res,200,{ok:true,...data});
   }
   if(url.pathname==='/api/mutate'&&req.method==='POST'){
    const request=await readBody(req),ops=checkOperations(request.ops);
    try{
     const data=await serialized(()=>store.mutate(ops));
     return send(res,200,{ok:true,...data});
    }catch(e){
     if(e instanceof ConflictError)return send(res,409,{ok:false,error:e.message,conflicts:e.conflicts,state:e.state});
     throw e;
    }
   }
   return send(res,404,{ok:false,error:'未找到接口'});
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{ok:false,error:'方法不支持'});
  const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.replace(/^\//,''));
  if(!['index.html','collab.js'].includes(requested))return send(res,404,{ok:false,error:'文件不存在'});
  const file=path.join(STATIC,requested);const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(err){console.error(new Date().toISOString(),err.message);if(!res.headersSent)send(res,err.message.includes('飞书')?502:400,{ok:false,error:err.message});else res.end();}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`FBA 飞书协作版已启动：http://localhost:${PORT}`));
