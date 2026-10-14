import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {risk,date,DEFAULT_SETTINGS,today} from '../domain.mjs';

test('calendar deadline boundaries, timezone and completion',()=>{
 const now=new Date('2026-10-10T20:00:00Z');
 assert.equal(today('Asia/Dhaka',now),'2026-10-11');
 for(const[d,c]of [['2026-10-10','red'],['2026-10-13','red'],['2026-10-14','amber'],['2026-10-16','amber'],['2026-10-17','green']])assert.equal(risk({dueDate:d},DEFAULT_SETTINGS,now).colour,c);
 assert.equal(risk({dueDate:'2026-10-01',completedAt:'2026-10-02'},DEFAULT_SETTINGS,now).colour,'completed');
 assert.throws(()=>date('2026-02-30'),/valid calendar/);assert.throws(()=>date('2026-99-99'),/valid calendar/);
});

test('shared workflow, permissions, stale edits, attachments, backup and durable storage',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fazil-tests-'));let app=createApp({dataDir:dir,demo:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${app.server.address().port}`;
 const request=async(user,route,method='GET',payload,extra={})=>{const headers={...extra};if(user){headers.Cookie=user.cookie;headers['X-CSRF-Token']=user.csrf;}if(payload!==undefined){headers['Content-Type']=Buffer.isBuffer(payload)?'application/octet-stream':'application/json';}const res=await fetch(base+route,{method,headers,body:payload===undefined?undefined:Buffer.isBuffer(payload)?payload:JSON.stringify(payload)});const ct=res.headers.get('content-type')||'';return {status:res.status,data:ct.includes('application/json')?await res.json():await res.text(),res};};
 const login=async username=>{const r=await request(null,'/api/login','POST',{username,password:'Fazil-Demo-2026!'});assert.equal(r.status,200);return {cookie:r.res.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf};};
 try{
  assert.equal((await request(null,'/api/samples')).status,401);
  const admin=await login('admin'),room=await login('room'),merch=await login('merch'),manager=await login('manager');
  assert.equal((await request({...admin,csrf:'bad'},'/api/settings','PATCH',DEFAULT_SETTINGS)).status,403);
  assert.equal((await request(room,'/api/settings','PATCH',DEFAULT_SETTINGS)).status,403);
  assert.equal((await request(admin,'/api/settings','PATCH',DEFAULT_SETTINGS,{Origin:'https://untrusted.invalid'})).status,403);
  let samples=(await request(admin,'/api/samples')).data;assert.equal(samples.length,4);
  const input={...samples[0],id:undefined,style:'TEST-123',workStatus:'queued',dueDate:'2026-12-12',submissionDate:'2026-12-16',specification:'Approved test specification',materials:[{id:'fabric-test',kind:'fabric',name:'Test linen',status:'received',expectedDate:'2026-12-01',receivedDate:'2026-12-01'}]};
  assert.equal((await request(room,'/api/samples','POST',input)).status,403);
  let r=await request(merch,'/api/samples','POST',input);assert.equal(r.status,201,JSON.stringify(r.data));let s=r.data;const id=s.id;
  assert.equal((await request(manager,`/api/samples/${id}/complete`,'POST',{version:s.version})).status,400);
  assert.equal((await request(room,`/api/samples/${id}`,'PUT',{...s,colour:'Not authorised',reason:'Change'})).status,403);
  assert.equal((await request(room,`/api/samples/${id}`,'PUT',{...s,workStatus:'in_progress'})).status,400);
  r=await request(room,`/api/samples/${id}/acknowledge`,'POST',{version:s.version});assert.equal(r.status,200);const stale=s;s=r.data;
  assert.equal((await request(merch,`/api/samples/${id}`,'PUT',{...stale,specification:'Stale update',reason:'A reason'})).status,409);
  r=await request(room,`/api/samples/${id}`,'PUT',{...s,workStatus:'ready'});assert.equal(r.status,200,JSON.stringify(r.data));s=r.data;
  assert.equal((await request(merch,`/api/samples/${id}/complete`,'POST',{version:s.version})).status,403);
  r=await request(manager,`/api/samples/${id}/complete`,'POST',{version:s.version});assert.equal(r.status,200);s=r.data;assert.equal(s.risk.colour,'completed');
  assert.equal((await request(admin,`/api/samples/${id}`,'PUT',s)).status,409);
  r=await request(manager,`/api/samples/${id}/reopen`,'POST',{version:s.version,reason:'Buyer requested a revised fit'});assert.equal(r.status,200);s=r.data;
  r=await request(merch,`/api/samples/${id}`,'PUT',{...s,specification:'Revised instruction',reason:'Buyer changed the specification',workStatus:'queued'});assert.equal(r.status,200);s=r.data;assert.ok(s.ackVersion<s.specVersion);
  const specBefore=s.specVersion;
  r=await request(merch,`/api/samples/${id}/attachments`,'POST',Buffer.from('%PDF-1.4\nTest attachment'),{'X-File-Name':encodeURIComponent('test-spec.pdf'),'X-Sample-Version':String(s.version)});assert.equal(r.status,201,JSON.stringify(r.data));
  const attachmentId=r.data.id;assert.equal((await request(null,'/api/attachments/'+attachmentId)).status,401);assert.equal((await request(room,'/api/attachments/'+attachmentId)).status,200);
  let detail=(await request(room,`/api/samples/${id}`)).data;assert.equal(detail.sample.specVersion,specBefore+1);assert.equal(detail.attachments.length,1);assert.ok(detail.activity.some(a=>a.kind==='completed'));assert.ok(detail.activity.some(a=>a.kind==='reopened'));
  assert.equal((await request(room,`/api/samples/${id}/comments`,'POST',{body:'Blocked because the sample needs re-cutting.'})).status,201);
  const live=await fetch(base+'/api/events',{headers:{Cookie:admin.cookie}});const reader=live.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
  await request(room,`/api/samples/${id}/comments`,'POST',{body:'Live update test.'});assert.match(new TextDecoder().decode((await reader.read()).value),/changed/);await reader.cancel();
  const exported=await request(admin,'/api/export');assert.equal(exported.status,200);assert.match(exported.data,/TEST-123/);
  r=await request(admin,'/api/backup','POST',{});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(existsSync(path.join(dir,'backups',r.data.name)));
  await request(admin,'/api/users/4','PATCH',{active:false});assert.equal((await request(room,'/api/samples')).status,401);
  await app.close();app=createApp({dataDir:dir,demo:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;const after=await login('admin');assert.ok((await request(after,'/api/samples')).data.some(x=>x.style==='TEST-123'));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('production setup has no default account and setup key works once',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fazil-setup-'));const app=createApp({dataDir:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 try{const initial=await(await fetch(base+'/api/status')).json();assert.equal(initial.setupRequired,true);const payload={setupKey:app.setupKey,username:'owner',name:'Owner',password:'Long-production-password'};const first=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(first.status,201);const second=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,username:'owner2'})});assert.equal(second.status,409);assert.equal(existsSync(path.join(dir,'first-run.txt')),false);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
