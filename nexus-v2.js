(() => {
  'use strict';
  if (window.__NEXUS_V2__) return;
  window.__NEXUS_V2__ = true;

  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let token = localStorage.nexusToken || null;
  let user = null;
  let activeClass = null;
  let socket = null;
  const peers = new Map();
  const transfers = new Map();

  function style(){
    if ($('nexusV2Style')) return;
    const s = document.createElement('style'); s.id='nexusV2Style';
    s.textContent = `
      .nx2bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;padding:10px;border:1px solid var(--line);border-radius:12px;background:#091523}
      .nx2status{font-size:10px;color:var(--muted)} .nx2dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bad);margin-right:5px}.nx2dot.ok{background:var(--ok);box-shadow:0 0 12px #58e38b88}
      .nx2peer{border:1px solid var(--line);border-radius:10px;padding:9px;background:#0a1220;display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:7px}
      .nx2peer small{display:block;color:var(--muted);font-size:9px}.nx2peer button{padding:6px 8px;font-size:10px}
      .nx2drop{border:1px dashed #4b678f;border-radius:12px;padding:13px;text-align:center;color:var(--muted);font-size:11px;margin-top:10px}
      .nx2drop.drag{border-color:var(--a);color:var(--text);background:#102238}.nx2mini{font-size:9px;color:var(--muted)}
    `;
    document.head.appendChild(s);
  }

  async function api(path, opt={}){
    opt.headers = {...(opt.headers||{}), ...(token?{Authorization:'Bearer '+token}:{})};
    const r = await fetch('/api'+path,opt); const text=await r.text(); let j={}; try{j=JSON.parse(text)}catch{}
    if(!r.ok) throw Error(j.error||'Error de servidor'); return j;
  }
  async function refresh(){
    token=localStorage.nexusToken||null; if(!token)return;
    try{user=(await api('/me')).user}catch{return}
    try{const x=await api('/classes'); if(x.classes?.length){
      const id=window.__nexusV2ClassId || x.classes[0].id;
      activeClass=x.classes.find(c=>c.id===id)||x.classes[0];
    }}catch{}
  }
  function findClassFromPage(){
    try{
      const cards=[...document.querySelectorAll('#classes .classitem,#classlist .classitem')];
      if(cards.length && !activeClass) return;
    }catch{}
  }
  function addUI(){
    style();
    const section=$('network'); if(!section || $('nx2bar')) return;
    const panel=section.querySelector('.panel'); if(!panel)return;
    const bar=document.createElement('div');bar.id='nx2bar';bar.className='nx2bar';
    bar.innerHTML=`<button id="nx2Connect" class="primary">⚡ CONECTAR RED V2</button><button id="nx2File">📦 ENVIAR ARCHIVO</button><span id="nx2Status" class="nx2status"><span class="nx2dot"></span>desconectado</span>`;
    panel.insertBefore(bar,panel.firstChild);
    const peerBox=document.createElement('div');peerBox.id='nx2Peers';peerBox.style.marginTop='10px';panel.insertBefore(peerBox,$('networkMap'));
    const drop=document.createElement('div');drop.id='nx2Drop';drop.className='nx2drop';drop.textContent='Arrastrá un archivo aquí para enviarlo a un nodo conectado';panel.appendChild(drop);
    $('nx2Connect').onclick=connect;
    $('nx2File').onclick=()=>pickFile();
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(f)sendToFirst(f)};
    renderPeers();
  }
  function status(text,ok=false){const el=$('nx2Status');if(el)el.innerHTML=`<span class="nx2dot ${ok?'ok':''}"></span>${esc(text)}`}

  function connect(){
    token=localStorage.nexusToken||token;
    if(!token){status('iniciá sesión');return}
    if(socket?.readyState===WebSocket.OPEN){status('Red V2 conectada',true);return}
    socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
    socket.onopen=()=>{socket.send(JSON.stringify({type:'auth',token}));status('autenticando…')};
    socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return};onSignalMessage(m)};
    socket.onclose=()=>{status('red desconectada');for(const p of peers.values())try{p.pc.close()}catch{}peers.clear();renderPeers()};
    socket.onerror=()=>status('error de red');
  }
  function onSignalMessage(m){
    if(m.type==='ready'){status('Red V2 conectada',true);joinClass();return}
    if(m.type==='presence'){renderPresence(m.members||[]);return}
    if(m.type==='signal') rtcSignal(m.from,m.data);
    if(m.type==='member_joined'){renderPresence();}
  }
  async function joinClass(){
    await refresh(); if(!activeClass || !socket || socket.readyState!==1)return;
    window.__nexusV2ClassId=activeClass.id;
    socket.send(JSON.stringify({type:'join_class',classId:activeClass.id}));
  }
  function renderPresence(list){
    if(!list.length && activeClass) list=activeClass.members||[];
    const box=$('nx2Peers');if(!box)return;
    box.innerHTML=`<div class="nx2mini">NODOS DEL AULA · ${list.length}</div>`+list.map(p=>`<div class="nx2peer"><div><b>${esc(p.name)}</b><small>${p.role==='teacher'?'DOCENTE':'ALUMNO'} · ${peers.get(p.id)?.pc?.connectionState||'offline'}</small></div><button onclick="window.NexusV2.connectPeer('${esc(p.id)}')">CONECTAR</button></div>`).join('');
  }
  function renderPeers(){
    if(!activeClass)return; renderPresence(activeClass.members||[]);
  }
  function connectPeer(id){
    if(!socket||socket.readyState!==1){connect();setTimeout(()=>connectPeer(id),700);return}
    if(id===user?.id)return;
    const p=makePeer(id,true); if(p)status('negociando P2P…');
  }
  function makePeer(id,init){
    if(peers.has(id))return peers.get(id);
    if(typeof RTCPeerConnection!=='function'){status('WebRTC no disponible');return null}
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    const p={pc,dc:null};peers.set(id,p);
    pc.onicecandidate=e=>e.candidate&&socket?.send(JSON.stringify({type:'signal',to:id,data:{candidate:e.candidate}}));
    pc.onconnectionstatechange=()=>{renderPresence();if(['failed','closed'].includes(pc.connectionState))peers.delete(id)};
    pc.ondatachannel=e=>setupChannel(id,e.channel);
    if(init){const dc=pc.createDataChannel('nexus-v2',{ordered:true});setupChannel(id,dc);pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket?.send(JSON.stringify({type:'signal',to:id,data:{description:pc.localDescription}}))).catch(()=>{})}
    return p;
  }
  async function rtcSignal(from,d){
    const p=makePeer(from,false);if(!p)return;try{
      if(d.description){await p.pc.setRemoteDescription(d.description);if(d.description.type==='offer'){const a=await p.pc.createAnswer();await p.pc.setLocalDescription(a);socket?.send(JSON.stringify({type:'signal',to:from,data:{description:p.pc.localDescription}}))}}
      else if(d.candidate)await p.pc.addIceCandidate(d.candidate);
    }catch(e){status('falló la negociación P2P')}
  }
  function setupChannel(id,dc){
    const p=peers.get(id);if(!p)return;p.dc=dc;dc.binaryType='arraybuffer';
    dc.onopen=()=>{status('P2P directo · '+peerName(id),true);renderPresence()};dc.onclose=()=>renderPresence();dc.onmessage=e=>receive(id,e.data);
  }
  function peerName(id){return activeClass?.members?.find(x=>x.id===id)?.name||'dispositivo'}
  function pickFile(target){const i=document.createElement('input');i.type='file';i.onchange=()=>i.files[0]&&sendFile(target||firstPeer(),i.files[0]);i.click()}
  function firstPeer(){for(const [id,p] of peers)if(p.dc?.readyState==='open')return id;return null}
  function sendToFirst(f){const id=firstPeer();if(!id){status('conectá primero un nodo');return}sendFile(id,f)}
  async function sha(file){const b=await file.arrayBuffer(),h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  async function sendFile(id,file){
    const dc=peers.get(id)?.dc;if(!dc||dc.readyState!=='open'){status('canal P2P no disponible');return}
    const tid=crypto.randomUUID(),hash=await sha(file);transfers.set(tid,{id:tid,fileName:file.name,size:file.size,sent:0,peerId:id,status:'esperando aceptación',createdAt:Date.now()});
    dc.send(JSON.stringify({type:'nx2-offer',transferId:tid,fileName:file.name,size:file.size,sha256:hash}));toast2('Solicitud enviada a '+peerName(id));
  }
  const incoming=new Map();
  function receive(id,data){
    let m=null;if(typeof data==='string'){try{m=JSON.parse(data)}catch{return}}
    if(m?.type==='nx2-offer'){
      incoming.set(m.transferId,{...m,peerId:id,chunks:[],received:0});
      toast2('Archivo entrante: '+m.fileName+' · revisá Red Nexus V2');
      if(confirm('Red Nexus: ¿aceptar '+m.fileName+' de '+peerName(id)+'?')){
        const x=incoming.get(m.transferId);x.accepted=true;peers.get(id)?.dc?.send(JSON.stringify({type:'nx2-accept',transferId:m.transferId}));
      }else peers.get(id)?.dc?.send(JSON.stringify({type:'nx2-reject',transferId:m.transferId}));
      return;
    }
    if(m?.type==='nx2-accept'){const j=transfers.get(m.transferId);if(j)streamFile(id,j);return}
    if(m?.type==='nx2-reject'){toast2('Transferencia rechazada');return}
    if(m?.type==='nx2-end'){finishIncoming(m.transferId);return}
    const j=[...incoming.values()].find(x=>x.peerId===id&&x.accepted&&!x.done);if(j&&data instanceof ArrayBuffer){j.chunks.push(data);j.received+=data.byteLength}
  }
  async function streamFile(id,j){
    const dc=peers.get(id)?.dc;j.status='enviando';const f=j.file,chunk=64*1024;let off=0;
    while(off<f.size){while(dc.bufferedAmount>4*1024*1024)await sleep(20);const b=await f.slice(off,Math.min(off+chunk,f.size)).arrayBuffer();dc.send(b);off+=b.byteLength;j.sent=off;await sleep(0)}dc.send(JSON.stringify({type:'nx2-end',transferId:j.id}));toast2('Transferencia enviada · '+f.name)
  }
  async function finishIncoming(tid){
    const j=incoming.get(tid);if(!j)return;const blob=new Blob(j.chunks),h=await sha(blob);if(h!==j.sha256){toast2('ERROR: SHA-256 no coincide');return}j.done=true;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=j.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);toast2('✓ Archivo recibido y verificado')
  }
  function toast2(t){if(typeof window.toast==='function')return window.toast(t);let e=$('toast');if(e){e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}}
  window.NexusV2={connect,connectPeer,sendFile,refresh};
  window.addEventListener('storage',()=>{token=localStorage.nexusToken||null;refresh()});
  setInterval(()=>{if(localStorage.nexusToken!==token){token=localStorage.nexusToken||null;refresh()}},1500);
  const boot=async()=>{await refresh();addUI();renderPeers()};
  setTimeout(boot,1200);
  setInterval(()=>{if($('network')?.classList.contains('active')){addUI();renderPeers()}},2500);
})();
