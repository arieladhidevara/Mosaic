/* Plain polygon geometry shared by the mask editor and its regression tests. */
(function(root,factory){
  const geometry=factory();
  if(typeof module==='object'&&module.exports)module.exports=geometry;
  else root.MozMaskGeometry=geometry;
})(globalThis,function(){
  const copyPaths=paths=>(paths||[]).map(path=>path.map(point=>({x:point.x,y:point.y})));
  function closestEdge(paths,point){
    let best=null;
    paths.forEach((path,pathIndex)=>path.forEach((a,index)=>{
      const b=path[(index+1)%path.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
      if(!length)return;
      const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length));
      const projected={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(point.x-projected.x,point.y-projected.y);
      if(!best||distance<best.distance)best={pathIndex,index,point:projected,distance,normal:{x:-dy/Math.sqrt(length),y:dx/Math.sqrt(length)}};
    }));
    return best;
  }
  function moveVertex(paths,pathIndex,index,point){
    const next=copyPaths(paths);next[pathIndex][index]={x:point.x,y:point.y};return next;
  }
  function insertVertex(paths,pathIndex,index,point){
    const next=copyPaths(paths);next[pathIndex].splice(index+1,0,{x:point.x,y:point.y});return next;
  }
  function removeVertex(paths,pathIndex,index){
    const next=copyPaths(paths);if(next[pathIndex].length>3)next[pathIndex].splice(index,1);return next;
  }
  function contains(path,point){
    let inside=false;
    for(let i=0,j=path.length-1;i<path.length;j=i++){
      const a=path[i],b=path[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside;
  }
  function triangulate(path){
    const indices=path.map((_,i)=>i),triangles=[];
    const area=path.reduce((sum,p,i)=>{const q=path[(i+1)%path.length];return sum+p.x*q.y-q.x*p.y},0),sign=area>=0?1:-1;
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    let attempts=0;
    while(indices.length>3&&attempts++<path.length*path.length){
      let clipped=false;
      for(let i=0;i<indices.length;i++){
        const a=indices[(i+indices.length-1)%indices.length],b=indices[i],c=indices[(i+1)%indices.length];
        if(cross(path[a],path[b],path[c])*sign<1e-7)continue;
        const occupied=indices.some(index=>index!==a&&index!==b&&index!==c&&cross(path[a],path[b],path[index])*sign>=-1e-7&&cross(path[b],path[c],path[index])*sign>=-1e-7&&cross(path[c],path[a],path[index])*sign>=-1e-7);
        if(occupied)continue;
        triangles.push([a,b,c]);indices.splice(i,1);clipped=true;break;
      }
      if(!clipped)break;
    }
    for(let i=1;i<indices.length-1;i++)triangles.push([indices[0],indices[i],indices[i+1]]);
    return triangles;
  }
  function simplify(path,tolerance){
    if(path.length<=4)return path;
    let far=1;
    path.forEach((p,i)=>{if((p.x-path[0].x)**2+(p.y-path[0].y)**2>(path[far].x-path[0].x)**2+(path[far].y-path[0].y)**2)far=i});
    function open(points){
      const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
      const stack=[[0,points.length-1]];
      while(stack.length){
        const [start,end]=stack.pop(),a=points[start],b=points[end],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
        let max=tolerance*tolerance,at=-1;
        for(let i=start+1;i<end;i++){
          const p=points[i],t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
          const distance=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
          if(distance>max){max=distance;at=i}
        }
        if(at>=0){keep[at]=1;stack.push([start,at],[at,end])}
      }
      return points.filter((_,i)=>keep[i]);
    }
    const first=open(path.slice(0,far+1)),second=open([...path.slice(far),path[0]]);
    const result=[...first.slice(0,-1),...second.slice(0,-1)];return result.length>=3?result:path;
  }
  function traceMask(data,width,height,scaleX=1,scaleY=1,tolerance=1){
    const edges=new Map(),stride=width+1;
    const filled=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&data[(y*width+x)*4+3]>0;
    const add=(x1,y1,x2,y2)=>{const from=y1*stride+x1,to=y2*stride+x2;if(!edges.has(from))edges.set(from,[]);edges.get(from).push(to)};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(filled(x,y)){
      if(!filled(x,y-1))add(x,y,x+1,y);
      if(!filled(x+1,y))add(x+1,y,x+1,y+1);
      if(!filled(x,y+1))add(x+1,y+1,x,y+1);
      if(!filled(x-1,y))add(x,y+1,x,y);
    }
    const paths=[],direction=(a,b)=>b-a===1?0:b-a===stride?1:b-a===-1?2:3;
    while(edges.size){
      const start=edges.keys().next().value,path=[];let current=start,previous=null;
      do{
        path.push({x:(current%stride)*scaleX,y:Math.floor(current/stride)*scaleY});
        const choices=edges.get(current);if(!choices)break;
        let index=0;
        if(previous!==null&&choices.length>1){
          const before=direction(previous,current),priority=[1,0,3,2];
          index=choices.reduce((best,to,i)=>priority.indexOf((direction(current,to)-before+4)%4)<priority.indexOf((direction(current,choices[best])-before+4)%4)?i:best,0);
        }
        const next=choices.splice(index,1)[0];if(!choices.length)edges.delete(current);
        previous=current;current=next;
      }while(current!==start);
      if(path.length>=3){
        const reduced=simplify(path,tolerance);
        const area=Math.abs(reduced.reduce((sum,p,i)=>{const q=reduced[(i+1)%reduced.length];return sum+p.x*q.y-q.x*p.y},0))/2;
        if(area>=scaleX*scaleY)paths.push(reduced);
      }
    }
    return paths;
  }
  return {copyPaths,closestEdge,moveVertex,insertVertex,removeVertex,traceMask,contains,triangulate};
});
