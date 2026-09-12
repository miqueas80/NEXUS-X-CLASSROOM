/* NEXUS LOCAL AI v1
   Local-first educational assistant. No question is sent anywhere by this module.
   WebLLM is optional: it is loaded only after the user presses PREPARAR IA LOCAL.
*/
(()=>{
  'use strict';
  const DB='NEXUS_CLASSROOM_AI', VER=1, STORE='documents';
  const MODEL='Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
  const CDN='https://esm.run/@mlc-ai/web-llm';
  let classId=null, engine=null, webllm=null, loading=false;
  const $=id=>document.getElementById(id);
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dbp=()=>new Promise((res,rej)=>{const r=indexedDB.open(DB,VER);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  async function put(doc){const db=await dbp();return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(doc);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
  async function all(){const db=await dbp();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
  function tokenize(s){return (String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9áéíóúñü]{2,}/gi)||[]).filter(x=>!STOP.has(x))}
  const STOP=new Set('de la el los las un una unos unas y o en por para con sin que del al es son fue fue se su sus como sobre entre desde hasta este esta estos estas eso esto más mas muy ya no sí si lo le les me mi tu tus qué que cuál cual cuáles cuales cómo como dónde donde cuando porqué porque'.split(' '));
  function chunks(text,size=1200,overlap=180){let out=[];text=String(text||'').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').trim();for(let i=0;i<text.length;i+=size-overlap){const x=text.slice(i,i+size).trim();if(x.length>40)out.push(x);if(i+size>=text.length)break}return out}
  function score(q,t){const a=new Set(tokenize(q)),b=tokenize(t);let n=0;for(const x of b)if(a.has(x))n++;return n/(Math.sqrt(a.size*b.length)||1)}
  async function extract(file){
    const name=file.name.toLowerCase();
    if(/\.(txt|md|csv|json|html?|xml|log)$/i.test(name)) return await file.text();
    if(name.endsWith('.pdf')) throw new Error('PDF: importalo como texto o usá la opción PDF cuando el lector local esté disponible.');
    throw new Error('Formato no soportado por el lector local. Usá TXT, MD, CSV, JSON o HTML.');
  }
  async function indexFile(file,meta={}){
    const text=await extract(file); if(!text.trim()) throw new Error('El archivo no contiene texto utilizable.');
    const cs=chunks(text); const base=meta.classId||classId||'global';
    await put({id:crypto.randomUUID(),classId:base,title:meta.title||file.name,description:meta.description||'',fileName:file.name,size:file.size,updatedAt:Date.now(),chunks:cs});
    updateStatus(); return true;
  }
  async function retrieve(question,limit=5){
    const docs=await all(); const pool=[];
    for(const d of docs)if(!classId||d.classId===classId||d.classId==='global')for(let i=0;i<d.chunks.length;i++)pool.push({text:d.chunks[i],title:d.title,fileName:d.fileName,index:i,score:score(question,d.chunks[i])});
    return pool.filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
  }
  function renderSources(src){
    const el=$('nexusAISources'); if(!el)return;
    el.textContent=src.length?'Fuentes locales: '+src.map(x=>`${x.title} · fragmento ${x.index+1}`).join(' · '):'Sin coincidencias en el material local.';
  }
  function groundedPrompt(q,src){
    const context=src.map((x,i)=>`[FUENTE ${i+1}: ${x.title}]\n${x.text}`).join('\n\n');
    return `Sos NEXUS LOCAL AI, asistente educativo offline. Respondé en español. REGLA ABSOLUTA: usá exclusivamente el CONTEXTO proporcionado. Si el contexto no alcanza para responder, decí exactamente que no hay información suficiente en el material local. No inventes datos, fechas, nombres ni explicaciones externas. Sé claro y pedagógico.\n\nCONTEXTO:\n${context}\n\nPREGUNTA:\n${q}`;
  }
  async function localModelAnswer(q,src){
    if(!engine)return null;
    const r=await engine.chat.completions.create({messages:[
      {role:'system',content:'Sos un asistente educativo estrictamente fundamentado en documentos. No uses conocimiento externo al contexto. Si falta evidencia, reconocelo.'},
      {role:'user',content:groundedPrompt(q,src)}
    ],temperature:0.15,top_p:0.85,max_tokens:350});
    return r?.choices?.[0]?.message?.content?.trim()||null;
  }
  function retrievalAnswer(q,src){
    if(!src.length)return 'No encuentro información suficiente en el material local del aula. Importá el material primero.';
    const best=src[0];
    return `Encontré información relacionada en «${best.title}»:\n\n${best.text}\n\n— Modo de recuperación local: no se generó información fuera del material.`;
  }
  async function ask(){
    const q=$('nexusAIQuestion')?.value.trim(); if(!q)return;
    const ans=$('nexusAIAnswer'); if(ans)ans.textContent='Buscando evidencia local…';
    try{
      const src=await retrieve(q);renderSources(src);
      if(!src.length){ans.textContent='No hay evidencia suficiente en los materiales disponibles en este dispositivo.';return}
      let out=null;
      if(engine){ans.textContent='IA LOCAL · generando…';out=await localModelAnswer(q,src)}
      ans.textContent=out||retrievalAnswer(q,src);
    }catch(e){ans.textContent='IA local: '+(e.message||'error inesperado');}
  }
  async function prepare(){
    if(loading)return;
    if(!('gpu' in navigator)){setStatus('WebGPU no disponible · recuperación local activa');return}
    loading=true;setStatus('Cargando motor local…');$('nexusAIPrepare').disabled=true;
    try{
      webllm=await import(CDN);
      engine=await webllm.CreateMLCEngine(MODEL,{initProgressCallback:p=>{const pct=Math.round((p?.progress||0)*100);setStatus(`IA local · preparando modelo ${pct}%`)}});
      setStatus('IA LOCAL lista · modelo en caché del dispositivo');$('nexusAIMode').textContent='IA LOCAL';
    }catch(e){engine=null;setStatus('No se pudo preparar el modelo · modo recuperación local disponible');$('nexusAIMode').textContent='RAG LOCAL';console.error(e)}
    finally{loading=false;$('nexusAIPrepare').disabled=false;updateStatus()}
  }
  async function updateStatus(){try{const docs=await all();const n=docs.filter(d=>!classId||d.classId===classId||d.classId==='global').length;const hasGPU='gpu' in navigator;const el=$('nexusAIStatus');if(el)el.textContent=engine?`IA local lista · ${n} material(es) indexado(s)`:hasGPU?`WebGPU disponible · ${n} material(es) local(es) · prepará la IA cuando tengas Wi‑Fi`:`Modo recuperación local · ${n} material(es) indexado(s)`}catch{}}
  function setStatus(t){const el=$('nexusAIStatus');if(el)el.textContent=t}
  function inject(){
    if(document.getElementById('nexusLocalAIPanel')) return;
    const sec=document.getElementById('class'); if(!sec)return;
    const style=document.createElement('style'); style.textContent='.nexus-ai-panel{margin-top:13px}.nexus-ai-panel textarea{width:100%;padding:11px;background:#080e19;border:1px solid #263753;border-radius:10px;color:#edf4ff;resize:vertical}.nexus-ai-panel .air{display:flex;gap:7px;flex-wrap:wrap}.nexus-ai-panel .air button{flex:1;min-width:145px}.nexus-ai-panel .aib{white-space:pre-wrap;line-height:1.55;max-height:300px;overflow:auto}.nexus-ai-panel .aitag{font-size:9px;padding:5px 7px;border-radius:999px;background:#133021;color:#58e38b}'; document.head.appendChild(style);
    const box=document.createElement('div'); box.id='nexusLocalAIPanel'; box.className='panel nexus-ai-panel';
    box.innerHTML='<div style="display:flex;justify-content:space-between;gap:10px"><div><h3 style="margin:0 0 5px">NEXUS LOCAL AI</h3><div id="nexusAIStatus" style="color:#8fa1bd;font-size:11px">Preparando motor local…</div></div><span id="nexusAIMode" class="aitag">LOCAL</span></div><div id="nexusAIAnswer" class="notice aib" style="min-height:72px;margin-top:10px">La IA responderá únicamente usando material disponible en este dispositivo.</div><textarea id="nexusAIQuestion" style="margin-top:9px;min-height:82px" placeholder="Preguntale algo sobre el material del aula…"></textarea><div class="air" style="margin-top:9px"><button id="nexusAIAsk" class="primary">PREGUNTAR</button><button id="nexusAIPrepare">PREPARAR IA LOCAL</button><button id="nexusAIImport">IMPORTAR MATERIAL</button></div><input id="nexusAIFile" type="file" accept=".txt,.md,.csv,.json,.html,.htm,.xml,.log,text/plain,text/markdown,text/csv,application/json,text/html" hidden><div id="nexusAISources" style="color:#8fa1bd;font-size:10px;margin-top:9px"></div>';
    sec.appendChild(box);
  }
  function mount(opts={}){classId=opts.classId||classId;inject();setTimeout(updateStatus,0)}
  async function importClick(){const f=$('nexusAIFile');if(!f)return;f.value='';f.onchange=async()=>{const file=f.files?.[0];if(!file)return;try{await indexFile(file,{classId});$('nexusAIAnswer').textContent=`Material «${file.name}» indexado en este dispositivo. Ya podés preguntarle sobre él.`;updateStatus()}catch(e){$('nexusAIAnswer').textContent=e.message}};f.click()}
  function bind(){
    $('nexusAIAsk')?.addEventListener('click',ask); $('nexusAIPrepare')?.addEventListener('click',prepare); $('nexusAIImport')?.addEventListener('click',importClick);
    $('nexusAIQuestion')?.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')ask()});
    const mf=$('mmFile'); if(mf&&!mf.dataset.aiBound){mf.dataset.aiBound='1';mf.addEventListener('change',async()=>{const f=mf.files?.[0];if(f)try{await indexFile(f,{classId})}catch{}})}
  }
  window.NexusLocalAI={mount,indexFile,ask,prepare,updateStatus};
  document.addEventListener('DOMContentLoaded',()=>{
    const hook=()=>{try{if(window.Nexus?.open&&!window.Nexus.open.__aiHook){const original=window.Nexus.open;const wrapped=async id=>{classId=id;const r=await original(id);setTimeout(()=>{mount({classId:id});bind()},80);return r};wrapped.__aiHook=true;window.Nexus.open=wrapped}}catch{}};
    const timer=setInterval(()=>{hook();if(document.getElementById('class')?.classList.contains('active')){mount({classId});bind()}},3000); setTimeout(()=>clearInterval(timer),60000); hook(); updateStatus();
  });
})();
