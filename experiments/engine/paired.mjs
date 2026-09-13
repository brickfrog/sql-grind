import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const scale=process.argv[2]??'small';
if(!['small','illustrated'].includes(scale))throw Error('Use small or illustrated');
const files=Object.fromEntries(await Promise.all(['schema.sql','generator.sql','reference-07.sql'].map(async name=>[name,await readFile('../../readiness/'+name,'utf8')])));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(()=>window.lab?.ready,{timeout:120000});
 const result=await page.evaluate(async({files,scale})=>{
  const {encode,compare}=await import('/compare.js');
  const limit=scale==='illustrated'?'1536MB':'512MB';
  await lab.query(`SET memory_limit='${limit}';SET preserve_insertion_order=false;SET VARIABLE dataset_scale='${scale}'`);
  await lab.query(files['schema.sql']);await lab.query(files['generator.sql']);
  const reference=files['reference-07.sql'];
  const candidate=reference.replace('ORDER BY mon ASC, rnk ASC, category_id ASC','ORDER BY mon ASC, rnk ASC');
  const completeReference=encode(await lab.engine.conn.query(reference));
  const completeCandidate=encode(await lab.engine.conn.query(candidate));
  const equivalence=compare(completeReference,completeCandidate,[0,4]);
  if(!equivalence.pass)throw Error('Candidate does not preserve complete reference result');
  const pairs=[];
  for(let i=0;i<9;i++){
   let r,c;
   if(i%2){c=await lab.query(candidate);r=await lab.query(reference)}
   else{r=await lab.query(reference);c=await lab.query(candidate)}
   pairs.push({first:i%2?'candidate':'reference',referenceMs:r.ms,candidateMs:c.ms,ratio:c.ms/r.ms});
  }
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]};
  const stats=values=>({median:median(values),mad:median(values.map(x=>Math.abs(x-median(values)))),min:Math.min(...values),max:Math.max(...values)});
  return {scale,limit,environment:lab.evidence,equivalence,completeRows:completeReference.rows.length,counts:await lab.query('SELECT (SELECT count(*) FROM orders) AS orders,(SELECT count(*) FROM order_items) AS items'),method:'One warmup per query, then nine alternating pairs. Wall time includes worker round trip and result transfer. Trusted authored queries share one worker.',pairs,summary:{referenceMs:stats(pairs.map(x=>x.referenceMs)),candidateMs:stats(pairs.map(x=>x.candidateMs)),ratio:stats(pairs.map(x=>x.ratio))},profile:await lab.query('EXPLAIN (ANALYZE, FORMAT JSON) '+reference)};
 },{files,scale});
 await writeFile(`../../readiness/evidence/paired-${scale}.json`,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({scale,equivalence:result.equivalence,counts:result.counts,summary:result.summary},null,2));
}finally{await browser.close();}
