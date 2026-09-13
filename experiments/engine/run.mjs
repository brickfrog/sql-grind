import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
try {
await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.lab?.ready,{timeout:120000});
const result=await page.evaluate(async()=>{
 const out={environment:lab.evidence};
 for(const [k,s] of Object.entries({parser:"SELECT json_serialize_sql('SELECT 1') AS ast",timezone:"SELECT current_setting('TimeZone') AS tz",profile:"EXPLAIN (ANALYZE, FORMAT JSON) SELECT sum(i) FROM range(10000) t(i)"})){
 try{out[k]=await lab.query(s)}catch(e){out[k]={error:String(e)}}}
 return out;
});
await mkdir('../../readiness/evidence',{recursive:true});
await writeFile('../../readiness/evidence/probe.json',JSON.stringify({result,errors},null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
