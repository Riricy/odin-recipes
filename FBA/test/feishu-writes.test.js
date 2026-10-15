import test from 'node:test';
import assert from 'node:assert/strict';
import {Feishu} from '../server/feishu.js';
import {encode,decode,COUNTRIES,DEFAULT_SETTINGS} from '../server/schema.js';

test('实际飞书 API 写入包装：增量更新本地记录映射，不执行整表重读',async()=>{
 const mock=Object.create(Feishu.prototype),calls=[];
 mock.write=async(kind,action,fields,id)=>{
  calls.push({kind,action,fields,id});
  if(action==='create')return {record_id:'rec-new',fields};
  if(action==='update')return {record_id:id};
  return {};
 };
 const products={id:'sku1',country:'UK',sku:'SKU-OLD',group:'组',l:1,w:1,h:1,ft3:1,category:'oversize',low:null,high:null,stock:0,other:0,daily7:0,daily30:0,daily:0,basis:'manual'};
 let records={SKU:[{record_id:'rec-1',fields:encode('SKU',products)}],BATCH:[],SETTINGS:COUNTRIES.map(c=>({record_id:'s-'+c,fields:encode('SETTINGS',{country:c,...DEFAULT_SETTINGS})}))};
 records=await mock.applyChanges([{kind:'SKU',country:'UK',id:'sku1',action:'update',changes:{stock:20}}],records);
 assert.equal(calls.length,1);
 assert.equal(calls[0].action,'update');
 assert.equal(decode('SKU',records.SKU[0].fields,'rec-1').stock,20);
 assert.equal(decode('SKU',records.SKU[0].fields,'rec-1').sku,'SKU-OLD');
 const newProduct={...products,id:'sku2',sku:'SKU-NEW'};
 records=await mock.applyChanges([{kind:'SKU',country:'UK',id:'sku2',action:'create',changes:newProduct}],records);
 assert.equal(calls.length,2);
 assert.equal(records.SKU.length,2);
 assert.equal(decode('SKU',records.SKU[1].fields,'rec-new').sku,'SKU-NEW');
 records=await mock.applyChanges([{kind:'SKU',country:'UK',id:'sku1',action:'delete'}],records);
 assert.equal(records.SKU.length,1);
 assert.equal(records.SKU[0].record_id,'rec-new');
 assert.equal(calls.length,3);
});
