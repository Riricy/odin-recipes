export const COUNTRIES=['UK','DE','FR'];
export const TABLES={
 SKU:{env:'FEISHU_TABLE_SKU',name:'FBA_SKU',columns:[
  ['ID',1],['国家',1],['SKU',1],['产品组',1],['长cm',2],['宽cm',2],['高cm',2],['计费体积ft3',2],['仓储分类',1],['淡季覆盖费率',2],['旺季覆盖费率',2],['FBA可售库存',2],['其他计费库存',2],['近7天日销',2],['近30天日销',2],['计划日销',2],['日销来源',1]
 ]},
 BATCH:{env:'FEISHU_TABLE_BATCH',name:'FBA_补货批次',columns:[['ID',1],['国家',1],['关联SKU_ID',1],['预计入仓日期',1],['批次数量',2]]},
 SETTINGS:{env:'FEISHU_TABLE_SETTINGS',name:'FBA_站点设置',columns:[['国家',1],['库存基准日期',1],['推演天数',2],['下单到可售天数',2],['安全库存天数',2],['补货覆盖天数',2],['入仓转可售天数',2],['销量系数',2],['计费口径',1]]}
};
export const FIELDS={
 SKU:{id:'ID',country:'国家',sku:'SKU',group:'产品组',l:'长cm',w:'宽cm',h:'高cm',ft3:'计费体积ft3',category:'仓储分类',low:'淡季覆盖费率',high:'旺季覆盖费率',stock:'FBA可售库存',other:'其他计费库存',daily7:'近7天日销',daily30:'近30天日销',daily:'计划日销',basis:'日销来源'},
 BATCH:{id:'ID',country:'国家',productId:'关联SKU_ID',arrival:'预计入仓日期',qty:'批次数量'},
 SETTINGS:{country:'国家',base:'库存基准日期',days:'推演天数',lead:'下单到可售天数',safety:'安全库存天数',cover:'补货覆盖天数',transfer:'入仓转可售天数',factor:'销量系数',billing:'计费口径'}
};
export const NUMBERS={SKU:new Set(['l','w','h','ft3','low','high','stock','other','daily7','daily30','daily']),BATCH:new Set(['qty']),SETTINGS:new Set(['days','lead','safety','cover','transfer','factor'])};
export const DEFAULT_SETTINGS={base:'',days:180,lead:null,safety:null,cover:null,transfer:null,factor:1,billing:'end'};
export function emptyState(){return{format:'fba-europe-v1',fileId:'feishu-shared-v1',active:'UK',markets:Object.fromEntries(COUNTRIES.map(c=>[c,{...DEFAULT_SETTINGS,products:[],batches:[]}]))};}
export function textVal(raw){if(typeof raw==='string')return raw;if(Array.isArray(raw))return raw.map(x=>x.text||'').join('');return raw==null?'':String(raw);}
export function decode(kind,fields,recordId){const result={};for(const [k,title] of Object.entries(FIELDS[kind])){
 const raw=fields[title];result[k]=NUMBERS[kind].has(k)?(typeof raw==='number'?raw:raw==null||raw===''?null:Number(textVal(raw))):textVal(raw);
 }if(kind!=='SETTINGS'&&!result.id)result.id=recordId;
 if(kind==='SKU'){result.category=result.category||'oversize';result.basis=result.basis||'manual';}
 if(kind==='SETTINGS')for(const [k,v]of Object.entries(DEFAULT_SETTINGS))if(fields[FIELDS[kind][k]]===undefined)result[k]=v;
 return result;
}
export function encode(kind,obj,keys=Object.keys(FIELDS[kind])){const fields={};for(const key of keys){
 if(key==='country'&&kind!=='SETTINGS'||FIELDS[kind][key]){
 const title=FIELDS[kind][key];if(!title)continue;
 const val=obj[key];if(val===undefined)continue;
 fields[title]=NUMBERS[kind].has(key)?(val===null?null:Number(val)):(val??'');
 }}return fields;}
