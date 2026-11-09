const {test}=require('node:test');
const assert=require('node:assert/strict');
const geometry=require('../mask-geometry');
const square=[[{x:10,y:10},{x:110,y:10},{x:110,y:90},{x:10,y:90}]];
test('simplification straightens noisy edges and retains corners without changing its input',()=>{
  const path=[{x:0,y:0},...Array.from({length:19},(_,i)=>({x:(i+1)*5,y:i%2?1:-1})),{x:100,y:0},{x:100,y:100},{x:0,y:100}];
  const original=JSON.stringify(path),simple=geometry.simplify(path,2);
  assert.equal(simple.length,4);assert(simple.some(p=>p.x===100&&p.y===100));assert.equal(JSON.stringify(path),original);
  assert.equal(geometry.simplify([{x:1,y:1},{x:2,y:1},{x:2,y:2}],10).length,3);
});
test('moving one point keeps every other point fixed and leaves the input untouched',()=>{
  const moved=geometry.moveVertex(square,0,1,{x:125,y:28});
  assert.deepEqual(moved[0][1],{x:125,y:28});
  for(const i of [0,2,3])assert.deepEqual(moved[0][i],square[0][i]);
  assert.deepEqual(square[0][1],{x:110,y:10});
});
test('inserting a point on a line preserves the outline and all existing points',()=>{
  const edge=geometry.closestEdge(square,{x:60,y:13});assert.equal(edge.index,0);assert.equal(edge.distance,3);
  const inserted=geometry.insertVertex(square,edge.pathIndex,edge.index,edge.point);
  assert.deepEqual(inserted[0],[square[0][0],{x:60,y:10},...square[0].slice(1)]);
});
test('removing a point preserves the remaining vertices and requires at least three',()=>{
  const triangle=geometry.removeVertex(square,0,1);assert.deepEqual(triangle[0],[square[0][0],square[0][2],square[0][3]]);
  assert.deepEqual(geometry.removeVertex(triangle,0,0),triangle);
});
test('editing a contour leaves every other contour intact',()=>{
  const paths=[...square,[{x:25,y:25},{x:35,y:25},{x:30,y:35}]];
  const moved=geometry.moveVertex(paths,1,0,{x:22,y:24});assert.deepEqual(moved[0],square[0]);assert.deepEqual(moved[1].slice(1),paths[1].slice(1));
});
test('raster tracing preserves holes and separate islands',()=>{
  const w=40,h=30,data=new Uint8ClampedArray(w*h*4);
  for(let y=2;y<25;y++)for(let x=2;x<30;x++)if(!(x>=10&&x<20&&y>=10&&y<20))data[(y*w+x)*4+3]=255;
  for(let y=3;y<8;y++)for(let x=33;x<38;x++)data[(y*w+x)*4+3]=64;
  const paths=geometry.traceMask(data,w,h,1,1,.25);assert.equal(paths.length,3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const selected=paths.filter(path=>geometry.contains(path,{x:x+.5,y:y+.5})).length%2===1;
    assert.equal(selected,data[(y*w+x)*4+3]>0,`mask mismatch at ${x},${y}`);
  }
});
test('diagonally touching pixels form separate closed contours',()=>{
  const data=new Uint8ClampedArray(3*3*4);data[3]=255;data[(1*3+1)*4+3]=255;
  assert.equal(geometry.traceMask(data,3,3,1,1,.1).length,2);
});
for(const path of [square[0],[{x:0,y:0},{x:50,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:50,y:50},{x:0,y:100}]])test('polygon mesh covers its source outline',()=>{
  const triangles=geometry.triangulate(path),area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y},0))/2;
  assert.equal(triangles.reduce((sum,triangle)=>sum+area(triangle.map(i=>path[i])),0),area(path));
  assert.equal(new Set(triangles.flat()).size,path.length);
});
