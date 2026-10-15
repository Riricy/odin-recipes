import {applyOps,validateState} from './schema.js';

export class ConflictError extends Error {
 constructor(conflicts,state){super('检测到其他同事修改了同一条记录/字段，请选择处理方式');this.name='ConflictError';this.conflicts=conflicts;this.state=state;}
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function record(state,kind,country,id){
 const m=state.markets[country];
 if(kind==='SETTINGS')return m;
 return (kind==='SKU'?m.products:m.batches).find(item=>item.id===id);
}
export function conflictsFor(state,ops){
 const conflicts=[];
 for(const op of ops){
  const current=record(state,op.kind,op.country,op.id);
  if(op.action==='create'){
   if(current&&op.kind!=='SETTINGS')conflicts.push({kind:op.kind,country:op.country,id:op.id,field:'*'});
  }else if(op.action==='update'||op.action==='delete'){
   if(!current){conflicts.push({kind:op.kind,country:op.country,id:op.id,field:'*'});continue;}
   // Older clients without an expected snapshot must not be allowed to silently overwrite data.
   if(!op.expected||typeof op.expected!=='object'){
    conflicts.push({kind:op.kind,country:op.country,id:op.id,field:'*'});continue;
   }
   const keys=op.action==='delete' ? Object.keys(op.expected) : Object.keys(op.changes);
   for(const key of keys){if(!equal(current[key],op.expected[key]))conflicts.push({kind:op.kind,country:op.country,id:op.id,field:key});}
  }
 }
 return conflicts;
}
export class SharedStore {
 constructor(api,{refreshMs=20*60*1000,clock=()=>Date.now()}={}){
  this.api=api;this.refreshMs=refreshMs;this.clock=clock;
  this.snapshot=null;this.lastPull=0;this.revision=0;
 }
 info(extra={}){return {...extra,state:this.snapshot.state,revision:this.revision,feishuFetchedAt:this.lastPull,refreshMs:this.refreshMs};}
 async get(force=false){
  const age=this.clock()-this.lastPull;
  if(this.snapshot&&age<this.refreshMs)return this.info({refreshSkipped:!!force,refreshWaitMs:force?this.refreshMs-age:0});
  const fetched=await this.api.read();
  // Always validate incoming state; reject instead of discarding data silently.
  validateState(fetched.state);
  this.snapshot=fetched;this.lastPull=this.clock();this.revision++;
  return this.info({refreshSkipped:false,refreshWaitMs:0});
 }
 async mutate(ops){
  await this.get();
  const conflicts=conflictsFor(this.snapshot.state,ops);
  if(conflicts.length)throw new ConflictError(conflicts,this.snapshot.state);
  const next=applyOps(this.snapshot.state,ops);
  try{
   const updatedRecords=await this.api.applyChanges(ops,this.snapshot.records);
   this.snapshot={state:next,records:updatedRecords};this.revision++;
  }catch(e){
   // Some operations may have succeeded: invalidate cache and require clients to reconcile.
   this.snapshot=null;this.lastPull=0;
   throw new Error('飞书写入可能只完成了一部分，服务端已清除缓存；请先刷新核对数据：'+e.message);
  }
  return this.info();
 }
}
