/* High-resolution first Master, independent of the uploaded Base's pixel count. */
(function(root){
  function target(width,height){
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
    const ratio=width/height;if(ratio<1/3||ratio>3)return null;
    // Keep near-square output at or below the nonexperimental pixel budget.
    const edge=Math.max(ratio,1/ratio)<1.14?1920:2048;
    return {width:width>=height?edge:Math.max(16,Math.round(edge*ratio/16)*16),height:height>=width?edge:Math.max(16,Math.round(edge/ratio/16)*16)};
  }
  if(typeof module==='object'&&module.exports)module.exports={target};else root.MozMasterResolution={target};
})(typeof window==='object'?window:globalThis);
