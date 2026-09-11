const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let WebSocket = null;
try { WebSocket = require("ws"); } catch (e) { console.warn("[NEXUS] ws no está instalado; chat/señalización desactivados hasta ejecutar npm install."); }

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DB = path.join(ROOT, "data.json");
const SECRET = process.env.NEXUS_SECRET || "CHANGE_THIS_SECRET_IN_PRODUCTION";
const sessions = new Map();
const sockets = new Map();

const blank = {users:[], classes:[], posts:[], assignments:[], submissions:[], grades:[], attendance:[], materials:[], events:[], messages:[], notifications:[]};
let db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB,"utf8")) : blank;
for (const k of Object.keys(blank)) if (!Array.isArray(db[k])) db[k]=[];

function save(){ fs.writeFileSync(DB, JSON.stringify(db,null,2)); }
function uid(){ return crypto.randomUUID(); }
function now(){ return Date.now(); }
function code(len=6){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s="";
  do { s=""; for(let i=0;i<len;i++) s+=chars[crypto.randomInt(chars.length)]; }
  while(db.classes.some(c=>c.code===s));
  return s;
}
function hashPassword(p,salt=crypto.randomBytes(16).toString("hex")){
  const hash=crypto.scryptSync(String(p),salt,64).toString("hex");
  return {salt,hash};
}
function verifyPassword(p,u){
  if(!u?.passwordHash||!u?.passwordSalt) return false;
  const h=crypto.scryptSync(String(p),u.passwordSalt,64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h,"hex"),Buffer.from(u.passwordHash,"hex"));
}
function safeUser(u){ return u && {id:u.id,name:u.name,email:u.email,role:u.role,createdAt:u.createdAt,avatar:u.avatar||null}; }
function token(userId){
  const raw=uid()+"."+userId+"."+now();
  const sig=crypto.createHmac("sha256",SECRET).update(raw).digest("hex");
  const t=raw+"."+sig;
  sessions.set(t,{userId,expires:now()+7*86400000});
  return t;
}
function auth(req){
  const h=req.headers.authorization||"";
  const t=h.startsWith("Bearer ")?h.slice(7):"";
  const s=sessions.get(t);
  if(!s||s.expires<now()){ if(t)sessions.delete(t); return null; }
  return db.users.find(u=>u.id===s.userId)||null;
}
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let s="";
    req.on("data",d=>{s+=d;if(s.length>2e6) req.destroy();});
    req.on("end",()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});
    req.on("error",reject);
  });
}
function out(res,status,data){
  const b=Buffer.from(JSON.stringify(data));
  res.writeHead(status,{
    "Content-Type":"application/json; charset=utf-8",
    "Content-Length":b.length,
    "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"Content-Type, Authorization",
    "Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS"
  });
  res.end(b);
}
function cls(x){ return db.classes.find(c=>c.id===x)||db.classes.find(c=>c.code===String(x||"").toUpperCase()); }
function members(c){ return c.members.map(id=>safeUser(db.users.find(u=>u.id===id))).filter(Boolean); }
function teacher(u,c){ return !!u&&!!c&&u.id===c.teacherId; }
function member(u,c){ return !!u&&!!c&&c.members.includes(u.id); }
function notify(userId,title,text,type="info",classId=null){
  const n={id:uid(),userId,title,text,type,classId,read:false,createdAt:now()};
  db.notifications.push(n); return n;
}
function broadcastClass(classId,msg,except){
  const c=cls(classId); if(!c)return;
  const raw=JSON.stringify(msg);
  for(const id of c.members){
    if(id===except)continue;
    const ws=sockets.get(id);
    if(ws?.readyState===1)ws.send(raw);
  }
}
function publicClass(c, revealCode=false){
  const x={...c,members:members(c)};
  if(!revealCode) delete x.code;
  return x;
}

