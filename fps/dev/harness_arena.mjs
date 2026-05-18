// Verifies THE CITADEL (data-driven src/maplayout.js): rebuilds solids via
// the kit math mirror against REAL collision.js, then asserts the key
// numeric invariants — connector seam continuity, spawn clearance, bounds,
// the flush BRIDGE join, and the raised-floor under-lane (the fix).
import { LAYOUT, SPAWN, wallBoxes } from '../src/maplayout.js';
import { makeBoxSolid, makeRampSolid, groundHeightAt, collideCapsule }
  from '../src/collision.js';
import { ARENA_PLAYABLE_HALF } from '../src/constants.js';
const clamp=(v,lo,hi)=>v<lo?lo:v>hi?hi:v, R=0.4, BODY=1.7, BIG=1e6;
function solve(P,side,run,width,fromY){
  const hiY=P.top,loY=fromY,half=width/2; let axis,loPos,hiPos,c0,c1;
  if(side==='-z'||side==='+z'){axis='z';
    if(side==='-z'){hiPos=P.z0;loPos=P.z0-run;}else{hiPos=P.z1;loPos=P.z1+run;}
    c0=clamp(P.cx-half,P.x0,P.x1);c1=clamp(P.cx+half,P.x0,P.x1);
  }else{axis='x';
    if(side==='-x'){hiPos=P.x0;loPos=P.x0-run;}else{hiPos=P.x1;loPos=P.x1+run;}
    c0=clamp(P.cz-half,P.z0,P.z1);c1=clamp(P.cz+half,P.z0,P.z1);}
  return{axis,loPos,hiPos,loY,hiY,c0,c1};
}
// S55: track HOUSE_NW_F2 + WAREHOUSE_ROOF as the canonical "platform + box
// adjacent to it" pair so the raised-floor under-lane assertion has something
// to anchor on. CATWALK_HE (named structural box) anchors the catwalk-flush
// check the way BRIDGE did under the old Citadel layout.
const H={}, conns=[]; let HILLTOP=null, CATWALK_HE=null;
for(const e of LAYOUT){
  if(e.t==='ground') makeBoxSolid(-e.half,e.half,(e.y||0)-2,e.y||0,-e.half,e.half);
  else if(e.t==='perimeter'){const t=e.thick||1,h=e.half,H2=e.height;
    for(const [x0,x1,z0,z1] of [[-h-t,h+t,h,h+t],[-h-t,h+t,-h-t,-h],[h,h+t,-h-t,h+t],[-h-t,-h,-h-t,h+t]])
      makeBoxSolid(x0,x1,0,H2,z0,z1,{noWalk:true});}
  else if(e.t==='platform'){const th=e.thick==null?0.6:e.thick;
    const x0=e.cx-e.sx/2,x1=e.cx+e.sx/2,z0=e.cz-e.sz/2,z1=e.cz+e.sz/2;
    makeBoxSolid(x0,x1,e.top-th,e.top,z0,z1);
    const hnd={top:e.top,x0,x1,z0,z1,cx:e.cx,cz:e.cz}; if(e.id)H[e.id]=hnd;
    if(e.id==='HILLTOP')HILLTOP=hnd;}
  else if(e.t==='box'){const b=e.base||0;
    const x0=e.cx-e.sx/2,x1=e.cx+e.sx/2,z0=e.cz-e.sz/2,z1=e.cz+e.sz/2;
    makeBoxSolid(x0,x1,b,b+e.sy,z0,z1);
    const hnd={top:b+e.sy,x0,x1,z0,z1,cx:e.cx,cz:e.cz}; if(e.id)H[e.id]=hnd;
    if(e.id==='CATWALK_HE')CATWALK_HE={...hnd,yMin:b};}
  else if(e.t==='wall'){
    // S55b: decompose into the wallBoxes() segments so doorways/windows in
    // the LAYOUT actually become gaps in the simulated collision (matches
    // what arena.js + kit.solidBox build at runtime). Without this, the
    // harness reads every wall as one solid box and bogus-fails any test
    // that walks an external connector THROUGH a building doorway.
    for(const r of wallBoxes(e))
      makeBoxSolid(r.x0,r.x1,r.y0,r.y1,r.z0,r.z1,{noWalk:true});
  }
  else if(e.t==='rampTo'||e.t==='stairsTo'){const P=H[e.to];
    const c=solve(P,e.side,e.run,e.width,e.fromY||0);
    makeRampSolid(c.axis,c.loPos,c.hiPos,c.loY,c.hiY,c.c0,c.c1,e.thick==null?0.6:e.thick,{skirtSolid:true});
    conns.push({to:e.to,c});}
  else if(e.t==='overhang')
    makeRampSolid(e.axis,e.loPos,e.hiPos,e.loY,e.hiY,e.c0,e.c1,e.thick==null?0.6:e.thick);
}
let pass=0,total=0;
const ok=(n,c,d)=>{total++;console.log(`  ${c?'PASS':'FAIL'}  ${n}  ${d||''}`);if(c)pass++;};
const f=v=>Number(v).toFixed(4);
// 1. every connector seam continuous (real groundHeightAt along the run)
let seamFails=0;
for(const {to,c} of conns){
  const slope=Math.abs((c.hiY-c.loY)/(c.hiPos-c.loPos));
  const aMin=Math.min(c.loPos,c.hiPos),aMax=Math.max(c.loPos,c.hiPos),cf=(c.c0+c.c1)/2;
  let prev=null,mj=0,nul=false,bump=-1e9;
  for(let s=aMin-0.4;s<=aMax+1.2;s+=0.1){
    const x=c.axis==='z'?cf:s, z=c.axis==='z'?s:cf;
    const h=groundHeightAt(x,z,BIG,R);
    if(h===null){nul=true;continue;}
    if(prev!==null)mj=Math.max(mj,Math.abs(h-prev));
    bump=Math.max(bump,h-Math.max(c.loY,c.hiY)); prev=h;
  }
  const good=!nul&&mj<=slope*0.1+0.02&&bump<=0.02;
  if(!good)seamFails++;
  ok(`seam → ${to} (${f(c.loY)}→${f(c.hiY)}) continuous`, good, `maxStep=${f(mj)} null=${nul} bump=${f(Math.max(0,bump))}`);
}
ok('all connector seams continuous', seamFails===0, `${conns.length} connectors`);
// 2. spawn is open floor
ok('spawn (0,0) is open ground', Math.abs(groundHeightAt(SPAWN.x,SPAWN.z,BIG,R)-0)<1e-6);
// 3. all platforms / structural boxes within the playable half
const PB = ARENA_PLAYABLE_HALF;
let within=true;
for(const e of LAYOUT) if(e.t==='platform'||(e.t==='box'&&e.id)){
  if(Math.abs(e.cx)+e.sx/2>PB+0.001||Math.abs(e.cz)+e.sz/2>PB+0.001) within=false;
}
ok(`all decks within ±${PB} (spawnable arena)`, within);
// 4. CATWALK_HE flush with HILLTOP (same top) and abuts its east edge.
ok('CATWALK_HE top flush with HILLTOP top (6.0)',
   Math.abs(CATWALK_HE.top-HILLTOP.top)<1e-6, `${f(CATWALK_HE.top)} vs ${f(HILLTOP.top)}`);
