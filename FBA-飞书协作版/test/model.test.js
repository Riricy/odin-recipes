import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {emptyState,validateState,diffState,applyOps,encode,decode,stateFromRecords,DEFAULT_SETTINGS}from '../server/schema.js';
const makeSku=(id,sku)=>({id,sku,group:'测试',l:130,w:26,h:24,ft3:2.865,category:'oversize',low:null,high:null,stock:1,other:0,daily7:null,daily30:null,daily:2,basis:'manual'});
test('可独立增加SKU，不会用整份JSON覆盖另一人的新增记录',()=>{
 let first=emptyState();let a=structuredClone(first),b=structuredClone(first);
 a.markets.UK.products.push(makeSku('sku-a','SKU-A'));b.markets.UK.products.push(makeSku('sku-b','SKU-B'));
 let combined=applyOps(first,diffState(first,a));combined=applyOps(combined,diffState(first,b));
 assert.deepEqual(combined.markets.UK.products.map(p=>p.sku).sort(),['SKU-A','SKU-B']);
});
test('同一SKU不同字段更新互不覆盖，支持0、空值',()=>{
 let base=emptyState();base.markets.UK.products.push(makeSku('sku-a','SKU-A'));
 let other=structuredClone(base);other.markets.UK.products[0].stock=75;
 let mine=structuredClone(base);mine.markets.UK.products[0].daily=0;mine.markets.UK.products[0].other=null;
 const changes=diffState(base,mine);assert.deepEqual(changes[0].changes,{other:null,daily:0});
 const merged=applyOps(applyOps(base,diffState(base,other)),changes);
 assert.equal(merged.markets.UK.products[0].stock,75);assert.equal(merged.markets.UK.products[0].daily,0);assert.equal(merged.markets.UK.products[0].other,null);
});
test('删除有引用补货批次的SKU被阻止',()=>{
 let state=emptyState();state.markets.DE.products.push(makeSku('sku-a','SKU-A'));
 state.markets.DE.batches.push({id:'batch-1',productId:'sku-a',arrival:'2026-11-20',qty:5});
 assert.throws(()=>applyOps(state,[{kind:'SKU',country:'DE',id:'sku-a',action:'delete'}]),/批次关联/);
});
test('飞书记录能够往返，并保留三国独立设置',()=>{
 const input=makeSku('sku-1','SKU-1');const fields=encode('SKU',{...input,country:'UK'});
 const sku=decode('SKU',fields,'rec1');assert.equal(sku.ft3,2.865);assert.equal(sku.stock,1);
 const got=stateFromRecords({SKU:[{record_id:'rec1',fields}],BATCH:[],SETTINGS:[{record_id:'rec2',fields:encode('SETTINGS',{country:'UK',...DEFAULT_SETTINGS})}]});
 assert.equal(got.markets.UK.products.length,1);assert.equal(got.markets.DE.products.length,0);validateState(got);
});
test('HTML仓储费/补货推演原算法未被修改，HTML脚本保留',()=>{
 const original=fs.readFileSync(path.resolve('..','亚马逊英德法_FBA仓储与补货推演.html'),'utf8');
 const changed=fs.readFileSync('public/index.html','utf8');
 const extract=s=>s.slice(s.indexOf('function simulate(c,m){'),s.indexOf('function checkImport(s){'));
 assert.equal(extract(original),extract(changed));
 assert.ok(changed.includes('data-action="add-product"'));
 assert.ok(changed.includes('data-action="add-batch"'));
 assert.ok(changed.includes('FbaCollab?.create'));
});
