import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inside, walkable, raster, distSegment } from './geometry.mjs';
import { distance, polygonArea } from './render.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plans = (await Promise.all(['desert','frost','inferno'].map(c => readFile(join(root,`docs/level-design/plans/${c}.json`),'utf8').then(JSON.parse)))).flat();
const errors=[], warnings=[], reports=[];
const signature = new Set();
for (const p of plans) {
  const err = message => errors.push(`${p.id}: ${message}`);
  const warn = message => warnings.push(`${p.id}: ${message}`);
  const rooms = new Map(p.rooms.map(r=>[r.id,r]));
  if(rooms.size!==p.rooms.length)err('duplicate room ids');
  if(new Set(p.passages.map(e=>e.id)).size!==p.passages.length)err('duplicate passage ids');
  const pointsInBounds = points => points.forEach(q=>{if(!q.every(Number.isFinite)||q[0]<0||q[1]<0||q[0]>p.bounds[0]||q[1]>p.bounds[1])err(`out of bounds: ${q}`);});
  p.rooms.forEach(r=>{pointsInBounds(r.polygon);if(polygonArea(r.polygon)<15)err(`${r.id} has negligible floor area`);if(!inside(r.labelAt,r.polygon))err(`room label outside ${r.id}`);});
  p.covers.forEach((c,i)=>{pointsInBounds(c.polygon);if(polygonArea(c.polygon)<1)err(`negligible cover ${i}`);});
  for(const e of p.passages){
    pointsInBounds(e.points);
    if(!rooms.has(e.from)||!rooms.has(e.to)){err(`unknown room in ${e.id}`);continue;}
    if(e.points.length<2||e.width<4)err(`insufficient width/points ${e.id}`);
    if(!inside(e.points[0],rooms.get(e.from).polygon))err(`${e.id} start outside room`);
    if(!inside(e.points.at(-1),rooms.get(e.to).polygon))err(`${e.id} end outside room`);
    for(let i=1;i<e.points.length;i++){
      const a=e.points[i-1],b=e.points[i],n=Math.ceil(distance(a,b)/.25);
      for(let j=0;j<=n;j++) { const q=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];
        if(!walkable(p,q,.35)){err(`${e.id} centre line obstructed at ${q.map(v=>v.toFixed(1))}`);break;}
      }
    }
  }
  const visited=new Set([p.entry.room]);
  let changed=true;while(changed){changed=false;for(const e of p.passages){if(visited.has(e.from)&&!visited.has(e.to)){visited.add(e.to);changed=true;}if(visited.has(e.to)&&!visited.has(e.from)){visited.add(e.from);changed=true;}}}
  if(visited.size!==rooms.size)err('disconnected room graph');
  let current=p.entry.room;
  for(const id of p.mainRoute){const e=p.passages.find(e=>e.id===id);if(!e){err(`unknown main route ${id}`);continue;}if(e.from===current)current=e.to;else if(e.to===current)current=e.from;else err(`main route discontinuity at ${id}`);}
  if(current!==p.exit.room)err('main route does not lead to exit');
  const anchors=[['entry',p.entry],['exit',p.exit],...p.encounters.flatMap(e=>[[`encounter ${e.id}`,e],...(e.approaches??[]).map(a=>[`approach ${e.id}/${a.room}`,a])]),...p.rewards.map((r,i)=>[`reward ${i+1}`,r]),...(p.preparation?[['preparation',p.preparation]]:[])];
  for(const e of p.encounters) pointsInBounds([e.at,e.facing,...(e.approaches??[]).flatMap(a=>[a.at,a.facing])]);
  for(const r of p.rewards){
    if(!['heal','coins','weapon','scroll','upgrade'].includes(r.reward))err(`invalid reward ${r.label}`);
    if(!r.requires?.length||r.requires.some(id=>!p.encounters.some(e=>e.id===id)))err(`invalid reward guard ${r.label}`);
  }
  if(p.index!==5 && (p.rewards.length!==3 || new Set(p.rewards.map(r=>r.room)).size!==3))err('ordinary level needs three chests in distinct rooms');
  if(p.index===5 && !p.preparation)err('boss level missing preparation room');
  if(p.preparation){
    pointsInBounds([p.preparation.at,p.preparation.facing]);
    if(p.entry.room!==p.preparation.room)err('boss arrival outside preparation room');
    const room=rooms.get(p.preparation.room);
    for(let dx=-8;dx<=8;dx+=.5)for(let dy=-8;dy<=8;dy+=.5){
      const q=[p.preparation.at[0]+dx,p.preparation.at[1]+dy];
      if(!room||!inside(q,room.polygon)||!walkable(p,q,0)){err('complete shop clearance obstructed');dx=9;break;}
    }
    if(p.encounters.some(e=>e.room===p.preparation.room)||p.rewards.some(r=>r.room===p.preparation.room))err('preparation contains combat or free chest');
  }
  const grid = raster(p,.35,.5), large = raster(p,1.25,.5);
  for(const [label,a] of anchors){
    if(!rooms.has(a.room)||!inside(a.at,rooms.get(a.room).polygon))err(`${label} outside named room`);
    if(!walkable(p,a.at,.35))err(`${label} does not have player clearance`);
    if(!grid.reachable(a.at))err(`${label} unreachable for player on 0.5m grid`);
    if(!large.reachable(a.at))warn(`${label} not reachable for radius 1.25m on 0.5m grid; inspect placement`);
  }
  for(const r of p.rooms)if(!grid.reachable(r.labelAt))err(`${r.id} label/room anchor unreachable`);
  if(grid.connectedArea/grid.area<.99)warn(`${(100-grid.connectedArea/grid.area*100).toFixed(2)}% of raster floor disconnected`);
  // Distinct graph edges must not create an unplanned junction outside a named room.
  for(let i=0;i<p.passages.length;i++)for(let j=i+1;j<p.passages.length;j++){
    const a=p.passages[i],b=p.passages[j];
    if([a.from,a.to].some(r=>r===b.from||r===b.to))continue;
    let found=false;
    for(let k=1;k<a.points.length&&!found;k++){
      const u=a.points[k-1],v=a.points[k],n=Math.max(1,Math.ceil(distance(u,v)*2));
      for(let s=0;s<=n;s++){
        const q=[u[0]+(v[0]-u[0])*s/n,u[1]+(v[1]-u[1])*s/n];
        if(b.points.slice(1).some((z,t)=>distSegment(q,b.points[t],z)<(a.width+b.width)/2-.2)){
          err(`undeclared passage intersection ${a.id}/${b.id} near ${q.map(v=>v.toFixed(1))}`);found=true;break;
        }
      }
    }
  }
  // A line drawn as a firing lane must not travel through a solid blocker.
  for(const line of p.sightlines){
    const n=Math.ceil(distance(line.from,line.to)/.25);
    for(let i=0;i<=n;i++){const t=i/n,q=[line.from[0]+(line.to[0]-line.from[0])*t,line.from[1]+(line.to[1]-line.from[1])*t];
      if(p.covers.some(c=>inside(q,c.polygon))){warn(`sightline '${line.label}' intersects solid cover`);break;}
    }
  }
  // Detect drawings that differ only in content labels, not geometry.
  const key=JSON.stringify([p.rooms.map(r=>r.polygon),p.passages.map(e=>[e.points,e.width])]);
  if(signature.has(key))err('duplicate geometry');signature.add(key);
  const bossRadius=p.index===5?(p.chapter==='desert'?2.1:1.3):null;
  if(bossRadius&&!walkable(p,p.encounters[0].at,bossRadius))err(`boss does not have ${bossRadius}m radius clearance`);
  reports.push({id:p.id,title:p.title,rooms:rooms.size,connections:p.passages.length,independentGraphLoops:p.passages.length-rooms.size+1,bounds:p.bounds,playerRadius:.35,rasterStep:.5,approxWalkableArea:Math.round(grid.area),connectedAreaPercent:+(grid.connectedArea/grid.area*100).toFixed(3),anchors:anchors.length,largeUnitAnchorsReachable:anchors.filter(([,a])=>large.reachable(a.at)).length,bossRadius});
}
if(plans.length!==15)errors.push(`Expected 15 maps; got ${plans.length}`);
const report={status:errors.length?'FAIL':'PASS',scope:'2D design geometry only; not runtime collision, navigation, LOS or gameplay validation',maps:plans.length,reports,errors,warnings};
await mkdir(join(root,'docs/level-design'),{recursive:true});
await writeFile(join(root,'docs/level-design/validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=errors.length?1:0;
