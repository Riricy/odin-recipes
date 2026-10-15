/* Feishu sync client: no Feishu App Secret is ever sent to the browser. */
(()=>{
 const COUNTRIES=['UK','DE','FR'];
 const PK={SKU:['id','sku','group','l','w','h','ft3','category','low','high','stock','other','daily7','daily30','daily','basis'],BATCH:['id','productId','arrival','qty'],SETTINGS:['base','days','lead','safety','cover','transfer','factor','billing']};
 const clone=x=>JSON.parse(JSON.stringify(x));
 function entries(state){const map={};for(const c of COUNTRIES){const m=state.markets[c];
  for(const p of m.products)map['SKU:'+c+':'+p.id]={kind:'SKU',country:c,id:p.id,data:p};
  for(const b of m.batches)map['BATCH:'+c+':'+b.id]={kind:'BATCH',country:c,id:b.id,data:b};
  map['SETTINGS:'+c]={kind:'SETTINGS',country:c,id:c,data:Object.fromEntries(PK.SETTINGS.map(k=>[k,m[k]]))};
 }return map;}
 function diff(before,after){const a=entries(before),b=entries(after),ops=[];
  for(const[key,p]of Object.entries(a))if(!b[key]&&p.kind!=='SETTINGS')ops.push({kind:p.kind,country:p.country,id:p.id,action:'delete',expected:Object.fromEntries(PK[p.kind].filter(k=>k!=='id').map(k=>[k,p.data[k]]))});
  for(const[key,p]of Object.entries(b)){
   const prev=a[key];if(!prev){ops.push({kind:p.kind,country:p.country,id:p.id,action:'create',changes:p.data});continue;}
   const changes={};for(const k of PK[p.kind])if(k!=='id'&&JSON.stringify(p.data[k])!==JSON.stringify(prev.data[k]))changes[k]=p.data[k];
   if(Object.keys(changes).length)ops.push({kind:p.kind,country:p.country,id:p.id,action:'update',changes,expected:Object.fromEntries(Object.keys(changes).map(k=>[k,prev.data[k]]))});
  }
  const ord={BATCH:0,SKU:1,SETTINGS:2};ops.sort((x,y)=>x.action==='delete'&&y.action!=='delete'?-1:y.action==='delete'&&x.action!=='delete'?1:x.action==='delete'?ord[x.kind]-ord[y.kind]:ord[y.kind]-ord[x.kind]);
  return ops;
 }
 function overlay(remote,ops){const result=clone(remote);for(const op of ops){const m=result.markets[op.country];if(op.kind==='SETTINGS'){Object.assign(m,op.changes);continue;}
  const list=op.kind==='SKU'?m.products:m.batches;const pos=list.findIndex(item=>item.id===op.id);
  if(op.action==='delete'){if(pos!==-1)list.splice(pos,1);}else if(op.action==='create'){if(pos===-1)list.push(clone(op.changes));}
  else if(pos!==-1)Object.assign(list[pos],op.changes);
 }return result;}
 window.FbaCollab={create({getState,setState,getEditing,notice}){
  let password=sessionStorage.getItem('fba-team-password')||'',base=null,ready=false,busy=false,timer=null,pollTimer=null,polling=false,suspended=false,error=false,conflict=null,intervalMinutes=20;
  let deferred=null;
  const status=msg=>{notice(msg);};
  const editableFocused=()=>!!document.activeElement?.matches?.('[data-scope]');
  async function request(url,method='GET',data){
   const res=await fetch(url,{method,cache:'no-store',headers:{Authorization:'Bearer '+password,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
   let j;try{j=await res.json();}catch{throw Error('服务器响应不是 JSON，请检查部署地址');}
   if(!res.ok||!j.ok){if(res.status===401){password='';sessionStorage.removeItem('fba-team-password');showGate('访问口令不正确，请重新输入');}const e=Error(j.error||'请求失败 '+res.status);e.status=res.status;e.payload=j;throw e;}
   return j;
  }
  const refreshLabel=()=>`团队网页约8秒同步 · 飞书直改定期读取${intervalMinutes}分钟`;
  function overlaps(remote,localOps){
   const remoteItems=entries(remote),oldItems=entries(base),hits=[];
   for(const op of localOps){
    const key=op.kind==='SETTINGS'?`SETTINGS:${op.country}`:`${op.kind}:${op.country}:${op.id}`;
    const prior=oldItems[key]?.data,now=remoteItems[key]?.data;
    if(op.action==='create'){if(now)hits.push({kind:op.kind,country:op.country,id:op.id,field:'*'});continue;}
    if(!now){hits.push({kind:op.kind,country:op.country,id:op.id,field:'*'});continue;}
    const keys=op.action==='delete'?PK[op.kind].filter(k=>k!=='id'):Object.keys(op.changes);
    for(const field of keys)if(JSON.stringify(prior?.[field])!==JSON.stringify(now[field]))hits.push({kind:op.kind,country:op.country,id:op.id,field});
   }
   return hits;
  }
  function resolveConflict(useMine){
   if(!conflict)return;
   const {remote,details}=conflict,changes=diff(base,getState());
   const filtered=useMine?changes:changes.flatMap(op=>{
    const hits=details.filter(d=>d.kind===op.kind&&d.country===op.country&&d.id===op.id);
    if(!hits.length)return [op];
    if(op.action!=='update'||hits.some(h=>h.field==='*'))return [];
    const safe=Object.fromEntries(Object.entries(op.changes).filter(([k])=>!hits.some(h=>h.field===k)));
    return Object.keys(safe).length?[{...op,changes:safe}]:[];
   });
   base=clone(remote);conflict=null;
   document.querySelector('#fba-conflict')?.remove();
   suspended=true;setState({...overlay(remote,filtered),active:getState().active});suspended=false;
   status(useMine?'按你的版本继续写入，正在同步…':'已采用云端冲突字段，其他本地修改继续同步');
   if(diff(base,getState()).length)schedule();
  }
  function showConflict(remote,details){
   if(conflict)return;conflict={remote:clone(remote),details};
   clearTimeout(timer);error=false;
   const bar=document.createElement('div');bar.id='fba-conflict';
   bar.innerHTML='<strong>⚠ 同步冲突</strong><span>同事或飞书修改了同一字段。本页未替你覆盖任何一方的数据，请选择：</span><button type="button" data-side="cloud">采用云端冲突字段</button><button type="button" data-side="mine" class="primary">使用我的内容覆盖</button>';
   document.body.appendChild(bar);
   bar.querySelector('[data-side="cloud"]').addEventListener('click',()=>resolveConflict(false));
   bar.querySelector('[data-side="mine"]').addEventListener('click',()=>resolveConflict(true));
   status('检测到同时修改同一字段，请先处理页面底部的冲突提示');
  }
  function applyIncoming(remote){
   if(!base){base=clone(remote);suspended=true;setState({...clone(remote),active:getState().active});suspended=false;return;}
   if(editableFocused())return;
   const localChanges=diff(base,getState());const hits=overlaps(remote,localChanges);if(hits.length){showConflict(remote,hits);return;}const merged=overlay(remote,localChanges);
   base=clone(remote);
   // 只有实际内容变更才重绘；不会覆盖正在输入的文本。
   const current=clone(getState());current.active='UK';const target=clone(merged);target.active='UK';
   if(JSON.stringify(current)!==JSON.stringify(target)){
    suspended=true;setState({...merged,active:getState().active});suspended=false;
   }
  }
  function hasPending(){return ready&&(!base||diff(base,getState()).length>0||busy||!!deferred||!!conflict);}
  function finalizeDeferred(){
   if(!deferred||getEditing())return;
   const {remote,sentLocal,remaining}=deferred;deferred=null;
   const recent=diff(sentLocal,getState());base=clone(remote);
   const merged=overlay(remote,[...remaining,...recent]);
   suspended=true;setState({...merged,active:getState().active});suspended=false;
  }
  async function pull(force=false){if(!ready||polling||busy||deferred||conflict||editableFocused()||getEditing()||(!force&&document.hidden))return;
   polling=true;
   try{const j=await request('/api/state');intervalMinutes=Math.round(j.refreshMs/60000)||20;error=false;applyIncoming(j.state);if(hasPending())schedule();else status('网页数据已更新 · '+refreshLabel());}
   catch(e){error=true;status('同步中断：'+e.message+'；本页修改尚未全部保存');}
   finally{polling=false;}
  }
  async function flush(){if(!ready||busy||polling||conflict||!base)return;clearTimeout(timer);
   if(deferred&&getEditing()){schedule();return;}
   finalizeDeferred();
   // 若用户尚在输入但未按 Enter/离焦，避免发送未完成的数字或 SKU。
   if(getEditing()){schedule();return;}
   const ops=diff(base,getState());if(!ops.length){if(!error)status('已同步 · '+refreshLabel());return;}
   const sentLocal=clone(getState());busy=true;
   try{
    // 增量提交，并对返回的远端快照进行三方合并，而不是再回传旧字段。
    const j=await request('/api/mutate','POST',{ops:ops.slice(0,50)});
    error=false;
    const remaining=ops.slice(50);
    if(getEditing()){
     // 不抢走同事正在输入的焦点，等输入框离焦后再合并最新云端状态。
     deferred={remote:j.state,sentLocal,remaining};
     status('飞书已收到修改，当前输入完成后更新显示');
    }else{
     deferred={remote:j.state,sentLocal,remaining};finalizeDeferred();
     if(diff(base,getState()).length){status('部分变更已写入飞书，继续同步中…');}
     else status('所有修改已写入飞书');
    }
   }catch(e){if(e.status===409&&e.payload?.state){showConflict(e.payload.state,e.payload.conflicts||[]);}else{error=true;status('保存失败：'+e.message+'；请勿关闭页面，修改尚未全部保存');}}
   finally{busy=false;if(ready&&!deferred&&diff(base,getState()).length&&!error)schedule();}
  }
  function schedule(){if(!ready||suspended||conflict)return;clearTimeout(timer);timer=setTimeout(flush,1600);if(hasPending())status('正在同步到飞书…');}
  function onSave(){if(!ready||suspended)return;schedule();}
  async function refreshFromFeishu(){
   if(!ready||busy||polling){status('请先连接或等待当前同步完成');return;}
   if(getEditing()){status('请先按 Enter 或离开输入框，保存当前修改');return;}
   if(conflict){status('请先处理同步冲突');return;}
   if(hasPending()){await flush();if(hasPending()){status('本地数据尚未保存，不能刷新；请检查同步提示');return;}}
   polling=true;
   try{
    const j=await request('/api/refresh','POST');intervalMinutes=Math.round(j.refreshMs/60000)||20;
    applyIncoming(j.state);
    if(j.refreshSkipped){status(`已检查服务器最新数据；距离下次飞书 API 读取还需约${Math.max(1,Math.ceil(j.refreshWaitMs/60000))}分钟（节约免费额度）`);}
    else status('已从飞书多维表格读取最新数据');
   }catch(e){status('刷新失败：'+e.message);}finally{polling=false;}
  }
  function showGate(message='请输入团队访问口令'){document.querySelector('#fba-access-gate')?.remove();
   const gate=document.createElement('div');gate.id='fba-access-gate';gate.innerHTML=`<div class="fba-gate-card"><h2>FBA 推演 · 飞书协作</h2><p id="fba-gate-msg"></p><label for="fba-gate-key">团队访问口令</label><input id="fba-gate-key" type="password" autocomplete="off" placeholder="管理员提供的访问口令"><button id="fba-gate-login" class="primary" type="button">连接飞书</button><p style="font-size:12px;color:#607587">通过后端安全访问飞书，App Secret 不会出现在网页中。</p></div>`;
   document.body.appendChild(gate);gate.querySelector('#fba-gate-msg').textContent=message;
   const doLogin=async()=>{const key=gate.querySelector('#fba-gate-key').value.trim();if(!key){gate.querySelector('#fba-gate-msg').textContent='请填写团队访问口令';return;}password=key;await initialize();};
   gate.querySelector('button').addEventListener('click',doLogin);gate.querySelector('input').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});gate.querySelector('input').focus();
  }
  async function initialize(){status('正在连接飞书…');
   try{const j=await request('/api/state');sessionStorage.setItem('fba-team-password',password);
    base=clone(j.state);ready=true;error=false;suspended=true;setState({...clone(j.state),active:getState().active});suspended=false;
    document.querySelector('#fba-access-gate')?.remove();intervalMinutes=Math.round(j.refreshMs/60000)||20;status('飞书连接成功 · '+refreshLabel());
    if(!pollTimer)pollTimer=setInterval(()=>pull(),8000);
   }catch(e){ready=false;status('无法连接飞书：'+e.message);const msg=document.querySelector('#fba-gate-msg');if(msg)msg.textContent=e.message;else showGate(e.message);}
  }
  function start(){
   const style=document.createElement('style');style.textContent='#fba-conflict{position:fixed;bottom:10px;left:10px;right:10px;z-index:1100;background:#fff7e7;border:2px solid #b47a20;padding:13px;box-shadow:0 6px 30px #123e5933;display:flex;align-items:center;flex-wrap:wrap;gap:12px;border-radius:9px} #fba-conflict strong{color:#8c4b00} #fba-access-gate{position:fixed;z-index:1000;inset:0;background:rgba(18,47,69,.83);display:flex;align-items:center;justify-content:center;padding:24px} .fba-gate-card{width:min(430px,100%);background:white;border-radius:14px;padding:28px;box-shadow:0 12px 45px #08172455;display:flex;flex-direction:column;gap:12px} .fba-gate-card h2{margin:0;font-size:22px}.fba-gate-card button{margin-top:8px}.fba-gate-card input{width:100%}';document.head.appendChild(style);
   if(password)initialize();else showGate();
   window.addEventListener('focus',()=>pull(true));
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)pull(true);});
   window.addEventListener('online',()=>{pull(true);schedule();});
   document.addEventListener('focusout',e=>{if(e.target.matches?.('[data-scope]')){setTimeout(()=>{if(!getEditing()){finalizeDeferred();schedule();pull();}},50);}});
   window.addEventListener('beforeunload',e=>{if(hasPending()){e.preventDefault();e.returnValue='';}});
  }
  return{start,onSave,hasPending,refreshFromFeishu};
 }};
})();