async function api(req,res,url){
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS"});return res.end();}
  try{
    if(url==="/api/health"&&req.method==="GET")return out(res,200,{ok:true,service:"red-nexus-classroom",version:"1.1",realtime:!!WebSocket});
    if(url==="/api/register"&&req.method==="POST"){
      const b=await parseBody(req);
      if(!b.name||!b.email||!b.password||String(b.password).length<6)return out(res,400,{error:"Nombre, email y contraseña (mínimo 6 caracteres) son obligatorios."});
      const email=String(b.email).trim().toLowerCase();
      if(db.users.some(u=>u.email===email))return out(res,409,{error:"Ese email ya está registrado."});
      const hp=hashPassword(b.password);
      const u={id:uid(),name:String(b.name).trim().slice(0,60),email,role:b.role==="teacher"?"teacher":"student",passwordHash:hp.hash,passwordSalt:hp.salt,createdAt:now()};
      db.users.push(u);save();return out(res,201,{user:safeUser(u),token:token(u.id)});
    }
    if(url==="/api/login"&&req.method==="POST"){
      const b=await parseBody(req),email=String(b.email||"").trim().toLowerCase(),u=db.users.find(x=>x.email===email);
      if(!u||!verifyPassword(b.password,u))return out(res,401,{error:"Email o contraseña incorrectos."});
      return out(res,200,{user:safeUser(u),token:token(u.id)});
    }

    const u=auth(req); if(!u)return out(res,401,{error:"Sesión requerida."});
    if(url==="/api/me"&&req.method==="GET")return out(res,200,{user:safeUser(u)});

    if(url==="/api/dashboard"&&req.method==="GET"){
      const cs=db.classes.filter(c=>c.members.includes(u.id));
      const as=db.assignments.filter(a=>cs.some(c=>c.id===a.classId));
      const pending=as.filter(a=>u.role==="teacher"?false:!db.submissions.some(s=>s.assignmentId===a.id&&s.studentId===u.id));
      const recent=[
        ...db.posts.filter(p=>cs.some(c=>c.id===p.classId)).map(p=>({kind:"post",at:p.createdAt,text:p.text,classId:p.classId})),
        ...db.assignments.filter(a=>cs.some(c=>c.id===a.classId)).map(a=>({kind:"assignment",at:a.createdAt,text:a.title,classId:a.classId}))
      ].sort((a,b)=>b.at-a.at).slice(0,8);
      return out(res,200,{stats:{classes:cs.length,assignments:as.length,pending:pending.length,students:cs.reduce((n,c)=>n+c.members.length-1,0)},recent});
    }

    if(url==="/api/classes"&&req.method==="GET")return out(res,200,{classes:db.classes.filter(c=>c.members.includes(u.id)).map(c=>publicClass(c,u.id===c.teacherId))});
    if(url==="/api/classes"&&req.method==="POST"){
      if(u.role!=="teacher")return out(res,403,{error:"Solo docentes pueden crear aulas."});
      const b=await parseBody(req);
      const c={id:uid(),code:code(),name:String(b.name||"Aula Nexus").slice(0,80),subject:String(b.subject||"").slice(0,80),description:String(b.description||"").slice(0,500),teacherId:u.id,members:[u.id],createdAt:now(),active:true};
      db.classes.push(c);save();return out(res,201,{class:publicClass(c,true)});
    }
    const cRoute=url.match(/^\/api\/classes\/([^/]+)$/);
    if(cRoute&&req.method==="GET"){
      const c=cls(cRoute[1]);if(!member(u,c))return out(res,404,{error:"Aula no encontrada."});
      return out(res,200,{class:publicClass(c,u.id===c.teacherId)});
    }
    const join=url.match(/^\/api\/classes\/([^/]+)\/join$/);
    if(join&&req.method==="POST"){
      const c=cls(join[1]);if(!c)return out(res,404,{error:"Clave inválida."});
      if(!c.members.includes(u.id)){c.members.push(u.id);notify(c.teacherId,"Nuevo integrante",`${u.name} se unió a ${c.name}`,"info",c.id);save();broadcastClass(c.id,{type:"member_joined",user:safeUser(u)},u.id);}
      return out(res,200,{class:publicClass(c,u.id===c.teacherId)});
    }

    const posts=url.match(/^\/api\/classes\/([^/]+)\/posts$/);
    if(posts){
      const c=cls(posts[1]);if(!member(u,c))return out(res,404,{error:"Aula no encontrada."});
      if(req.method==="GET")return out(res,200,{posts:db.posts.filter(p=>p.classId===c.id).sort((a,b)=>b.createdAt-a.createdAt).map(p=>({...p,author:safeUser(db.users.find(x=>x.id===p.authorId))}))});
      if(req.method==="POST"){const b=await parseBody(req);const p={id:uid(),classId:c.id,authorId:u.id,text:String(b.text||"").slice(0,5000),createdAt:now()};db.posts.push(p);for(const mid of c.members)if(mid!==u.id)notify(mid,"Nuevo anuncio",`${u.name} publicó en ${c.name}`,"post",c.id);save();broadcastClass(c.id,{type:"post",post:{...p,author:safeUser(u)}},u.id);return out(res,201,{post:p});}
    }

    const assignments=url.match(/^\/api\/classes\/([^/]+)\/assignments$/);
    if(assignments){
      const c=cls(assignments[1]);if(!member(u,c))return out(res,404,{error:"Aula no encontrada."});
      if(req.method==="GET"){
        const arr=db.assignments.filter(a=>a.classId===c.id).sort((a,b)=>b.createdAt-a.createdAt).map(a=>({...a,submissions:db.submissions.filter(s=>s.assignmentId===a.id).map(s=>({...s,student:safeUser(db.users.find(x=>x.id===s.studentId)),grade:db.grades.find(g=>g.submissionId===s.id)||null}))}));
        return out(res,200,{assignments:arr});
      }
      if(req.method==="POST"){
        if(!teacher(u,c))return out(res,403,{error:"Solo el docente puede crear actividades."});
        const b=await parseBody(req);const a={id:uid(),classId:c.id,title:String(b.title||"Actividad").slice(0,160),instructions:String(b.instructions||"").slice(0,8000),dueAt:b.dueAt||null,points:Number(b.points||100),createdAt:now()};
        db.assignments.push(a);for(const mid of c.members)if(mid!==u.id)notify(mid,"Nueva actividad",`${a.title} en ${c.name}`,"assignment",c.id);save();broadcastClass(c.id,{type:"assignment",assignment:a},u.id);return out(res,201,{assignment:a});
      }
    }

    const submit=url.match(/^\/api\/assignments\/([^/]+)\/submit$/);
    if(submit&&req.method==="POST"){
      const a=db.assignments.find(x=>x.id===submit[1]);const c=a&&cls(a.classId);if(!a||!member(u,c))return out(res,404,{error:"Actividad no encontrada."});
      if(u.role!=="student")return out(res,403,{error:"Las entregas son para alumnos."});
      const b=await parseBody(req);let s=db.submissions.find(x=>x.assignmentId===a.id&&x.studentId===u.id);
      if(!s){s={id:uid(),assignmentId:a.id,studentId:u.id,createdAt:now()};db.submissions.push(s);}
      Object.assign(s,{fileName:String(b.fileName||"").slice(0,240),fileSize:Number(b.fileSize||0),sha256:String(b.sha256||""),status:"submitted",submittedAt:now(),comment:String(b.comment||"").slice(0,3000)});
      notify(c.teacherId,"Nueva entrega",`${u.name} entregó ${a.title}`,"submission",c.id);save();broadcastClass(c.id,{type:"submission",submission:{...s,student:safeUser(u)}},u.id);return out(res,200,{submission:s});
    }

    const grade=url.match(/^\/api\/submissions\/([^/]+)\/grade$/);
    if(grade&&req.method==="POST"){
      const s=db.submissions.find(x=>x.id===grade[1]),a=s&&db.assignments.find(x=>x.id===s.assignmentId),c=a&&cls(a.classId);
      if(!s||!teacher(u,c))return out(res,403,{error:"No autorizado."});
      const b=await parseBody(req);let g=db.grades.find(x=>x.submissionId===s.id);
      if(!g){g={id:uid(),submissionId:s.id,assignmentId:a.id,studentId:s.studentId};db.grades.push(g)}
      Object.assign(g,{score:Math.max(0,Math.min(Number(b.score||0),a.points)),feedback:String(b.feedback||"").slice(0,5000),gradedAt:now(),graderId:u.id});
      notify(s.studentId,"Actividad calificada",`${a.title}: ${g.score}/${a.points}`,"grade",c.id);save();broadcastClass(c.id,{type:"grade",grade:g},u.id);return out(res,200,{grade:g});
    }

    const attendance=url.match(/^\/api\/classes\/([^/]+)\/attendance$/);
    if(attendance){
      const c=cls(attendance[1]);if(!member(u,c))return out(res,404,{error:"Aula no encontrada."});
      if(req.method==="GET")return out(res,200,{attendance:db.attendance.filter(x=>x.classId===c.id).sort((a,b)=>b.date.localeCompare(a.date))});
      if(req.method==="POST"){
        if(!teacher(u,c))return out(res,403,{error:"Solo el docente puede pasar asistencia."});
        const b=await parseBody(req),date=String(b.date||new Date().toISOString().slice(0,10)),records=Array.isArray(b.records)?b.records:[];
        db.attendance=db.attendance.filter(x=>!(x.classId===c.id&&x.date===date));
        for(const r of records)db.attendance.push({id:uid(),classId:c.id,date,studentId:r.studentId,status:["present","absent","late","excused"].includes(r.status)?r.status:"present",note:String(r.note||"").slice(0,300)});
        save();broadcastClass(c.id,{type:"attendance",date});return out(res,200,{ok:true});
      }
    }

    const mats=url.match(/^\/api\/classes\/([^/]+)\/materials$/);
    if(mats){
      const c=cls(mats[1]);if(!member(u,c))return out(res,404,{error:"Aula no encontrada."});
      if(req.method==="GET")return out(res,200,{materials:db.materials.filter(x=>x.classId===c.id).sort((a,b)=>b.createdAt-a.createdAt)});
      if(req.method==="POST"){
        if(!teacher(u,c))return out(res,403,{error:"Solo el docente puede publicar materiales."});
        const b=await parseBody(req),m={id:uid(),classId:c.id,title:String(b.title||"Material").slice(0,160),description:String(b.description||"").slice(0,1000),fileName:String(b.fileName||"").slice(0,240),fileSize:Number(b.fileSize||0),sha256:String(b.sha256||""),createdAt:now(),peer:true};
        db.materials.push(m);save();broadcastClass(c.id,{type:"material",material:m},u.id);return out(res,201,{material:m});
      }
    }

    const events=url.match(/^\/api\/classes\/([^/]+)\/events$/);
    if(events){
      const c=cls(events[1]);if(!member(u,c))return out(res,404,{error:"Aula no encontrada."});
      if(req.method==="GET")return out(res,200,{events:db.events.filter(x=>x.classId===c.id).sort((a,b)=>String(a.startAt).localeCompare(String(b.startAt)))});
      if(req.method==="POST"){
        if(!teacher(u,c))return out(res,403,{error:"Solo el docente puede crear eventos."});
        const b=await parseBody(req),e={id:uid(),classId:c.id,title:String(b.title||"Evento").slice(0,160),description:String(b.description||"").slice(0,1000),startAt:b.startAt,endAt:b.endAt||null,createdAt:now()};
        db.events.push(e);save();broadcastClass(c.id,{type:"event",event:e},u.id);return out(res,201,{event:e});
      }
    }

    if(url==="/api/notifications"&&req.method==="GET")return out(res,200,{notifications:db.notifications.filter(n=>n.userId===u.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100)});
    const nr=url.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if(nr&&req.method==="POST"){const n=db.notifications.find(x=>x.id===nr[1]&&x.userId===u.id);if(n){n.read=true;save()}return out(res,200,{ok:true});}

    return out(res,404,{error:"Ruta no encontrada."});
  }catch(e){console.error(e);return out(res,500,{error:"Error interno: "+e.message});}
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost").pathname;
  if(url.startsWith("/api/"))return api(req,res,url);
  let p=decodeURIComponent(url);if(p==="/")p="/index.html";
  const f=path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("Not found");}
  const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".svg":"image/svg+xml"};
  res.writeHead(200,{"Content-Type":types[path.extname(f)]||"application/octet-stream","Cache-Control":"no-store"});fs.createReadStream(f).pipe(res);
});