ok('CATWALK_HE abuts HILLTOP east edge (x0==HILLTOP.x1)',
   Math.abs(CATWALK_HE.x0-HILLTOP.x1)<1e-6, `${f(CATWALK_HE.x0)} vs ${f(HILLTOP.x1)}`);
// 5. raised-floor under-lane: standing under CATWALK_HE not ejected, floor below.
{ const bx=(CATWALK_HE.x0+CATWALK_HE.x1)/2, bz=(CATWALK_HE.z0+CATWALK_HE.z1)/2;
  const res=collideCapsule(bx,0,bz,R,BODY);
  ok('standing under CATWALK_HE not ejected (raised-floor fix)',
     Math.hypot(res.x-bx,res.z-bz)<0.05, `x=${f(res.x)} z=${f(res.z)}`);
  ok('ground under CATWALK_HE is walkable floor (y=0)',
     Math.abs(groundHeightAt(bx,bz,CATWALK_HE.yMin-0.1,R)-0)<1e-6); }

// 6. S55b: every external connector lets the player walk onto its target
// deck without being ejected by a wall body sitting in the landing zone.
// For each connector, sample a point ~0.5m short of the deck edge along the
// stair surface and verify collideCapsule does not horizontally displace
// the capsule. This catches the "external stair passes through a building
// wall" bug class — fixed by adding tall doorways through walls/parapets
// where each connector lands.
for(const {to,c} of conns){
  // Pick a sample BELOW the deck top: 0.5 m short of hiPos along the run
  // axis, with the surface y at that point.
  const dirSign = Math.sign(c.hiPos - c.loPos) || 1;
  const samplePos = c.hiPos - dirSign * 0.5;        // 0.5 m short of deck edge
  const slope = (c.hiY - c.loY) / (c.hiPos - c.loPos);
  const sy = slope * samplePos + (c.loY - slope * c.loPos);
  const cf = (c.c0 + c.c1) / 2;
  const sx = c.axis === 'z' ? cf : samplePos;
  const sz = c.axis === 'z' ? samplePos : cf;
  // Feet on the slope surface; collideCapsule should NOT move us horizontally.
  const res = collideCapsule(sx, sy, sz, R, BODY);
  const moved = Math.hypot(res.x - sx, res.z - sz);
  ok(`connector landing → ${to}: capsule at the top of the stair not ejected`,
     moved < 0.05, `moved=${f(moved)} at (${f(sx)}, ${f(sz)}) y=${f(sy)}`);
}
console.log(`\n================  ${pass}/${total} PASS  ================`);
if(pass!==total) process.exit(1);
