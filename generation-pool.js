/* Bound parallel work without making one failed request block the others. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MozGenerationPool=api})(globalThis,function(){
  function createPool(limit=3){
    if(!Number.isInteger(limit)||limit<1)throw Error('Concurrency must be a positive integer.');
    const waiting=[];let active=0;
    function drain(){
      while(active<limit&&waiting.length){
        const {task,resolve,reject}=waiting.shift();active++;
        Promise.resolve().then(task).then(resolve,reject).finally(()=>{active--;drain()});
      }
    }
    return {run:task=>new Promise((resolve,reject)=>{waiting.push({task,resolve,reject});drain()}),get active(){return active},get pending(){return waiting.length}};
  }
  return {createPool};
});
