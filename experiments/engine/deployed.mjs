import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const url=process.argv[2];
if(!url?.startsWith('https://'))throw Error('Supply deployed HTTPS origin');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
try {
 await page.goto(url);
 if(await page.getByRole('textbox',{name:'Password'}).count()){
  await page.getByRole('textbox',{name:'Password'}).fill(process.env.DEPLOY_PASSWORD??'My-Drop-Site');
  await page.getByRole('button',{name:'Submit'}).click();
 }
 await page.waitForFunction(()=>window.lab?.ready,{timeout:60000});
 const result=await page.evaluate(async()=>{
  const headers={};
  for(const path of ['/','/engine/duckdb-eh.wasm','/engine/duckdb-browser-eh.worker.js','/extensions/v1.5.4/wasm_eh/json.duckdb_extension.wasm','/data/small-v1/order_items.parquet']){
   const response=await fetch(path,{headers:{Range:'bytes=0-31'}});
   const buffer=await response.arrayBuffer();
   headers[path]={status:response.status,headers:Object.fromEntries(response.headers),receivedBytes:buffer.byteLength};
  }
  const documentResponse=await fetch('/');
  const fullDocumentHeaders=Object.fromEntries(documentResponse.headers);
  const securityHeadersPresent=['content-security-policy','x-content-type-options','referrer-policy'].every(k=>k in fullDocumentHeaders);
  await lab.engine.db.registerFileURL('items.parquet',location.origin+'/data/small-v1/order_items.parquet',lab.duckdb.DuckDBDataProtocol.HTTP,true);
  return {environment:lab.evidence,headers,fullDocumentHeaders,securityHeadersPresent,query:await lab.query("SELECT count(*) AS n FROM read_parquet('items.parquet')"),parser:await lab.query("SELECT json_serialize_sql('SELECT 1') AS ast")};
 });
 await page.screenshot({path:'../../readiness/evidence/deployed.png'});
 await writeFile('../../readiness/evidence/deployed.json',JSON.stringify({url,date:new Date().toISOString(),result,errors},null,2)+'\n');
 console.log(JSON.stringify({url,fullDocumentHeaders:result.fullDocumentHeaders,securityHeadersPresent:result.securityHeadersPresent,query:result.query,errors},null,2));
} finally {await browser.close();}