if (WebSocket) {
const wss=new WebSocket.Server({server});
wss.on("connection",ws=>{
  let userId=null;
  ws.on("message",raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.type==="auth"){
      const h=auth({headers:{authorization:"Bearer "+m.token}});
      if(h){userId=h.id;sockets.set(userId,ws);ws.send(JSON.stringify({type:"ready"}))}
      return;
    }
    if(!userId)return;
    if(m.type==="join_class"){const c=cls(m.classId);if(c?.members.includes(userId))ws.send(JSON.stringify({type:"presence",members:members(c)}));return;}
    if(m.type==="network_ready"){
      const c=cls(m.classId),owner=db.users.find(x=>x.id===userId);
      if(c&&owner&&teacher(owner,c))broadcastClass(c.id,{type:"network_ready",classId:c.id},userId);
      return;
    }
    if(m.type==="signal"){const target=sockets.get(m.to);if(target?.readyState===1)target.send(JSON.stringify({type:"signal",from:userId,data:m.data}));return;}
    if(m.type==="chat"){
      const c=cls(m.classId);if(!c?.members.includes(userId))return;
      const msg={id:uid(),classId:c.id,userId,text:String(m.text||"").slice(0,2000),createdAt:now()};
      db.messages.push(msg);save();broadcastClass(c.id,{type:"chat",message:{...msg,user:safeUser(db.users.find(x=>x.id===userId))}},userId);
    }
  });
  ws.on("close",()=>{if(userId&&sockets.get(userId)===ws)sockets.delete(userId)});
});
}
server.listen(PORT,()=>console.log(`RED NEXUS CLASSROOM v1.1 → http://localhost:${PORT}`));
