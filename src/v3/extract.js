import {normalizeDocument} from './normalize.js';

const MAX_SOURCE = 25 * 1024 * 1024;
const MAX_CHILDREN = 100;
const MAX_EXPANDED = 50 * 1024 * 1024;
const SUPPORTED = /\.(?:pdf|eml|txt|html?|zip)$/i;
const u16 = (b,p) => b[p] | b[p+1]<<8;
const u32 = (b,p) => (b[p] | b[p+1]<<8 | b[p+2]<<16 | b[p+3]<<24) >>> 0;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unpackZip(bytes) {
  const children=[];
  let p=0, expanded=0;
  // Prefer central directory sizes: streamed ZIPs use a data descriptor after entries.
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
    if(u32(bytes,at)===0x06054b50){end=at;break}
  }
  const central=end>=0?u32(bytes,end+16):-1;
  p=central>=0&&central<bytes.length?central:0;
  while(p+30<=bytes.length && (u32(bytes,p)===0x02014b50 ||
    (central<0 && u32(bytes,p)===0x04034b50))){
    const directory=central>=0;
    const flags=u16(bytes,p+(directory?8:6)),method=u16(bytes,p+(directory?10:8));
    const size=u32(bytes,p+(directory?20:18)),unpacked=u32(bytes,p+(directory?24:22));
    const nameLength=u16(bytes,p+(directory?28:26));
    const extraLength=u16(bytes,p+(directory?30:28));
    const commentLength=directory?u16(bytes,p+32):0;
    const name=new TextDecoder().decode(bytes.slice(p+(directory?46:30),p+(directory?46:30)+nameLength));
    const local=directory?u32(bytes,p+42):p;
    if(u32(bytes,local)!==0x04034b50)throw new Error('ZIP_LOCAL_HEADER_MISSING');
    const start=local+30+u16(bytes,local+26)+u16(bytes,local+28);
    if(flags&1 || (method!==0 && method!==8) || start+size>bytes.length)
      throw new Error('ZIP_UNSUPPORTED_ENTRY');
    if(name && !name.endsWith('/') && SUPPORTED.test(name)) {
      if(++expanded>MAX_CHILDREN || unpacked>MAX_EXPANDED)throw new Error('ZIP_LIMIT_EXCEEDED');
      const data=method===8 ? await inflate(bytes.slice(start,start+size)) : bytes.slice(start,start+size);
      if(data.length!==unpacked)throw new Error('ZIP_SIZE_MISMATCH');
      children.push({filename:name.split('/').pop(),bytes:data});
    }
    p=directory?p+46+nameLength+extraLength+commentLength:start+size;
  }
  if(!children.length)throw new Error('ZIP_NO_SUPPORTED_DOCUMENTS');
  if(children.reduce((n,x)=>n+x.bytes.length,0)>MAX_EXPANDED)throw new Error('ZIP_LIMIT_EXCEEDED');
  return children;
}

export async function extractSource({bytes,filename,mimeType='',adapters={},depth=0}) {
  if(bytes.byteLength>MAX_SOURCE)throw new Error('SOURCE_TOO_LARGE');
  const extension=filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if(extension==='zip') {
    if(depth>1)throw new Error('NESTED_ZIP_LIMIT');
    return {document:normalizeDocument({format:'ZIP',text:'',metadata:{filename}}),
      children:await unpackZip(bytes)};
  }
  if(extension==='eml' || mimeType==='message/rfc822') {
    const parsed=adapters.parseEml?.(new TextDecoder().decode(bytes));
    if(!parsed)throw new Error('EML_ADAPTER_UNAVAILABLE');
    const children=(parsed.attachments||[]).filter(x=>SUPPORTED.test(x.filename||''))
      .map(x=>({filename:x.filename,bytes:x.bytes,mimeType:x.mimeType}));
    return {document:normalizeDocument({format:'EML',text:(parsed.textBodies||[]).join('\n\n'),
      metadata:{filename,headers:parsed.headers||{},attachmentCount:children.length}}),children};
  }
  if(extension==='pdf' || mimeType.includes('pdf')) {
    const result=await adapters.extractPdf?.(bytes);
    if(!result?.readable || !result.text)throw new Error(result?.reason||'PDF_NOT_READABLE');
    return {document:normalizeDocument({format:'PDF',text:result.text,metadata:{filename,reason:result.reason}}),children:[]};
  }
  if(['txt','html','htm'].includes(extension) || mimeType.startsWith('text/')) {
    let text=new TextDecoder().decode(bytes);
    if(['html','htm'].includes(extension) || mimeType.includes('html'))
      text=text.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p\s*>/gi,'\n')
        .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&');
    return {document:normalizeDocument({format:extension.toUpperCase()||'TEXT',text,
      metadata:{filename}}),children:[]};
  }
  throw new Error('UNSUPPORTED_FORMAT');
}
