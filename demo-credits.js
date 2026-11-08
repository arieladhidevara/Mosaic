/* Shared display policy. These are simulation units, never money or OpenAI balance. */
(function(root){
  const policy=Object.freeze({initial:100,costs:Object.freeze({low:1,medium:2,high:3}),version:'pro-demo-v1'});
  if(typeof module==='object'&&module.exports)module.exports=policy;else root.MozDemoCredits=policy;
})(typeof window==='object'?window:globalThis);
