const fs=require('fs');
const path=require('path');
const index=path.join(__dirname,'index.html');
try{
  let html=fs.readFileSync(index,'utf8');
  const tag='<script src="/nexus-v2.js?v=2"></script>';
  if(!html.includes('/nexus-v2.js')){
    html=html.replace('</body>',tag+'\n</body>');
    fs.writeFileSync(index,html);
  }
}catch(e){console.error('[NEXUS BOOT] No se pudo preparar la interfaz:',e)}
require('./server.js');
