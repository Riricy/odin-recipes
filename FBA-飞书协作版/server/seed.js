import fs from 'node:fs';import path from 'node:path';import {Feishu} from './feishu.js';import {ROOT}from './config.js';
import {TABLES,COUNTRIES,encode,emptyState,validateState}from './schema.js';
try{
 const api=new Feishu();const current=await api.listAll();if(Object.values(current).some(a=>a.length))throw Error('目标多维表格已有数据，为保护现有数据拒绝初始化；请换一份新的空多维表格');
 const initial=JSON.parse(fs.readFileSync(path.join(ROOT,'server','initial-data.json'),'utf8'));validateState(initial);
 for(const country of COUNTRIES){const m=initial.markets[country];const settings={country,...Object.fromEntries(['base','days','lead','safety','cover','transfer','factor','billing'].map(k=>[k,m[k]]))};await api.write('SETTINGS','create',encode('SETTINGS',settings));
  for(const p of m.products)await api.write('SKU','create',encode('SKU',{...p,country}));
  for(const b of m.batches)await api.write('BATCH','create',encode('BATCH',{...b,country}));
 }
 console.log('✅ 已导入英国原始4条SKU，以及英德法3个站点的参数。可运行 npm start。');
}catch(e){console.error('初始化失败：'+e.message);process.exitCode=1;}
