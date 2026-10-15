import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function loadEnv(){
 const p=path.join(ROOT,'.env');
 if(!fs.existsSync(p))return;
 for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
 }
}
loadEnv();
export const env=k=>process.env[k]?.trim()||'';
export function requireKeys(keys){for(const k of keys){if(!env(k)||/替换|请替换/.test(env(k)))throw Error('缺少有效的 '+k+'，请检查 .env');}}