export function stateFromRecords(records){const state=emptyState();
 for(const [kind,entries]of Object.entries(records))for(const x of entries){const data=decode(kind,x.fields,x.record_id);if(!COUNTRIES.includes(data.country))continue;
 const m=state.markets[data.country];if(kind==='SKU'){const{country,...p}=data;m.products.push(p);}else if(kind==='BATCH'){const{country,...b}=data;m.batches.push(b);}else{const{country,...s}=data;Object.assign(m,s);}
 }return state;
}
export function entities(state){const result={};for(const country of COUNTRIES){const m=state.markets[country];for(const p of m.products)result['SKU:'+country+':'+p.id]={kind:'SKU',country,id:p.id,data:{...p,country}};
 for(const b of m.batches)result['BATCH:'+country+':'+b.id]={kind:'BATCH',country,id:b.id,data:{...b,country}};
 result['SETTINGS:'+country]={kind:'SETTINGS',country,id:country,data:{country,...Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k=>[k,m[k]]))}};
 }return result;}
export function diffState(oldState,newState){const a=entities(oldState),b=entities(newState),out=[];
 for(const [key,v]of Object.entries(a))if(!b[key]&&v.kind!=='SETTINGS')out.push({kind:v.kind,country:v.country,id:v.id,action:'delete'});
 for(const [key,v]of Object.entries(b)){
 const prev=a[key];if(!prev){out.push({kind:v.kind,country:v.country,id:v.id,action:'create',changes:v.data});continue;}
 const changes={};for(const [k,val]of Object.entries(v.data))if(k!=='country'&&JSON.stringify(prev.data[k])!==JSON.stringify(val))changes[k]=val;
 if(Object.keys(changes).length)out.push({kind:v.kind,country:v.country,id:v.id,action:'update',changes});
 }
 const order={BATCH:0,SKU:1,SETTINGS:2};out.sort((x,y)=>x.action==='delete'&&y.action!=='delete'?-1:y.action==='delete'&&x.action!=='delete'?1:x.action==='delete'?(order[x.kind]-order[y.kind]):(order[y.kind]-order[x.kind]));
 return out;
}
export function applyOps(state,ops){const data=structuredClone(state);for(const op of ops){const m=data.markets[op.country];if(!m)throw Error('无效国家：'+op.country);
 const arr=op.kind==='SKU'?m.products:op.kind==='BATCH'?m.batches:null;
 if(op.kind==='SETTINGS'){
  if(op.action==='delete')throw Error('不可删除站点设置');
  Object.assign(m,op.changes);continue;
 }
 if(!arr)throw Error('无效数据表');const index=arr.findIndex(x=>x.id===op.id);
 if(op.action==='delete'){if(index<0)continue;arr.splice(index,1);}
 else if(op.action==='create'){if(index>=0)throw Error('该记录 ID 已存在');arr.push({...op.changes,id:op.id});}
 else if(op.action==='update'){if(index<0)throw Error('该记录已被删除，请刷新页面');Object.assign(arr[index],op.changes);}
 else throw Error('无效操作');
 }validateState(data);return data;}
export function validateState(state){for(const c of COUNTRIES){const m=state.markets[c];if(!m||m.products.length>500||m.batches.length>3000)throw Error('SKU 或批次数量超过限制');
 const skus=new Set(),ids=new Set(),bids=new Set();for(const p of m.products){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)||!String(p.sku||'').trim()||String(p.sku).length>200)throw Error('SKU ID 或名称不合法');const s=p.sku.trim().toLowerCase();if(skus.has(s)||ids.has(p.id))throw Error('站点 '+c+' 存在重复 SKU / ID');skus.add(s);ids.add(p.id);if(!['manual','7','30'].includes(p.basis)||!['oversize','standard','apparel','hazStd','hazOver','custom'].includes(p.category))throw Error('SKU 类型无效');
 for(const k of NUMBERS.SKU)if(p[k]!==null&&(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0||p[k]>1e12))throw Error('SKU 数值不合法: '+k);
 }for(const b of m.batches){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(b.id)||bids.has(b.id)||!ids.has(b.productId))throw Error('批次关联的 SKU 已不存在');bids.add(b.id);if(b.qty!==null&&(!Number.isInteger(b.qty)||b.qty<0))throw Error('批次数量无效');if(b.arrival&&!/^\d{4}-\d\d-\d\d$/.test(b.arrival))throw Error('批次日期格式无效');}
 if(m.base&&!/^\d{4}-\d\d-\d\d$/.test(m.base))throw Error('基准日期无效');if(!Number.isInteger(m.days)||m.days<1||m.days>730||!['end','average'].includes(m.billing)||typeof m.factor!=='number'||m.factor<0||m.factor>10)throw Error('站点参数不合法');
 }}
