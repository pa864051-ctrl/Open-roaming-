require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, maxHttpBufferSize: 1e5, pingInterval: 25000, pingTimeout: 20000 });
const PORT = Number(process.env.PORT || 3000);
const CAPACITY = 100, WORLD_LIMIT = 240;
const lobbies = Array.from({length:10}, (_,i)=>({id:i+1, players:new Set()}));
const players = new Map();
const vehicles = new Map();
const dataDir = path.join(__dirname,'data');
const progressPath = path.join(dataDir,'progress.json');
fs.mkdirSync(dataDir,{recursive:true});
let progress = {};
try { progress = JSON.parse(fs.readFileSync(progressPath,'utf8')); } catch {}
function saveProgress(){ const tmp=progressPath+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(progress)); fs.renameSync(tmp,progressPath); }
function recoveryHash(code){ return crypto.createHmac('sha256', process.env.RECOVERY_PEPPER || 'development-only-change-me').update(String(code)).digest('hex'); }
function safeName(v){ return String(v||'Ranger').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18)||'Ranger'; }
function lobbyCounts(){ return lobbies.map(l=>({id:l.id,count:l.players.size,capacity:CAPACITY})); }
function publicPlayer(p){ return {id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,hp:p.hp,maxHp:100,skin:p.skin,level:p.level,xp:p.xp,coins:p.coins,alive:p.alive,vehicleId:p.vehicleId,action:p.action}; }
function emitCounts(){ io.emit('lobbyCounts',lobbyCounts()); }
function cleanNum(v,lo,hi,def=0){ v=Number(v); return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):def; }
function roomPlayers(lobbyId){return [...(lobbies[lobbyId-1]?.players||[])].map(id=>players.get(id)).filter(Boolean).map(publicPlayer);}
function savePlayer(p){ if(!p.accountKey)return; progress[p.accountKey]={name:p.name,skin:p.skin,level:p.level,xp:p.xp,coins:p.coins,updatedAt:Date.now()}; try{saveProgress()}catch(e){console.error('Progress save failed',e.message)} }
function award(p,xp,coins){p.xp=Math.min(999999,p.xp+xp);p.coins=Math.min(999999,p.coins+coins);while(p.xp>=p.level*100&&p.level<100){p.xp-=p.level*100;p.level++;}savePlayer(p);}
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(req,res)=>res.json({ok:true,players:players.size,lobbies:lobbyCounts()}));
app.get('/api/config',(req,res)=>res.json({capacity:CAPACITY,lobbies:10,worldLimit:WORLD_LIMIT}));

// Simple shared cars; server owns occupancy and accepts bounded driving intents.
for(let i=0;i<8;i++) vehicles.set('car'+(i+1),{id:'car'+(i+1),x:-65+(i%4)*42,z:-45+Math.floor(i/4)*85,yaw:0,speed:0,driver:null});
function sendWorld(lobbyId){io.to('lobby:'+lobbyId).emit('worldState',{players:roomPlayers(lobbyId),vehicles:[...vehicles.values()].map(v=>({id:v.id,x:v.x,z:v.z,yaw:v.yaw,speed:v.speed,driver:v.driver}))});}
setInterval(()=>{for(const l of lobbies)if(l.players.size)sendWorld(l.id)},100);

