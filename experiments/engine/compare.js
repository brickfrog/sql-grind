// Feasibility code, not an application API. Never pass decimal values through Number.
export function encode(table) {
 const fields=table.schema.fields.map(f=>({name:f.name,type:String(f.type),scale:f.type.scale,precision:f.type.precision}));
 const rows=[];
 for(let i=0;i<table.numRows;i++) rows.push(fields.map((f,j)=>{
  const value=table.getChildAt(j).get(i);if(value===null)return null;
  if(f.type.startsWith('Decimal')) {
   let n=0n;for(let k=value.length-1;k>=0;k--)n=(n<<32n)+BigInt(value[k]>>>0);
   if(value[value.length-1]>>>31)n-=1n<<BigInt(value.length*32);
   const sign=n<0n?'-':'';let digits=(n<0n?-n:n).toString().padStart(f.scale+1,'0');
   return sign+(f.scale?digits.slice(0,-f.scale)+'.'+digits.slice(-f.scale):digits);
  }
  if(f.type==='Date32<DAY>')return new Date(value).toISOString().slice(0,10);
  return String(value);
 }));
 return {fields,rows,complete:true};
}
export function compare(expected,actual,order=[]) {
 if(!actual.complete)return {pass:false,reason:'incomplete'};
 if(expected.fields.length!==actual.fields.length||expected.fields.some((f,i)=>{const a=actual.fields[i];return f.name!==a.name||(f.type.startsWith('Decimal')&&a.type.startsWith('Decimal')?f.scale!==a.scale:f.type!==a.type)}))return {pass:false,reason:'types'};
 const bag=new Map();for(const row of expected.rows){const key=JSON.stringify(row);bag.set(key,(bag.get(key)??0)+1);}
 for(const row of actual.rows){const key=JSON.stringify(row),n=bag.get(key)??0;if(!n)return {pass:false,reason:'values'};n===1?bag.delete(key):bag.set(key,n-1);}
 if(bag.size)return {pass:false,reason:'values'};
 for(let i=1;i<actual.rows.length;i++)for(const col of order){const a=actual.rows[i-1][col],b=actual.rows[i][col];const cmp=expected.fields[col].type==='Int64'?(BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0):(a<b?-1:a>b?1:0);if(cmp>0)return {pass:false,reason:'ordering'};if(cmp<0)break;}
 return {pass:true};
}
