/* Pure mask-difference helpers. Binary pixels use 1 for visible object ownership. */
export function calculateMaskDelta(oldBits,newBits){
  if(!(oldBits instanceof Uint8Array)||!(newBits instanceof Uint8Array)||oldBits.length!==newBits.length)
    throw new TypeError('Masks must have the same pixel dimensions.');
  const union=new Uint8Array(oldBits.length),revealed=new Uint8Array(oldBits.length),added=new Uint8Array(oldBits.length);
  let oldCount=0,newCount=0,unionCount=0,revealedCount=0,addedCount=0,overlapCount=0;
  for(let i=0;i<oldBits.length;i++){
    const was=oldBits[i]>0,now=newBits[i]>0;
    union[i]=was||now?1:0;revealed[i]=was&&!now?1:0;added[i]=now&&!was?1:0;
    oldCount+=Number(was);newCount+=Number(now);unionCount+=Number(was||now);
    revealedCount+=Number(was&&!now);addedCount+=Number(now&&!was);overlapCount+=Number(was&&now);
  }
  return {union,revealed,added,oldCount,newCount,unionCount,revealedCount,addedCount,overlapCount,iou:overlapCount/Math.max(1,unionCount)};
}
