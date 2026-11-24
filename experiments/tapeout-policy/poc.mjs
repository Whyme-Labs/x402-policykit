// Experimental local NAND-only compiler for TAP-02 draft format.
// Run: node experiments/tapeout-policy/poc.mjs
// Inputs: unsigned price, daily spent, weekly spent (LSB first), then
// enabled, identity verified, endpoint allowed, user confirmed flags.
// Amounts must share one integer unit, e.g. micro-USD. No rounding here.
// Flags and spend counters are EXTERNAL ASSERTIONS, not authenticated by this circuit.
// This is not an authorization service, transaction signer, or production policy engine.
// Format: https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md

function compilePolicy(width, caps) {
  if (!Number.isInteger(width) || width < 2 || width > 32) throw new RangeError("width");
  const limit = (1n << BigInt(width)) - 1n;
  for (const k of ["perCall","daily","weekly"]) if (typeof caps[k] !== "bigint" || caps[k] < 0n || caps[k] > limit) throw new RangeError(k);
  const nIn = 3 * width + 4, gates = [];
  const nand = (a,b) => { gates.push([a,b]); return nIn+1+gates.length; };
  const not = a => nand(a,a);
  const and = (a,b) => not(nand(a,b));
  const or = (a,b) => nand(not(a),not(b));
  const xor = (a,b) => {const t=nand(a,b);return nand(nand(a,t),nand(b,t));};
  const bits = start => Array.from({length:width},(_,i)=>2+start+i);
  const price=bits(0), daily=bits(width), weekly=bits(2*width);
  const add = (a,b) => {
    let carry=0; const out=[];
    for(let i=0;i<width;i++){const x=xor(a[i],b[i]);out.push(xor(x,carry));carry=or(and(a[i],b[i]),and(x,carry));}
    return [...out,carry];
  };
  // LSB-to-MSB recurrence: when the current constant bit is 0,
  // x must be 0 and the lower suffix must pass; if it is 1, x=0
  // wins immediately and x=1 inherits the lower suffix result.
  const le = (x,cap) => {
    let ok=1;
    for(let i=0;i<x.length;i++) ok=((cap>>BigInt(i))&1n)?or(not(x[i]),ok):and(not(x[i]),ok);
    return ok;
  };
  const flags=Array.from({length:4},(_,i)=>2+3*width+i);
  const positive=price.reduce(or,0);
  const allow=[...flags,positive,le(price,caps.perCall),le(add(price,daily),caps.daily),le(add(price,weekly),caps.weekly)].reduce(and,1);
  // The sole output must be the last signal, already true for this reduction.
  if(allow!==nIn+1+gates.length)throw Error("output not final");
  const bytes=new Uint8Array(gates.length*7);
  gates.forEach(([a,b],i)=>{const j=7*i;bytes.set([0,a>>>16,(a>>>8)&255,a&255,b>>>16,(b>>>8)&255,b&255],j);});
  return {nIn,nOut:1,width,gateCount:gates.length,netlist:bytes};
}

function packInputs(width,price,daily,weekly,flags){
  const max=(1n<<BigInt(width))-1n;
  for(const v of [price,daily,weekly])if(typeof v!=="bigint"||v<0n||v>max)throw RangeError("amount");
  if(!Number.isInteger(flags)||flags<0||flags>15)throw RangeError("flags");
  const x=price|(daily<<BigInt(width))|(weekly<<BigInt(width*2))|(BigInt(flags)<<BigInt(width*3));
  return Uint8Array.from({length:Math.ceil((width*3+4)/8)},(_,i)=>Number((x>>BigInt(8*i))&255n));
}

function evaluateNetlist(circuit,input){
  const {nIn,nOut,netlist}=circuit;
  if(netlist.length%7!==0||nOut!==1||netlist.length<7)throw Error("unsupported netlist");
  const s=new Uint8Array(2+nIn+netlist.length/7);s[1]=1;
  for(let i=0;i<nIn;i++)s[i+2]=((input[i>>3]??0)>>(i&7))&1;
  for(let i=0;i<netlist.length;i+=7){
    const a=(netlist[i+1]<<16)|(netlist[i+2]<<8)|netlist[i+3],b=(netlist[i+4]<<16)|(netlist[i+5]<<8)|netlist[i+6],idx=2+nIn+i/7;
    if(netlist[i]!==0||a>=idx||b>=idx)throw Error("malformed record");
    s[idx]=1-(s[a]&s[b]);
  }
  return s[s.length-1]===1;
}

function reference(caps,p,d,w,f){return f===15&&p>0n&&p<=caps.perCall&&p+d<=caps.daily&&p+w<=caps.weekly;}

function selfTest(){
  const caps={perCall:5n,daily:9n,weekly:13n};const c=compilePolicy(4,caps);
  let exhaustive=0;
  const check=(c,caps,p,d,w,f)=>{if(evaluateNetlist(c,packInputs(c.width,p,d,w,f))!==reference(caps,p,d,w,f))throw Error(`mismatch ${p},${d},${w},${f}`);};
  for(let p=0;p<16;p++)for(let d=0;d<16;d++)for(let w=0;w<16;w++)for(let f=0;f<16;f++){check(c,caps,BigInt(p),BigInt(d),BigInt(w),f);exhaustive++;}
  const largeCaps={perCall:1000000n,daily:10000000n,weekly:50000000n},big=compilePolicy(32,largeCaps);
  let seed=171;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return BigInt(seed);};
  let random=0;
  for(let i=0;i<10000;i++){const p=rng()%2000000n,d=rng()%20000000n,w=rng()%100000000n;check(big,largeCaps,p,d,w,i%4===0?Number(rng()%16n):15);random++;}
  const edge=[0n,1n,999999n,1000000n,1000001n,9999999n,10000000n,10000001n,49999999n,50000000n,50000001n,4294967295n];let boundary=0;
  for(const p of edge)for(const d of edge)for(const w of edge){check(big,largeCaps,p,d,w,15);boundary++;}
  let invalid=0;for(const x of [-1n,4294967296n]){try{packInputs(32,x,0n,0n,15);}catch{invalid++;}}
  if(invalid!==2)throw Error("range validation failed");
  const corrupted={...big,netlist:big.netlist.slice()};corrupted.netlist[0]=255;
  let rejected=false;try{evaluateNetlist(corrupted,packInputs(32,1n,0n,0n,15));}catch{rejected=true;}if(!rejected)throw Error("malformed record accepted");
  return {exhaustive,random,boundary,invalid,malformedRejected:rejected,smallGates:c.gateCount,largeGates:big.gateCount,largeBytes:big.netlist.length};
}

console.log(JSON.stringify(selfTest(), null, 2));
export { compilePolicy, packInputs, evaluateNetlist, reference, selfTest };
