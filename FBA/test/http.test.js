import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=33581,url=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),FEISHU_APP_ID:'cli_test',FEISHU_APP_SECRET:'mocksecret',FEISHU_APP_TOKEN:'bas_mock',FEISHU_TABLE_SKU:'tblSKU',FEISHU_TABLE_BATCH:'tblBATCH',FEISHU_TABLE_SETTINGS:'tblSETTINGS',TEAM_PASSWORD:'top-secret-password-for-demo'};
async function request(pathname,method='GET',data){const r=await fetch(url+pathname,{method,headers:{Authorization:'Bearer '+env.TEAM_PASSWORD,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return [r.status,await r.json()];}

test('真实 HTTP 路由：新增SKU、双浏览器共享读写、过期修改409冲突、刷新不耗额度', {timeout:15000},async()=>{
 const child=spawn(process.execPath,['--import',path.join(root,'test','mock-feishu.mjs'),'server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
 try{
  let ready=false;
  for(let n=0;n<50;n++){
   if(child.exitCode!==null)throw Error('Server stopped: '+output);
   try{const r=await fetch(url+'/collab.js');if(r.ok){ready=true;break;}}catch{}
   await sleep(100);
  }
  assert.ok(ready,'测试服务器未启动：'+output);
  const [s0,a]=await request('/api/state');assert.equal(s0,200);
  const p=a.state.markets.UK.products[0],sku={id:'mock-http-sku',sku:'TEAM-NEW-SKU',group:'测试',l:null,w:null,h:null,ft3:null,category:'oversize',low:null,high:null,stock:0,other:0,daily7:null,daily30:null,daily:1,basis:'manual'};
  const [s1]=await request('/api/mutate','POST',{ops:[{kind:'SKU',country:'UK',id:sku.id,action:'create',changes:sku}]});assert.equal(s1,200);
  const [s2,b]=await request('/api/state');assert.equal(s2,200);assert.ok(b.state.markets.UK.products.some(x=>x.sku==='TEAM-NEW-SKU'));
  const [s3]=await request('/api/mutate','POST',{ops:[{kind:'SKU',country:'UK',id:p.id,action:'update',changes:{stock:42},expected:{stock:p.stock}}]});assert.equal(s3,200);
  const [s4,conflict]=await request('/api/mutate','POST',{ops:[{kind:'SKU',country:'UK',id:p.id,action:'update',changes:{stock:99},expected:{stock:p.stock}}]});assert.equal(s4,409);assert.equal(conflict.conflicts[0].field,'stock');
  const [s5,refresh]=await request('/api/refresh','POST');assert.equal(s5,200);assert.equal(refresh.refreshSkipped,true);
 }finally{child.kill('SIGTERM');}
});
