/* NEXUS 40 AI worker: optional WebLLM, never required for core classroom operation. */
let engine=null,loading=null;
const MODEL='Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
async function load(){
 if(engine)return engine;if(loading)return loading;
 loading=import('https://esm.run/@mlc-ai/web-llm').then(async m=>{
   if(!('gpu'in navigator))throw Error('WebGPU no disponible');
   engine=await m.CreateMLCEngine(MODEL,{initProgressCallback:p=>postMessage({type:'progress',progress:p?.progress||0,text:p?.text||''})});return engine;
 }).finally(()=>loading=null);return loading;
}
self.onmessage=async e=>{const m=e.data||{};if(m.type!=='chat')return;try{const eng=await load();const r=await eng.chat.completions.create({messages:m.messages||[],temperature:m.opts?.temperature??0.15,top_p:.9,max_tokens:m.opts?.maxTokens||512});postMessage({id:m.id,ok:true,text:r?.choices?.[0]?.message?.content||''})}catch(err){postMessage({id:m.id,ok:false,error:String(err?.message||err)})}};
