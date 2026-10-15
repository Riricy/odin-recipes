import {readFileSync} from 'node:fs';
import {encode} from '../server/schema.js';
const data=JSON.parse(readFileSync(new URL('../server/initial-data.json',import.meta.url)));
const tables={SKU:'tblSKU',BATCH:'tblBATCH',SETTINGS:'tblSETTINGS'};
const rows={tblSKU:[],tblBATCH:[],tblSETTINGS:[]};let n=0,apiCalls=0;
for(const [country,market] of Object.entries(data.markets)){
 for(const p of market.products)rows.tblSKU.push({record_id:'rec-'+(++n),fields:encode('SKU',{...p,country})});
 for(const b of market.batches)rows.tblBATCH.push({record_id:'rec-'+(++n),fields:encode('BATCH',{...b,country})});
 rows.tblSETTINGS.push({record_id:'rec-'+(++n),fields:encode('SETTINGS',{country,base:market.base,days:market.days,lead:market.lead,safety:market.safety,cover:market.cover,transfer:market.transfer,factor:market.factor,billing:market.billing})});
}
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input),method=options.method||'GET';
 const res=x=>Response.json(x,{status:200});
 if(url.pathname==='/open-apis/auth/v3/tenant_access_token/internal')return res({code:0,tenant_access_token:'MOCK',expire:7200});
 const matched=url.pathname.match(/\/tables\/(tblSKU|tblBATCH|tblSETTINGS)\/records(?:\/(rec-[0-9]+))?/);
 if(!matched)throw Error('Unexpected mock API request '+method+' '+url);
 apiCalls++;
 const arr=rows[matched[1]],rid=matched[2],body=options.body?JSON.parse(options.body):{};
 if(method==='GET'&&!rid)return res({code:0,data:{items:arr,page_token:'',has_more:false}});
 if(method==='POST'&&!rid){const record={record_id:'rec-'+(++n),fields:body.fields};arr.push(record);return res({code:0,data:{record}});}
 if(method==='PUT'&&rid){const r=arr.find(x=>x.record_id===rid);Object.assign(r.fields,body.fields);return res({code:0,data:{record:r}});}
 if(method==='DELETE'&&rid){const i=arr.findIndex(x=>x.record_id===rid);if(i>=0)arr.splice(i,1);return res({code:0,data:{}});}
 return res({code:1250001,msg:'unhandled mock request'});
};
process.on('SIGTERM',()=>{console.log('mock Feishu API calls '+apiCalls);process.exit()});
