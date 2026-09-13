import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const files=Object.fromEntries(await Promise.all(['schema.sql','generator.sql','reference-07.sql'].map(async n=>[n,await readFile('../../readiness/'+n,'utf8')])));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();
const scale=process.argv[2]??'small';const limit=process.argv[3]??'512MB';
try{await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.lab?.ready,{timeout:120000});
const result=await page.evaluate(async({files,scale,limit})=>{
 const out={scale,limit,environment:lab.evidence,artifacts:[]};const q=lab.query;
 try{
 await q(`SET memory_limit='${limit}'; SET preserve_insertion_order=false; SET VARIABLE dataset_scale='${scale}'`);await q(files['schema.sql']);
 const start=performance.now();await q(files['generator.sql']);out.generationMs=performance.now()-start;
 out.counts=await q("SELECT 'orders' AS name,count(*) AS n FROM orders UNION ALL SELECT 'order_items',count(*) FROM order_items");
 out.validation=await q('SELECT count(*) AS invalid FROM (SELECT r.order_item_id FROM returns r JOIN order_items i USING(order_item_id) GROUP BY r.order_item_id, i.qty,i.unit_price HAVING sum(r.qty)>i.qty OR sum(r.refund_amount)>i.qty*i.unit_price)');
 const tables=['categories','customers','warehouses','products','orders','order_items','payments','returns'];
 for(const name of tables){const start=performance.now();await q(`COPY (SELECT * FROM ${name} ORDER BY 1) TO '${name}.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)`);const buffer=await lab.engine.db.copyFileToBuffer(name+'.parquet');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');out.artifacts.push({name,bytes:buffer.byteLength,sha256:digest,copyMs:performance.now()-start});await lab.engine.db.registerFileBuffer(name+'.parquet',buffer);}
 out.queries={};for(const mode of ['internal','parquet']){const sql=mode==='internal'?files['reference-07.sql']:files['reference-07.sql'].replace(/\b(orders|order_items|products|categories) AS/g,"read_parquet('$1.parquet') AS");const times=[];await q(sql);for(let i=0;i<7;i++)times.push((await q(sql)).ms);out.queries[mode]={times,profile:await q('EXPLAIN (ANALYZE, FORMAT JSON) '+sql)};}
 out.memory=await q('SELECT * FROM duckdb_memory()');
 // Measure reload on fresh workers with bytes already fetched. Fetch timing is separate.
 out.reload={};for(const mode of ['views','materialized']){const engine=await lab.create();const start=performance.now();for(const name of tables){await engine.db.registerFileBuffer(name+'.parquet',await lab.engine.db.copyFileToBuffer(name+'.parquet'));await lab.query(`CREATE ${mode==='views'?'VIEW':'TABLE'} ${name} AS SELECT * FROM read_parquet('${name}.parquet')`,engine);}out.reload[mode]={loadMs:performance.now()-start,first:await lab.query(files['reference-07.sql'],engine),memory:await lab.query('SELECT * FROM duckdb_memory()',engine)};engine.worker.terminate();}
 }catch(e){out.error=String(e)}return out;
},{files,scale,limit});
await mkdir('../../readiness/evidence',{recursive:true});await writeFile(`../../readiness/evidence/dataset-${scale}-${limit}.json`,JSON.stringify(result,null,2)+'\n');
// Retain reproducible small assets. Large assets regenerate from the pinned generator.
if(!result.error&&scale==='small'){await mkdir('public/data/small-v1',{recursive:true});for(const a of result.artifacts){const bytes=await page.evaluate(async name=>Array.from(await lab.engine.db.copyFileToBuffer(name+'.parquet')),a.name);await writeFile('public/data/small-v1/'+a.name+'.parquet',Uint8Array.from(bytes));}}
console.log(JSON.stringify({scale,limit,generationMs:result.generationMs,artifacts:result.artifacts,error:result.error,queries:result.queries&&Object.fromEntries(Object.entries(result.queries).map(([k,v])=>[k,v.times]))},null,2));
}finally{await browser.close();}
