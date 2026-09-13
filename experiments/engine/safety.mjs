import {chromium} from 'playwright';import {readFile,writeFile} from 'node:fs/promises';
const files=Object.fromEntries(await Promise.all(['schema.sql','fixtures.sql'].map(async n=>[n,await readFile('../../readiness/'+n,'utf8')])));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();const logs=[];page.on('console',m=>logs.push(m.text()));
try{await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.lab?.ready,{timeout:120000});const result=await page.evaluate(async files=>{
 const out={};let stage='openWritable';let ro;
 try{
 const e=lab.engine;await lab.query("ATTACH 'protected.db' AS source (READ_WRITE); USE source");stage='schema';await lab.query(files['schema.sql']);stage='fixtures';await lab.query(files['fixtures.sql']);stage='checkpoint';await lab.query('CHECKPOINT source; USE memory; DETACH source');
 stage='attachReadOnly';ro=e;await e.conn.close();await e.db.open({path:'protected.db',accessMode:lab.duckdb.DuckDBAccessMode.READ_ONLY});e.conn=await e.db.connect();
 const attempt=async sql=>{try{return await lab.query(sql,ro)}catch(e){return {error:String(e)}}};out.restrictions=await attempt("SET autoinstall_known_extensions=false;SET autoload_known_extensions=false;SET enable_external_access=false;SET lock_configuration=true");
 for(const [name,sql] of Object.entries({read:'SELECT count(*) AS n FROM orders',delete:'DELETE FROM orders',create:'CREATE TABLE hacked(i INTEGER)',temporary:'CREATE TEMP TABLE local_temp(i INTEGER)',reset:'RESET enable_external_access',install:'INSTALL spatial',profile:"PRAGMA enable_profiling='json'"}))out[name]=await attempt(sql);
 }catch(e){out.failure={stage,error:String(e)}}
 const saved={sql:'SELECT 123',progress:{challenge:'07',complete:true},revision:7};const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('readiness',1);r.onupgradeneeded=()=>r.result.createObjectStore('saved');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('saved','readwrite');tx.objectStore('saved').put(saved,'session');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
 ro?.worker.terminate();lab.engine.worker.terminate();lab.engine=await lab.create();const recovered=await new Promise((resolve,reject)=>{const r=db.transaction('saved').objectStore('saved').get('session');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});out.savedRecovery={same:JSON.stringify(recovered)===JSON.stringify(saved),value:recovered,query:await lab.query('SELECT 123 AS n')};db.close();indexedDB.deleteDatabase('readiness');
 // Deliberately bypass statement admission. A poisoned worker must not affect the next run.
 await lab.query(files['schema.sql']);await lab.query(files['fixtures.sql']);
 const original=await lab.query('SELECT count(*) AS n FROM returns');
 await lab.query('DELETE FROM returns');const poisoned=await lab.query('SELECT count(*) AS n FROM returns');
 lab.engine.worker.terminate();const restoreStart=performance.now();lab.engine=await lab.create();
 await lab.query(files['schema.sql']);await lab.query(files['fixtures.sql']);
 await lab.query("SET autoinstall_known_extensions=false;SET autoload_known_extensions=false;SET enable_external_access=false;SET lock_configuration=true");
 const restored=await lab.query('SELECT count(*) AS n FROM returns');
 out.snapshotRestore={original,poisoned,restored,restoreMs:performance.now()-restoreStart,pass:original.rows[0].n===restored.rows[0].n&&poisoned.rows[0].n==='0'};
 return out;
},files);await writeFile('../../readiness/evidence/safety.json',JSON.stringify({result,logs},null,2)+'\n');console.log(JSON.stringify(result,null,2));}finally{await browser.close();}
