const { io } = require('socket.io-client');
const args=process.argv.slice(2);function arg(name,def){const i=args.indexOf(name);return i>=0?args[i+1]:def}
const url=arg('--url','http://127.0.0.1:3000'),clients=Math.max(1,Math.min(5000,Number(arg('--clients','50')))),duration=Math.max(5,Number(arg('--duration','30')));
let connected=0,joined=0,failed=0,full=0,errors=0,done=0;const sockets=[];const start=Date.now();
console.log(`Starting lobby smoke test: ${clients} clients → ${url}; duration ${duration}s`);
for(let i=0;i<clients;i++){
 const s=io(url,{transports:['websocket'],timeout:15000,reconnection:false});sockets.push(s);
 s.on('connect',()=>{connected++;s.emit('joinWorld',{name:'Load'+i},res=>{if(res?.ok)joined++;else{failed++;if(String(res?.error).includes('full'))full++;}})});
 s.on('connect_error',()=>{errors++;done++});s.on('disconnect',()=>{done++});
}
setTimeout(()=>{console.log('\nResults (smoke test, not a performance certification)');console.log(JSON.stringify({url,requested:clients,connected,joined,joinFailed:failed,fullResponses:full,connectionErrors:errors,elapsedSeconds:Math.round((Date.now()-start)/1000)},null,2));for(const s of sockets)s.disconnect();process.exit(joined===0?1:0)},duration*1000);
