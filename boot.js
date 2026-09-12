const fs=require('fs');
const path=require('path');
const index=path.join(__dirname,'index.html');
try{
  let html=fs.readFileSync(index,'utf8');
  const tags=[
    '<script src="/nexus-v2.js?v=2"></script>',
    '<script src="/nexus-local-ai.js?v=1" defer></script>'
  ];
  for(const tag of tags){
    const src=tag.match(/src="([^"]+)/)?.[1];
    if(src && !html.includes(src)) html=html.replace('</body>',tag+'\n</body>');
  }
  fs.writeFileSync(index,html);
}catch(e){console.error('[NEXUS BOOT] No se pudo preparar la interfaz:',e)}
require('./server.js');
