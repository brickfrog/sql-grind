import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errors=[],workers=[],responses=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
page.on('worker',worker=>workers.push(worker.url()));
page.on('response',response=>responses.push({url:response.url(),status:response.status()}));
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4173/')?route.continue():route.abort());
let result;
try{
 const response=await page.goto('http://127.0.0.1:4173');
 const documentHeaders=await response.allHeaders();
 try{
  await page.waitForFunction(()=>window.lab?.ready,{timeout:45000});
  result=await page.evaluate(async()=>{
   const timezone=await lab.query("SELECT current_setting('TimeZone') AS timezone");
   const parser=await lab.query("SELECT json_serialize_sql('SELECT 1') AS ast");
   await lab.engine.db.registerFileURL('items.parquet',location.origin+'/data/small-v1/order_items.parquet',lab.duckdb.DuckDBDataProtocol.HTTP,true);
   const data=await lab.query("SELECT count(*) AS n FROM read_parquet('items.parquet')");
   await lab.query("SET autoinstall_known_extensions=false;SET autoload_known_extensions=false;SET enable_external_access=false;SET lock_configuration=true");
   const profile=await lab.query('EXPLAIN (ANALYZE, FORMAT JSON) SELECT sum(i) FROM range(1000) t(i)');
   return {environment:lab.evidence,timezone,parser,data,profile,pass:timezone.rows[0].timezone==='UTC'&&data.rows[0].n==='8500'};
  });
 }catch(error){result={pass:false,error:String(error),state:await page.evaluate(()=>({stage:window.lab?.stage,ready:window.lab?.ready}))};}
 const report={date:new Date().toISOString(),scope:'Built output on localhost with exact public/_headers policy; not a deployed HTTPS header pass',documentHeaders,workers,responses,errors,result};
 await writeFile('../../readiness/evidence/csp.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({documentHeaders,workers,errors,result},null,2));
 if(!result.pass)process.exitCode=1;
}finally{await browser.close();}
