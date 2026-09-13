import { mkdir, copyFile } from 'node:fs/promises';
const root = 'node_modules/@duckdb/duckdb-wasm/dist/';
await mkdir('public/engine', {recursive:true});
for (const name of ['duckdb-mvp.wasm','duckdb-eh.wasm','duckdb-browser-mvp.worker.js','duckdb-browser-eh.worker.js']) await copyFile(root+name, 'public/engine/'+name);
