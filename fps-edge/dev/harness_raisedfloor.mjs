// Raised floor that the player fits under standing. Verify: standing under
// it does not eject; jumping under it does NOT fling the player sideways
// (the ceiling clip caps the rise, body stays put). Replicates the exact
// player.js vertical/ceiling step + real collision.js horizontal collide.
import { makeBoxSolid, collideCapsule, ceilingHeightAt } from '../src/collision.js';
const DT=1/60, JV=6.0, G=20.0, SH=1.7, R=0.4;
makeBoxSolid(-200,200,-2,0,-200,200);          // floor
// Raised floor: underside at y=2.0 (gap 2.0 > standing 1.7 → fits), 0.6 thick,
// 8x8 footprint centred at origin.
makeBoxSolid(-4,4, 2.0, 2.6, -4,4);

function sim(jump){
  let x=0,y=0,z=0,vy=0,grounded=true;
  let maxXZ=0, maxHead=0, passedThrough=false;
  for(let f=0; f<200; f++){
    if(f===0 && jump){ vy=JV; grounded=false; }
    // 1. horizontal collide (bodyH = standing)
    const res = collideCapsule(x, y, z, R, SH);
    x=res.x; z=res.z;
    maxXZ=Math.max(maxXZ, Math.hypot(x,z));
    // 2. vertical: gravity + ceiling clip + ground support (simplified: floor)
    vy-=G*DT; let nY=y+vy*DT;
    if(vy>0){
      const ceil=ceilingHeightAt(x,z,y+SH,R);
      if(ceil!==null && nY+SH>ceil){ nY=ceil-SH-0.02; if(nY<y)nY=y; vy=0; }
    }
    if(nY<=0+0.001){ y=0; vy=0; grounded=true; } else { y=nY; grounded=false; }
    maxHead=Math.max(maxHead, y+SH);
    if(y+SH > 2.0+0.05) passedThrough=true;   // head went above underside
  }
  return {maxXZ, maxHead, passedThrough, x, z};
}
let pass=0,total=0;
const ok=(n,c,d)=>{total++;console.log(`  ${c?'PASS':'FAIL'}  ${n}  ${d||''}`);if(c)pass++;};
const f=(v)=>Number(v).toFixed(4);
const stand=sim(false);
ok('standing under raised floor: NOT ejected (stays at origin)',
   stand.maxXZ < 0.05, `maxXZ=${f(stand.maxXZ)}`);
const jmp=sim(true);
ok('jumping under raised floor: NOT flung sideways',
   jmp.maxXZ < 0.10, `maxXZ=${f(jmp.maxXZ)} (final x=${f(jmp.x)} z=${f(jmp.z)})`);
ok('jumping under raised floor: head does NOT pass the underside',
   !jmp.passedThrough && jmp.maxHead <= 2.0+0.06, `maxHead=${f(jmp.maxHead)} (underside 2.00)`);
console.log(`\n================  ${pass}/${total} PASS  ================`);
if(pass!==total) process.exit(1);
