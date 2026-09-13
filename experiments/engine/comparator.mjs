import {chromium} from 'playwright';import {readFile,writeFile} from 'node:fs/promises';
const files=Object.fromEntries(await Promise.all(['schema.sql','fixtures.sql','reference-07.sql','expected-07.json'].map(async n=>[n,await readFile('../../readiness/'+n,'utf8')])));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();
try{await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.lab?.ready,{timeout:120000});
const result=await page.evaluate(async files=>{
 const {encode,compare}=await import('/compare.js');const q=async s=>encode(await lab.engine.conn.query(s));await q(files['schema.sql']);await q(files['fixtures.sql']);const reference=await q(files['reference-07.sql']);const expected=JSON.parse(files['expected-07.json']);
 const evidence={reference,handAnswerMatches:JSON.stringify(reference.rows)===JSON.stringify(expected.rows),cases:{}};
 const arrowTypes={DATE:'Date32<DAY>',BIGINT:'Int64',VARCHAR:'Utf8'};
 const authoredExpected={fields:expected.columns.map(c=>{
  if(c.type==='DECIMAL')return {name:c.name,type:`Decimal[${c.precision}e+${c.scale}]`,precision:c.precision,scale:c.scale};
  if(!arrowTypes[c.type])throw Error(`Unsupported authored type ${c.type}`);
  return {name:c.name,type:arrowTypes[c.type]};
 }),rows:expected.rows,complete:expected.complete};
 evidence.authoredContract=compare(authoredExpected,reference,[0,4]);
 const referenceBody=files['reference-07.sql'].trim().replace(/;$/,'');
 evidence.authoredWrongRankType=compare(authoredExpected,await q(`SELECT mon,category_id,c_name,revenue,rnk::INTEGER AS rnk FROM (${referenceBody}) AS answer`),[0,4]);
 evidence.authoredEquivalentDecimalWidth=compare(authoredExpected,await q(`SELECT mon,category_id,c_name,revenue::DECIMAL(18,2) AS revenue,rnk FROM (${referenceBody}) AS answer`),[0,4]);
 const base=await q("SELECT * FROM (VALUES (9007199254740993::BIGINT, -12345678901234567890.12::DECIMAL(38,2),NULL::VARCHAR, DATE '2024-02-29'),(9007199254740993::BIGINT,-12345678901234567890.12::DECIMAL(38,2),NULL::VARCHAR,DATE '2024-02-29')) t(id,money,label,day)");evidence.exact=base;
 const variants={equal:structuredClone(base),missingDuplicate:structuredClone(base),nullAsString:structuredClone(base),wrongIntegerType:structuredClone(base),roundedDecimal:structuredClone(base),incomplete:structuredClone(base),decimalWidth:structuredClone(base)};
 variants.missingDuplicate.rows.pop();variants.nullAsString.rows[0][2]='NULL';variants.wrongIntegerType.fields[0].type='Float64';variants.roundedDecimal.rows[0][1]='-12345678901234567000.00';variants.incomplete.complete=false;variants.decimalWidth.fields[1].type='Decimal[30e+2]';variants.decimalWidth.fields[1].precision=30;
 for(const [name,v] of Object.entries(variants))evidence.cases[name]=compare(base,v);
 const peers=structuredClone(reference);[peers.rows[0],peers.rows[1]]=[peers.rows[1],peers.rows[0]];evidence.cases.peerOrder=compare(reference,peers,[0,4]);const reversed=structuredClone(reference);reversed.rows.reverse();evidence.cases.wrongOrder=compare(reference,reversed,[0,4]);
 evidence.mutations={};for(const [name,sql] of Object.entries({denseRank:files['reference-07.sql'].replace('rank()','dense_rank()'),catalogPrice:files['reference-07.sql'].replace('oi.unit_price','p.unit_price'),missingYear:files['reference-07.sql'].replace(/AND o.ordered_at >=[^\n]+\n/,'').replace(/AND o.ordered_at <[^\n]+\n/,''),distinctItems:files['reference-07.sql'].replace('JOIN order_items AS oi','JOIN (SELECT DISTINCT order_id,product_id,qty,unit_price FROM order_items) AS oi')}))evidence.mutations[name]=compare(reference,await q(sql),[0,4]);
 evidence.pass=evidence.handAnswerMatches&&evidence.authoredContract.pass&&!evidence.authoredWrongRankType.pass&&evidence.authoredWrongRankType.reason==='types'&&evidence.authoredEquivalentDecimalWidth.pass&&['equal','decimalWidth','peerOrder'].every(n=>evidence.cases[n].pass)&&['missingDuplicate','nullAsString','wrongIntegerType','roundedDecimal','incomplete','wrongOrder'].every(n=>!evidence.cases[n].pass)&&Object.values(evidence.mutations).every(x=>!x.pass);return evidence;
},files);await writeFile('../../readiness/evidence/comparator.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
}finally{await browser.close();}
