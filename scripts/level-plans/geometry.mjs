export const distSegment = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy || 1)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};
export function inside(p, polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (distSegment(p, a, b) < 1e-7) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) yes = !yes;
  }
  return yes;
}
export function floorAt(plan, p) {
  return plan.rooms.some(r => inside(p, r.polygon)) || plan.passages.some(c => c.points.slice(1).some((b,i) => distSegment(p,c.points[i],b) <= c.width/2));
}
export function solidAt(plan, p) { return plan.covers.some(c => inside(p,c.polygon)); }
export function walkable(plan, p, radius = .35) {
  if (!floorAt(plan,p) || solidAt(plan,p)) return false;
  // Eight perimeter samples plus exact segment distance to all solid cover edges.
  for (let i = 0; i < 8; i++) {
    const angle = i*Math.PI/4;
    if (!floorAt(plan,[p[0]+Math.cos(angle)*radius,p[1]+Math.sin(angle)*radius])) return false;
  }
  return !plan.covers.some(c => c.polygon.some((a,i) => distSegment(p,a,c.polygon[(i+1)%c.polygon.length]) < radius));
}
export function raster(plan, radius = .35, step = .5) {
  const width = Math.ceil(plan.bounds[0]/step)+1, height = Math.ceil(plan.bounds[1]/step)+1;
  const grid = new Uint8Array(width*height);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) if(walkable(plan,[x*step,y*step],radius)) grid[y*width+x]=1;
  const index = p => Math.round(p[1]/step)*width+Math.round(p[0]/step);
  const visited = new Uint8Array(grid.length), queue = new Int32Array(grid.length);
  let head=0, tail=0; const start=index(plan.entry.at);
  if(grid[start]) { visited[start]=1; queue[tail++]=start; }
  while(head<tail) { const i=queue[head++], x=i%width, y=Math.floor(i/width);
    for(const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
      if(nx<0||ny<0||nx>=width||ny>=height)continue;
      const next=ny*width+nx; if(grid[next]&&!visited[next]) {visited[next]=1;queue[tail++]=next;}
    }
  }
  return { reachable: p => !!visited[index(p)], area: grid.reduce((n,v)=>n+v,0)*step*step, connectedArea:tail*step*step, width,height,grid,visited };
}
