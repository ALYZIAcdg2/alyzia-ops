import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSource,unpackZip} from '../src/v3/extract.js';
import {resolveIdentity,canonicalDate} from '../src/v3/identity.js';
import {classifyDocument} from '../src/v3/classify.js';
import {consolidateFlight,validateFlight} from '../src/v3/consolidate.js';

const encode=x=>new TextEncoder().encode(x);
const doc=text=>({text});

test('SQ service date and route survive a report timestamp',()=>{
  const identity=resolveIdentity(doc('PDF-VBCPLIST\nSQ337 19AUG2026 CDG-SIN\nLIST OF: PDF-VBCPLIST\nSTD 2235'),
    {flight:'SQ337',date:'2026-08-19',route:'CDG-SIN'});
  assert.equal(identity.serviceDateRaw,'19AUG2026');
  assert.equal(identity.serviceDateInternal,'2026-08-19');
  assert.deepEqual(identity.issues,[]);
  assert.deepEqual(classifyDocument(doc('LIST OF: PDF-VBCPLIST\nSQ337')),{
    types:['MEAL'],title:'PDF-VBCPLIST',confidence:'EXPLICIT',issues:[]});
});

test('date does not silently normalize an ambiguous day or invalid ISO',()=>{
  assert.equal(canonicalDate('19AUG'),'');
  assert.equal(canonicalDate('2026-02-30'),'');
  assert.equal(canonicalDate('19AUG','2026-08-16'),'2026-08-19');
});

test('conflicting flight identity blocks interpretation',()=>{
  const identity=resolveIdentity(doc('BJ511 03/Sep/2026 CDG-TUN'),
    {flight:'VF12',date:'2026-09-03',route:'CDG-TUN'});
  assert.ok(identity.issues.includes('FLIGHT_CONFLICT'));
});

test('a connection flight and report timestamp do not replace the operating flight',()=>{
  const identity=resolveIdentity(doc('Report 16AUG2026\nSQ335 19AUG2026 CDG-SIN\nINBOUND SQ337 18AUG2026 LHR-CDG'),
    {flight:'SQ335',date:'2026-08-19',route:'CDG-SIN'});
  assert.equal(identity.flightNumber,'SQ335');
  assert.equal(identity.serviceDateInternal,'2026-08-19');
  assert.deepEqual(identity.issues,[]);
});

test('a passenger surname with a hyphen is not a flight route',()=>{
  const identity=resolveIdentity(doc('SQ337 19AUG2026\nLIST OF: INF J1 S0 Y3 TOTAL 4\n1.LEE-MEI INF'),
    {flight:'SQ337',date:'2026-08-19',route:'CDG-SIN'});
  assert.equal(identity.route,'CDG-SIN');
  assert.deepEqual(identity.issues,[]);
  assert.deepEqual(classifyDocument(doc('LIST OF: INF J1 S0 Y3 TOTAL 4')).types,['INF']);
});

test('SQ cabin count J25 is not flight J2 5',()=>{
  const id=resolveIdentity(doc('Generic Report\nLIST OF: PDF-VBCPLIST, CC-J J25 S0 Y0\nSQ337 19AUG CDG-SIN'),
    {flight:'SQ337',date:'2026-08-19',route:'CDG-SIN',receivedAt:'2026-08-16'});
  assert.equal(id.flightNumber,'SQ337');
  assert.ok(!id.issues.includes('FLIGHT_CONFLICT'));
  assert.deepEqual(classifyDocument(doc('LIST OF: PDF-OSPLMAAS J0 S0 Y3')).types,['SSR']);
});

test('FQA and combined ONC/INC classify by explicit title',()=>{
  assert.deepEqual(classifyDocument(doc('LIST OF: FQA\nSQ335')).types,['FQTV']);
  assert.deepEqual(classifyDocument(doc('LIST OF: ONC + INC\nSQ335')).types,['INBOUND','OUTBOUND']);
});

test('ambiguous header cannot silently become multiple cards',()=>{
  assert.ok(classifyDocument(doc('SSR FQTV report SQ335')).issues.includes('CLASSIFICATION_AMBIGUOUS'));
});

test('TXT, EML, HTML and PDF have separate extraction paths',async()=>{
  const adapters={parseEml:()=>({headers:{subject:'SQ335'},textBodies:['SQ335 20AUG2026 CDG-SIN'],attachments:[]}),
    extractPdf:async()=>({readable:true,text:'BJ511 03SEP2026 CDG-TUN',reason:'PDF_OK'})};
  for(const [filename,content,expected] of [
    ['prepa.txt','SQ335 20AUG2026 CDG-SIN','TXT'],
    ['prepa.eml','Subject: SQ335','EML'],
    ['prepa.html','<p>SQ335 20AUG2026 CDG-SIN</p>','HTML'],
    ['prepa.pdf','%PDF-1.4','PDF']]){
    const result=await extractSource({bytes:encode(content),filename,adapters});
    assert.equal(result.document.format,expected);
    assert.ok(result.document.text.length);
  }
});

test('ZIP extracts a stored TXT child with its own filename',async()=>{
  const name=encode('report.txt'),body=encode('SQ335 20AUG2026 CDG-SIN');
  const zip=new Uint8Array(30+name.length+body.length),view=new DataView(zip.buffer);
  view.setUint32(0,0x04034b50,true);view.setUint32(18,body.length,true);
  view.setUint32(22,body.length,true);view.setUint16(26,name.length,true);
  zip.set(name,30);zip.set(body,30+name.length);
  const children=await unpackZip(zip);
  assert.equal(children.length,1);
  assert.equal(children[0].filename,'report.txt');
  assert.deepEqual(children[0].bytes,body);
});

test('ZIP central directory handles streamed-entry size descriptors',async()=>{
  const name=encode('list.txt'),body=encode('BJ511 03SEP2026 CDG-TUN');
  const central=30+name.length+body.length;
  const bytes=new Uint8Array(central+46+name.length+22);
  const view=new DataView(bytes.buffer);
  view.setUint32(0,0x04034b50,true);view.setUint16(6,8,true);
  view.setUint16(26,name.length,true);bytes.set(name,30);bytes.set(body,30+name.length);
  view.setUint32(central,0x02014b50,true);view.setUint16(central+8,8,true);
  view.setUint32(central+20,body.length,true);view.setUint32(central+24,body.length,true);
  view.setUint16(central+28,name.length,true);bytes.set(name,central+46);
  const end=central+46+name.length;
  view.setUint32(end,0x06054b50,true);view.setUint16(end+10,1,true);
  view.setUint32(end+12,46+name.length,true);view.setUint32(end+16,central,true);
  assert.deepEqual((await unpackZip(bytes))[0].bytes,body);
});

test('consolidator dedupes passenger and validator blocks inconsistent master',()=>{
  const identity={key:'2026-08-20|SQ|SQ335',route:'CDG-SIN',issues:[]};
  const decisions=[{sourceId:'a',identity,interpreter:{cards:[{type:'MASTER',passengerCount:2,
    passengerItems:[{name:'DOE/JOHN',seat:'12A',ssr:['WCHR']}],classCounts:{J:2}}]}},
  {sourceId:'b',identity,interpreter:{cards:[{type:'SSR',passengerCount:1,
    passengerItems:[{name:'DOE/JOHN',seat:'12A',ssr:['MAAS']}]}]}}];
  const batch=consolidateFlight(decisions);
  assert.equal(batch.passengers.length,1);
  assert.deepEqual(batch.passengers[0].ssr,['WCHR','MAAS']);
  assert.ok(validateFlight(batch).blocking.includes('MASTER_COUNT_MISMATCH'));
});
