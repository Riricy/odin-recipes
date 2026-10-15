import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SharedStore,ConflictError} from '../server/shared-store.js';
import {applyOps} from '../server/schema.js';

const DIR=path.dirname(fileURLToPath(import.meta.url));
const fixture=JSON.parse(fs.readFileSync(path.join(DIR,'../server/initial-data.json'),'utf8'));
const clone=x=>structuredClone(x);
class FakeFeishu {
 constructor(){this.state=clone(fixture);this.reads=0;this.writes=0;}
 async read(){this.reads++;return {state:clone(this.state),records:{SKU:[],BATCH:[],SETTINGS:[]}};}
 async applyChanges(ops,records){this.writes+=ops.length;this.state=applyOps(this.state,ops);return records;}
}
const operation=(kind,country,id,changes,expected)=>({kind,country,id,action:'update',changes,expected});

test('5个用户每隔8秒取服务器数据不会反复调用飞书',async()=>{
 let now=1;const api=new FakeFeishu(),cache=new SharedStore(api,{refreshMs:20*60000,clock:()=>now});
 for(let n=0;n<20;n++)for(let user=0;user<5;user++){await cache.get();now+=8000/5;}
 assert.equal(api.reads,1);
 assert.equal(cache.revision,1);
 now=20*60000+1;await cache.get();assert.equal(api.reads,2);
});

test('他人新增SKU后本地缓存立即可见，无需再次拉取飞书',async()=>{
 const api=new FakeFeishu(),cache=new SharedStore(api);await cache.get();
 const sku={id:'test-shared-id',sku:'TEAM-SKU-001',group:'测试',l:null,w:null,h:null,ft3:null,category:'oversize',low:null,high:null,stock:0,other:0,daily7:null,daily30:null,daily:1,basis:'manual'};
 await cache.mutate([{kind:'SKU',country:'DE',id:sku.id,action:'create',changes:sku}]);
 const current=await cache.get();
 assert.equal(current.state.markets.DE.products.at(-1).sku,'TEAM-SKU-001');
 assert.equal(api.reads,1);
 assert.equal(api.writes,1);
});

test('两个人改同SKU不同字段，两次提交均成功且不发生整表覆盖',async()=>{
 const api=new FakeFeishu(),cache=new SharedStore(api);await cache.get();
 const p=fixture.markets.UK.products[0];
 await cache.mutate([operation('SKU','UK',p.id,{stock:10},{stock:p.stock})]);
 await cache.mutate([operation('SKU','UK',p.id,{daily:2},{daily:p.daily})]);
 const latest=(await cache.get()).state.markets.UK.products[0];
 assert.equal(latest.stock,10);assert.equal(latest.daily,2);assert.equal(api.reads,1);
});

test('同一字段的过期修改遭拒绝，不覆盖同事已经保存的数字',async()=>{
 const api=new FakeFeishu(),cache=new SharedStore(api);await cache.get();
 const p=fixture.markets.UK.products[0];
 await cache.mutate([operation('SKU','UK',p.id,{stock:10},{stock:p.stock})]);
 await assert.rejects(()=>cache.mutate([operation('SKU','UK',p.id,{stock:12},{stock:p.stock})]),e=>{
  assert.ok(e instanceof ConflictError);assert.equal(e.conflicts[0].field,'stock');return true;
 });
 assert.equal((await cache.get()).state.markets.UK.products[0].stock,10);
 assert.equal(api.writes,1);
});

test('飞书后台直接编辑后在刷新周期结束时载入，且按钮不会提前耗额度',async()=>{
 let now=1;const api=new FakeFeishu(),cache=new SharedStore(api,{refreshMs:1200000,clock:()=>now});
 await cache.get();api.state.markets.UK.products[0].stock=49;
 now+=5*60000;const early=await cache.get(true);assert.equal(early.refreshSkipped,true);
 assert.equal(early.state.markets.UK.products[0].stock,null);
 assert.equal(api.reads,1);
 now+=16*60000;const fresh=await cache.get(true);
 assert.equal(fresh.state.markets.UK.products[0].stock,49);
 assert.equal(api.reads,2);
});
