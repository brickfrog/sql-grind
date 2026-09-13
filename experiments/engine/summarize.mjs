import {readFile,writeFile} from 'node:fs/promises';
const load=async n=>JSON.parse(await readFile('../../readiness/evidence/'+n,'utf8'));
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
const stats=a=>({n:a.length,median:median(a),mad:median(a.map(x=>Math.abs(x-median(a)))),min:Math.min(...a),max:Math.max(...a)});
const summary={datasets:{}};
for(const name of ['small-512MB','illustrated-1536MB']){const d=await load('dataset-'+name+'.json');summary.datasets[name]={generationMs:d.generationMs,parquetBytes:d.artifacts.reduce((n,a)=>n+a.bytes,0),queryMs:Object.fromEntries(Object.entries(d.queries).map(([mode,x])=>[mode,stats(x.times)])),enginePeakBufferBytes:Object.fromEntries(Object.entries(d.queries).map(([mode,x])=>[mode,JSON.parse(x.profile.rows[0].explain_value).system_peak_buffer_memory])),reload:Object.fromEntries(Object.entries(d.reload??{}).map(([mode,x])=>[mode,{loadMs:x.loadMs,firstQueryMs:x.first.ms}])),laterError:d.error??null};}
const p=await load('profile.json');summary.pairs={referenceMs:stats(p.pairs.map(x=>x.referenceMs)),candidateMs:stats(p.pairs.map(x=>x.candidateMs)),ratio:stats(p.pairs.map(x=>x.ratio))};
summary.parserRssDeltaKiB=p.processMemory.samples[2].rssKiB-p.processMemory.samples[1].rssKiB;
await writeFile('../../readiness/evidence/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
