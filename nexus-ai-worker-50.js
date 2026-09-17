/* NEXUS LOCAL AI // WORKER 50
 * WebLLM stays isolated from the UI. IndexedDB cache is explicit.
 */
let engine=null,loading=null;
const MODEL='Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
async function load(){
 if(engine)return engine;if(loading)return loading;
 loading=import('https://esm.run/@mlc-ai/web-llm').then(async m=>{
   if(!('gpu'in navigator))throw Error('WebGPU no disponible en este dispositivo');
   const appConfig={...m.prebuiltAppConfig,cacheBackend:'indexeddb'};
   engine=await m.CreateMLCEngine(MODEL,{appConfig,initProgressCallback:p=>postMessage({type:'progress',progress:p?.progress||0,text:p?.text||''})});
   return engine;
 }).finally(()=>loading=null);
 return loading;
}
self.onmessage=async e=>{const m=e.data||{};if(m.type==='status'){postMessage({id:m.id,ok:true,ready:!!engine,gpu:'gpu'in navigator});return}if(m.type!=='chat')return;try{const eng=await load();const r=await eng.chat.completions.create({messages:m.messages||[],temperature:m.opts?.temperature??0.15,top_p:m.opts?.topP??0.9,max_tokens:m.opts?.maxTokens||512});postMessage({id:m.id,ok:true,text:r?.choices?.[0]?.message?.content||''})}catch(err){postMessage({id:m.id,ok:false,error:String(err?.message||err)})}};
