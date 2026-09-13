import {mkdir,writeFile} from 'node:fs/promises';
const path='public/extensions/v1.5.4/wasm_eh';await mkdir(path,{recursive:true});
for(const name of ['icu','json','parquet']){const url=`https://extensions.duckdb.org/v1.5.4/wasm_eh/${name}.duckdb_extension.wasm`;const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);await writeFile(`${path}/${name}.duckdb_extension.wasm`,Buffer.from(await response.arrayBuffer()));}
