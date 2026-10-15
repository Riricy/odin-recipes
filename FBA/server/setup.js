import fs from 'node:fs';import path from 'node:path';
import {Feishu} from './feishu.js';import {TABLES} from './schema.js';import {ROOT} from './config.js';
try{
 const api=new Feishu(), existing=await api.listTableDefinitions(),updates={};
 for(const[kind,def]of Object.entries(TABLES)){
  const found=existing.find(t=>t.name===def.name);const id=found?.table_id||await api.createTable(def);
  console.log(`${found?'发现':'创建'} ${def.name}: ${id}`);await api.ensureFields(id,def);updates[def.env]=id;
 }
 const envPath=path.join(ROOT,'.env');let original=fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8'):'';
 for(const[k,v]of Object.entries(updates)){
  const rx=new RegExp('^'+k+'=.*$','m');original=rx.test(original)?original.replace(rx,k+'='+v):original+'\n'+k+'='+v;
 }
 fs.writeFileSync(envPath,original,{mode:0o600});console.log('✅ 已填入 .env 的3个 TABLE_ID。下一步运行 npm run seed');
}catch(e){console.error('配置失败：'+e.message);process.exitCode=1;}
