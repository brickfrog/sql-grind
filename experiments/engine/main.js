import * as duckdb from '@duckdb/duckdb-wasm';
import {EditorState} from '@codemirror/state';
import {sql, PostgreSQL} from '@codemirror/lang-sql';
const bundles={mvp:{mainModule:'/engine/duckdb-mvp.wasm',mainWorker:'/engine/duckdb-browser-mvp.worker.js'},eh:{mainModule:'/engine/duckdb-eh.wasm',mainWorker:'/engine/duckdb-browser-eh.worker.js'}};
const plain = value => JSON.parse(JSON.stringify(value, (_,v)=>typeof v==='bigint'?v.toString():v));
window.lab={duckdb, EditorState, sql, PostgreSQL, plain, engines:[], evidence:[]};
lab.create=async()=>{
 const start=performance.now(); const bundle=await duckdb.selectBundle(bundles);
 const worker=new Worker(bundle.mainWorker); const db=new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),worker);
 lab.stage='instantiate'; await db.instantiate(bundle.mainModule); lab.stage='open'; await db.open({query:{castBigIntToDouble:false,castDecimalToDouble:false,castTimestampToDate:false},maximumThreads:1});
 lab.stage='connect'; const conn=await db.connect(); lab.stage='configure'; await conn.query("SET memory_limit='512MB'; SET threads=1; SET custom_extension_repository='"+location.origin+"/extensions'; SET TimeZone='UTC'; LOAD json"); lab.stage='ready';
 const engine={db,conn,worker,startupMs:performance.now()-start,bundle};lab.engines.push(engine);return engine;
};
lab.query=async(sql,engine=lab.engine)=>{const start=performance.now(); const t=await engine.conn.query(sql);return {ms:performance.now()-start,fields:t.schema.fields.map(f=>({name:f.name,type:String(f.type)})),rows:plain(t.toArray().map(r=>r.toJSON()))};};
lab.record=(name,value)=>{lab.evidence.push({name,value});return value;};
lab.engine=await lab.create();
lab.record('environment',{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,crossOriginIsolated,engine:await lab.query('SELECT version() AS version'),startupMs:lab.engine.startupMs,bundle:lab.engine.bundle});
document.querySelector('#status').textContent=JSON.stringify(lab.evidence,null,2);lab.ready=true;