io.on('connection',socket=>{
 let p=null; const chatTimes=[];
 socket.emit('lobbyCounts',lobbyCounts());
 socket.on('joinWorld',(input={},ack=()=>{})=>{
   if(p){ack({ok:false,error:'Already joined a lobby.'});return;}
   const lobby=lobbies.filter(l=>l.players.size<CAPACITY).sort((a,b)=>a.players.size-b.players.size||a.id-b.id)[0];
   if(!lobby){ack({ok:false,error:'All lobbies are full'});return;}
   const code=String(input.recoveryCode||'').trim(); let accountKey=null, saved=null;
   if(code.length>=8&&code.length<=100){accountKey=recoveryHash(code);saved=progress[accountKey]||null;}
   p={id:socket.id,lobbyId:lobby.id,name:safeName(saved?.name||input.name),x:cleanNum(input.x,-WORLD_LIMIT,WORLD_LIMIT,0),y:0,z:cleanNum(input.z,-WORLD_LIMIT,WORLD_LIMIT,8),yaw:0,hp:100,alive:true,skin:saved?.skin||'ranger',level:saved?.level||1,xp:saved?.xp||0,coins:saved?.coins||0,ammo:12,maxAmmo:12,lastMove:Date.now(),lastShot:0,lastMelee:0,vehicleId:null,action:'idle',accountKey};
   players.set(socket.id,p);lobby.players.add(socket.id);socket.join('lobby:'+lobby.id);
   ack({ok:true,lobbyId:lobby.id,player:publicPlayer(p),vehicles:[...vehicles.values()].map(v=>({id:v.id,x:v.x,z:v.z,yaw:v.yaw,speed:v.speed,driver:v.driver})),recovered:!!saved});
   socket.to('lobby:'+lobby.id).emit('playerJoined',publicPlayer(p));socket.emit('worldState',{players:roomPlayers(lobby.id),vehicles:[...vehicles.values()].map(v=>({id:v.id,x:v.x,z:v.z,yaw:v.yaw,speed:v.speed,driver:v.driver}))});emitCounts();
 });
 socket.on('move',raw=>{
   if(!p||!p.alive||!raw||p.vehicleId)return;
   const now=Date.now(); if(now-p.lastMove<35)return; const dt=Math.min(.12,(now-p.lastMove)/1000);p.lastMove=now;
   const nx=cleanNum(raw.x,-WORLD_LIMIT,WORLD_LIMIT,p.x),nz=cleanNum(raw.z,-WORLD_LIMIT,WORLD_LIMIT,p.z);
   const maxDist=7*dt+0.65; const dx=nx-p.x,dz=nz-p.z,dist=Math.hypot(dx,dz);
   if(dist>maxDist){const k=maxDist/(dist||1);p.x+=dx*k;p.z+=dz*k;}else{p.x=nx;p.z=nz;}
   p.yaw=cleanNum(raw.yaw,-Math.PI*4,Math.PI*4,p.yaw);p.action=['idle','walk','run','jump','swing','shoot','drive'].includes(raw.action)?raw.action:'idle';
 });
 socket.on('chat',raw=>{
   if(!p||typeof raw!=='string')return;const now=Date.now();while(chatTimes.length&&now-chatTimes[0]>5000)chatTimes.shift();if(chatTimes.length>=5)return;
   const message=raw.replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,180);if(!message)return;chatTimes.push(now);io.to('lobby:'+p.lobbyId).emit('chat',{id:p.id,name:p.name,message,at:now});
 });
 socket.on('profileUpdate',raw=>{if(!p||!raw)return;p.name=safeName(raw.name||p.name);const skins=['ranger','ember','frost','shadow','neon'];if(skins.includes(raw.skin)&&(raw.skin==='ranger'||p.level>=({ember:2,frost:4,shadow:6,neon:8}[raw.skin]||1)))p.skin=raw.skin;savePlayer(p);socket.emit('profile',publicPlayer(p));});
 socket.on('attack',raw=>{
   if(!p||!p.alive||!raw||!['sword','pistol'].includes(raw.kind)||p.vehicleId)return;
   const now=Date.now();
   if(raw.kind==='sword'){
     if(now-p.lastMelee<850)return;p.lastMelee=now;p.action='swing';let hits=0;
     for(const target of players.values()){if(target.id===p.id||target.lobbyId!==p.lobbyId||!target.alive)continue;const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);const angle=Math.atan2(dx,dz);let diff=Math.atan2(Math.sin(angle-p.yaw),Math.cos(angle-p.yaw));if(d<2.5&&Math.abs(diff)<1.15){target.hp=Math.max(0,target.hp-25);hits++;if(target.hp===0){target.alive=false;target.action='defeated';p.hp=Math.min(100,p.hp+10);award(p,25,10);setTimeout(()=>respawn(target),4000);}}}
     io.to('lobby:'+p.lobbyId).emit('combatEvent',{attacker:p.id,kind:'sword',hits});
   }else{
     if(now-p.lastShot<450||p.ammo<=0)return;p.lastShot=now;p.ammo--;p.action='shoot';
     const aim=raw.aim&&typeof raw.aim==='object'?{x:cleanNum(raw.aim.x,-1,1,0),z:cleanNum(raw.aim.z,-1,1,1)}:{x:Math.sin(p.yaw),z:Math.cos(p.yaw)};const mag=Math.hypot(aim.x,aim.z)||1;aim.x/=mag;aim.z/=mag;
     let best=null,bestD=28;
     for(const target of players.values()){if(target.id===p.id||target.lobbyId!==p.lobbyId||!target.alive)continue;const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);if(d>bestD||d<.01)continue;const dot=(dx*aim.x+dz*aim.z)/d;if(dot>.965){best=target;bestD=d;}}
     if(best){best.hp=Math.max(0,best.hp-34);if(best.hp===0){best.alive=false;best.action='defeated';award(p,40,15);setTimeout(()=>respawn(best),4000);}}
     socket.emit('ammo',{ammo:p.ammo,maxAmmo:p.maxAmmo});io.to('lobby:'+p.lobbyId).emit('combatEvent',{attacker:p.id,kind:'pistol',target:best?.id||null});
   }
 });
 socket.on('reload',()=>{if(!p||p.vehicleId)return;setTimeout(()=>{if(p&&p.alive){p.ammo=p.maxAmmo;socket.emit('ammo',{ammo:p.ammo,maxAmmo:p.maxAmmo});}},900);});
 socket.on('enterVehicle',id=>{if(!p||!p.alive||p.vehicleId)return;const v=vehicles.get(String(id));if(!v||v.driver)return;if(Math.hypot(p.x-v.x,p.z-v.z)>4)return;v.driver=p.id;p.vehicleId=v.id;p.x=v.x;p.z=v.z;io.to('lobby:'+p.lobbyId).emit('vehicleEvent',{id:v.id,driver:p.id,entered:true});});
 socket.on('drive',raw=>{if(!p||!p.vehicleId||!raw)return;const v=vehicles.get(p.vehicleId);if(!v||v.driver!==p.id)return;const dt=Math.min(.15,Math.max(.01,Number(raw.dt)||.05));v.yaw+=cleanNum(raw.steer,-1,1,0)*1.8*dt;v.speed+=cleanNum(raw.throttle,-1,1,0)*18*dt;v.speed=Math.max(-8,Math.min(24,v.speed));if(raw.brake)v.speed*=Math.pow(.06,dt);const nx=v.x+Math.sin(v.yaw)*v.speed*dt,nz=v.z+Math.cos(v.yaw)*v.speed*dt;if(Math.abs(nx)<WORLD_LIMIT&&Math.abs(nz)<WORLD_LIMIT){v.x=nx;v.z=nz;}p.x=v.x;p.z=v.z;p.yaw=v.yaw;});
 socket.on('exitVehicle',()=>{if(!p||!p.vehicleId)return;const v=vehicles.get(p.vehicleId);if(v&&v.driver===p.id){v.driver=null;v.speed=0;}p.vehicleId=null;p.x+=2;io.to('lobby:'+p.lobbyId).emit('vehicleEvent',{id:v?.id,driver:p.id,entered:false});});
 socket.on('missionComplete',id=>{if(!p||!p.alive||!['explore','hide','drive'].includes(id))return;const key=id+':'+Math.floor(Date.now()/60000);if(p.lastMissionKey===key)return;p.lastMissionKey=key;award(p,10,5);socket.emit('reward',{xp:10,coins:5,mission:id});});
 socket.on('report',raw=>{if(!p||!raw)return;const target=String(raw.id||'').slice(0,40);const reason=String(raw.reason||'other').slice(0,80);fs.appendFile(path.join(dataDir,'reports.log'),JSON.stringify({at:Date.now(),reporter:p.id,target,reason,lobby:p.lobbyId})+'\n',()=>{});socket.emit('notice','Report received. Thank you.');});
 socket.on('disconnect',()=>{if(!p)return;const l=lobbies[p.lobbyId-1];l?.players.delete(p.id);if(p.vehicleId){const v=vehicles.get(p.vehicleId);if(v?.driver===p.id){v.driver=null;v.speed=0;}}savePlayer(p);players.delete(p.id);io.to('lobby:'+p.lobbyId).emit('playerLeft',{id:p.id});emitCounts();});
});
function respawn(p){if(!players.has(p.id))return;p.hp=100;p.alive=true;p.x=0;p.z=8;p.vehicleId=null;p.action='idle';const s=io.sockets.sockets.get(p.id);if(s)s.emit('respawn',publicPlayer(p));}
setInterval(()=>{for(const p of players.values())if(p.accountKey)savePlayer(p)},60000).unref();
server.listen(PORT,process.env.HOST||'0.0.0.0',()=>console.log(`Wildlands Online running at http://localhost:${PORT}`));
