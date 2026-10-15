import {env,requireKeys} from './config.js';
import {TABLES,decode,encode,stateFromRecords,COUNTRIES} from './schema.js';

export class Feishu{
 constructor(){requireKeys(['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_APP_TOKEN']);this.appToken=env('FEISHU_APP_TOKEN');this.token='';this.expires=0;}
 async accessToken(){
  if(this.token&&Date.now()<this.expires)return this.token;
  const response=await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:env('FEISHU_APP_ID'),app_secret:env('FEISHU_APP_SECRET')})});
  const body=await response.json();if(!response.ok||body.code!==0||!body.tenant_access_token)throw Error('飞书身份认证失败：'+(body.msg||response.status));
  this.token=body.tenant_access_token;this.expires=Date.now()+(Math.max(60,(body.expire||7200)-120))*1000;return this.token;
 }
 async req(method,path,body){
  const token=await this.accessToken();const res=await fetch('https://open.feishu.cn/open-apis'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json; charset=utf-8'},body:body===undefined?undefined:JSON.stringify(body)});
  const j=await res.json().catch(()=>({code:res.status,msg:'非 JSON 应答'}));if(!res.ok||j.code!==0){if([99991663,99991668].includes(j.code)){this.token='';}throw Error('飞书 API '+(j.code??res.status)+'：'+(j.msg||'请求失败'));}
  return j.data||{};
 }
 tableId(kind){const v=env(TABLES[kind].env);if(!v)throw Error('缺少 '+TABLES[kind].env+'，请先运行 npm run setup');return v;}
 base(kind){return `/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(this.tableId(kind))}`;}
 async listTableDefinitions(){let page='',items=[];do{const data=await this.req('GET',`/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables?page_size=100${page?'&page_token='+encodeURIComponent(page):''}`);items.push(...(data.items||[]));page=data.has_more?data.page_token:'';}while(page);return items;}
 async createTable(def){const out=await this.req('POST',`/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables`,{table:{name:def.name,fields:def.columns.map(([field_name,type])=>({field_name,type}))}});return out.table_id;}
 async listFields(tableId){let page='',items=[];do{const d=await this.req('GET',`/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${tableId}/fields?page_size=100${page?'&page_token='+encodeURIComponent(page):''}`);items.push(...d.items||[]);page=d.has_more?d.page_token:'';}while(page);return items;}
 async ensureFields(tableId,def){const got=await this.listFields(tableId);for(const [field_name,type]of def.columns){const exists=got.find(f=>f.field_name===field_name);if(exists){if(exists.type!==type)throw Error(`${def.name} 的 ${field_name} 类型不符，应为 ${type}`);continue;}await this.req('POST',`/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${tableId}/fields`,{field_name,type});}}
 async list(kind){const all=[];let page='';do{const suffix=`?page_size=500${page?'&page_token='+encodeURIComponent(page):''}`;const d=await this.req('GET',this.base(kind)+'/records'+suffix);all.push(...(d.items||[]));page=d.has_more?d.page_token:'';}while(page);return all;}
 async listAll(){const all={};for(const kind of Object.keys(TABLES))all[kind]=await this.list(kind);return all;}
 async read(){const records=await this.listAll();return{records,state:stateFromRecords(records)};}
 async write(kind,action,fields,recordId){const path=this.base(kind)+'/records';if(action==='create')return (await this.req('POST',path,{fields})).record;
  if(action==='update')return (await this.req('PUT',path+'/'+encodeURIComponent(recordId),{fields})).record;
  if(action==='delete')return this.req('DELETE',path+'/'+encodeURIComponent(recordId));throw Error('未知操作');}
 async applyChanges(ops,records){
  // Update the local record map from each successful write instead of rereading all 3 tables.
  const updated=Object.fromEntries(Object.entries(records).map(([k,list])=>[k,list.map(r=>({...r,fields:{...r.fields}}))]));
  const ids={};
  for(const kind of Object.keys(TABLES)){
   ids[kind]=new Map();
   for(const rec of updated[kind]){
    const d=decode(kind,rec.fields,rec.record_id);if(!COUNTRIES.includes(d.country))continue;
    const key=d.country+':'+(kind==='SETTINGS'?d.country:d.id);
    if(ids[kind].has(key))throw Error('飞书数据表中存在重复 ID: '+key);
    ids[kind].set(key,rec.record_id);
   }
  }
  for(const op of ops){
   const key=op.country+':'+op.id,recordId=ids[op.kind].get(key);
   const list=updated[op.kind];
   if(op.action==='delete'){
    if(recordId){await this.write(op.kind,'delete',{},recordId);
     updated[op.kind]=list.filter(r=>r.record_id!==recordId);ids[op.kind].delete(key);}
    continue;
   }
   const vals={country:op.country,id:op.id,...op.changes};
   if(recordId){
    if(op.action==='create')throw Error('ID 已在飞书存在');
    const fieldPatch=encode(op.kind,vals,Object.keys(op.changes));
    await this.write(op.kind,'update',fieldPatch,recordId);
    const rec=list.find(r=>r.record_id===recordId);Object.assign(rec.fields,fieldPatch);
   }else{
    if(op.action==='update')throw Error('飞书中找不到该记录');
    const fields=encode(op.kind,vals),created=await this.write(op.kind,'create',fields);
    if(!created?.record_id)throw Error('飞书新建记录未返回 record_id，需重新拉取核对');
    list.push({record_id:created.record_id,fields:{...fields,...(created.fields||{})}});
    ids[op.kind].set(key,created.record_id);
   }
  }
  return updated;
 }
}
