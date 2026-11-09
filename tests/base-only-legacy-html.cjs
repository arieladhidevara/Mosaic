// Test-only page fixture: emulate cached HTML from before the pool script tag.
if(process.env.NODE_ENV==='production'||require('../lib/dev-auth').hosted(process.env))throw Error('Legacy HTML fixture is local-test-only.');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const createServer=http.createServer;
http.createServer=function(listener){
  return createServer.call(this,(req,res)=>{
    if(req.url==='/'||req.url==='/index.html'){
      const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\s*<script src="\.\/generation-pool\.js"><\/script>/,'');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
    }
    return listener(req,res);
  });
};
