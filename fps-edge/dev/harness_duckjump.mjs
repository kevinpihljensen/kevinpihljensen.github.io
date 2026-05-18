// Faithful duck-jump harness. Replicates the SHIPPED player.js loop —
// horizontal move + REAL collision.js collideCapsule (the box-SIDE body
// block, which is the true gate to getting on top) + vertical with REAL
// groundHeightAt + the airLift compression — and walks the player at a real
// box to measure the TRUE max mountable height for a normal jump vs a
// duck-jump. (The previous harness wrongly ignored the side-block.)
import { makeBoxSolid, collideCapsule, groundHeightAt } from '../src/collision.js';

const DT=1/60, JV=6.0, G=20.0, SH=1.7, CH=1.3, CR=10.0, R=0.4, STEP=0.55;
const DELTA=SH-CH;                       // 0.40 compression
makeBoxSolid(-200,200,-2,0,-200,200);    // floor top y=0
// One test box, 3x3 footprint centred at origin, height set per scenario by
// stacking: we can't resize a solid, so build a tall box and treat its top
// analytically via groundHeightAt? No — we need the real SIDE block, so we
// build the box at the scenario height. One process can only register once,
// so we model the box plane-set inline using the same math collideCapsule
// uses is overkill; instead: build MANY boxes side by side, one per height,
// each in its own X lane, and run the player down each lane.
const LANES=[];
for(let i=0;i<26;i++){
  const H=0.70+i*0.05;            // 0.70 .. 1.95
  const cx=i*10;                  // lanes 10 m apart (no interaction)
  makeBoxSolid(cx-1.5,cx+1.5,0,H,-1.5,1.5);
  LANES.push({H,cx});
}

// Simulate one lane. Player starts at (cx-4, 0) on the floor, jumps and runs
// +x toward the box; optional crouch held from crouchStart frame.
function run(lane, crouchStart){
  let x=lane.cx-4, y=0, z=0, vy=0, vx=0, ct=0, gnd=true;
  // jump + run
  for(let fr=0;fr<240;fr++){
    // input: hold forward; jump on frame 0 (grounded); crouch from crouchStart
    if(fr===0){ vy=JV; gnd=false; }
    const ck = crouchStart!==null && fr>=crouchStart;
    const tt=ck?1:0, st=CR*DT;
    if(ct<tt)ct=Math.min(tt,ct+st); else if(ct>tt)ct=Math.max(tt,ct-st);
    const bH=SH+(CH-SH)*ct;
    const airLift = (!gnd) ? (SH-bH) : 0;
    vx = 6.0;                       // constant forward run speed
    // 1. horizontal + real side-block (uses compressed feet while airborne)
    x += vx*DT;
    const res = collideCapsule(x, y+airLift, z, R, bH);
    x = res.x; z = res.z;
    // 2. vertical
    const wasG=gnd; vy-=G*DT; let nY=y+vy*DT;
    // ground support with compressed feet
    const qF=y+airLift, qN=nY+airLift;
    const gY=groundHeightAt(x,z,Math.max(qF,qN)+STEP,R);
    if(gY!==null && qN<=gY+0.001){ y=gY; vy=0; gnd=true; }
    else {
      y=nY; gnd=false;
      if(wasG && vy<=0 && gY!==null && nY-gY<STEP && nY-gY>0){ y=gY; vy=0; gnd=true; }
    }
    // success: standing on the box top (y≈H) and over the box footprint
    if(gnd && Math.abs(y-lane.H)<1e-4 && x>lane.cx-1.5-R && x<lane.cx+1.5+R)
      return true;
    // give up if we ran well past the box still on the floor
    if(x>lane.cx+3 && Math.abs(y)<1e-4) return false;
  }
  return false;
}

function maxNormal(){ let b=0; for(const L of LANES) if(run(L,null)) b=Math.max(b,L.H); return b; }
function maxDuck(){
  let b=0,bs=-1;
  for(const L of LANES){
    for(let cs=0;cs<=40;cs++){ if(run(L,cs)){ if(L.H>b)bs=cs; b=Math.max(b,L.H); break; } }
  }
  return {b,bs};
}

let pass=0,total=0;
const ok=(n,c,d)=>{total++;console.log(`  ${c?'PASS':'FAIL'}  ${n}  ${d||''}`);if(c)pass++;};
const f=(n,p=3)=>Number(n).toFixed(p);
// reference free-flight feet apex
let yy=0,vv=JV,apex=0; for(let i=0;i<60;i++){vv-=G*DT;yy+=vv*DT;apex=Math.max(apex,yy);}
const N=maxNormal();
const D=maxDuck();
console.log(`Free-flight feet apex = ${f(apex)} m   compression Δ = ${f(DELTA)} m`);
console.log(`\nMax mountable box (real side-block gate):`);
console.log(`  normal jump            : ${f(N)} m`);
console.log(`  duck-jump (best timing): ${f(D.b)} m  (crouch ~frame ${D.bs} = ${f(D.bs*DT)}s)`);
console.log(`  gain                   : +${f(D.b-N)} m`);

ok('normal jump CANNOT mount 1.35 m (matches the user report)', N < 1.35, `N=${f(N)}`);
ok('normal-jump ceiling ≈ free-flight feet apex (the true gate)',
   Math.abs(N-apex) < 0.12, `N=${f(N)} apex=${f(apex)}`);
ok('duck-jump mounts strictly higher than a normal jump',
   D.b > N + 0.05, `+${f(D.b-N)} m`);
ok('duck-jump gain ≈ the compression Δ (≈0.40 m), bounded',
   (D.b-N) > 0.20 && (D.b-N) <= DELTA + 0.10, `gain=${f(D.b-N)} Δ=${f(DELTA)}`);
ok('duck-jump still cannot mount absurd heights (≤ apex+Δ+pad)',
   D.b <= apex + DELTA + 0.12, `D=${f(D.b)} cap≈${f(apex+DELTA)}`);

const r2=v=>Math.round(v*20)/20;       // round to 0.05
console.log(`\nSuggested labeled test-box heights (around the REAL ceilings):`);
console.log(`  ${f(r2(N-0.10),2)}  (normal jump)`);
console.log(`  ${f(r2(N+0.05),2)}  (just above normal — needs duck-jump)`);
console.log(`  ${f(r2((N+D.b)/2),2)}  (duck-jump)`);
console.log(`  ${f(r2(D.b),2)}  (duck-jump, near the limit)`);
console.log(`  ${f(r2(D.b+0.15),2)}  (impossible — above the duck ceiling)`);
console.log(`\n================  ${pass}/${total} PASS  ================`);
if(pass!==total) process.exit(1);
