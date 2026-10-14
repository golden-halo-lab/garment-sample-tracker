import http from 'node:http';
import {DatabaseSync,backup} from 'node:sqlite';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROLES,DEFAULT_SETTINGS,fail,text,enumValue,normaliseSample,specSignature,risk,insights,today} from './domain.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const sha=s=>createHash('sha256').update(s).digest('hex');
const hashPassword=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const verifyPassword=(p,hash)=>{const [s,h]=hash.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(h,'hex'));};
const iso=()=>new Date().toISOString();
const safeUser=u=>({id:u.id,name:u.name,username:u.username,role:u.role,active:!!u.active});
function password(p){return text(p,200,true).length>=12?p:fail('Use a password of at least 12 characters.');}

export function createApp({dataDir=process.env.FAZIL_DATA_DIR||path.join(ROOT,'data'),demo=false,secureCookies=process.env.FAZIL_SECURE_COOKIES==='1',publicOrigin=process.env.FAZIL_PUBLIC_ORIGIN||''}={}){
 mkdirSync(dataDir,{recursive:true});mkdirSync(path.join(dataDir,'attachments'),{recursive:true});
 const db=new DatabaseSync(path.join(dataDir,'samples.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,spec_version INTEGER NOT NULL DEFAULT 1,ack_version INTEGER NOT NULL DEFAULT 0,ack_by INTEGER REFERENCES users(id),ack_at TEXT,completed_at TEXT,completed_by INTEGER REFERENCES users(id),payload TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,sample_id INTEGER REFERENCES samples(id),user_id INTEGER REFERENCES users(id),kind TEXT NOT NULL,body TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,sample_id INTEGER REFERENCES samples(id),user_id INTEGER REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS activity_sample ON activity(sample_id,id);`);
 db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(DEFAULT_SETTINGS));
 const getSettings=()=>JSON.parse(db.prepare('SELECT payload FROM settings WHERE id=1').get().payload);
 let setupKey='';
 if(!db.prepare('SELECT id FROM users LIMIT 1').get()){
  if(demo){for(const [name,username,role] of [['Demo administrator','admin','admin'],['Account manager','manager','manager'],['Merchandiser','merch','merchandiser'],['Sample room','room','sample_room']])db.prepare('INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)').run(name,username,hashPassword('Fazil-Demo-2026!'),role);}
  else{setupKey=randomBytes(24).toString('hex');writeFileSync(path.join(dataDir,'first-run.txt'),`One-time setup key: ${setupKey}\nOpen the application to create the administrator account.\n`,{mode:0o600});}
 }
 const streams=new Set();const rate=new Map();
 const broadcast=()=>{for(const c of streams)c.res.write('event: changed\ndata: {}\n\n');};
 const rowToSample=r=>{if(!r)return null;const s={...JSON.parse(r.payload),id:r.id,version:r.version,specVersion:r.spec_version,ackVersion:r.ack_version,ackBy:r.ack_by,ackAt:r.ack_at,completedAt:r.completed_at,completedBy:r.completed_by,createdAt:r.created_at,updatedAt:r.updated_at};return {...s,risk:risk(s,getSettings()),insights:insights(s,getSettings())};};
 const getSample=id=>rowToSample(db.prepare('SELECT * FROM samples WHERE id=?').get(id));
 const audit=(sample,user,kind,body,before=null,after=null)=>db.prepare('INSERT INTO activity(sample_id,user_id,kind,body,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)').run(sample,user,kind,body,before?JSON.stringify(before):null,after?JSON.stringify(after):null,iso());
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const checkVersion=(sample,version)=>{if(!Number.isInteger(version)||sample.version!==version)fail('Someone changed this record. Reload it before saving so their update is preserved.',409);};
 const checkOwner=p=>{if(!p.ownerId||!db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('admin','manager','merchandiser')").get(p.ownerId))fail('Choose an active owner.');if(p.previousSampleId&&!getSample(p.previousSampleId))fail('The linked previous sample does not exist.');};
 const managers=u=>['admin','manager'].includes(u.role);
 const canEdit=u=>u.role!=='sample_room';
 function addSample(payload,user){const p=normaliseSample(payload);checkOwner(p);const at=iso();return transaction(()=>{const r=db.prepare('INSERT INTO samples(payload,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?)').run(JSON.stringify(p),at,at,user.id,user.id);const s=getSample(Number(r.lastInsertRowid));audit(s.id,user.id,'created','Created sample',null,s);return s;});}
 if(demo&&!db.prepare('SELECT id FROM samples LIMIT 1').get()){
  const days=n=>{const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  for(const [i,cust,style,col,stage,n,work] of [[0,'Northline Studio','NL-2408','Natural linen','Development',1,'blocked'],[1,'Harbour & Field','HF-1132','Midnight navy','Fit',4,'in_progress'],[2,'Elm House','EH-0917','Ecru','Pre-production',9,'queued'],[3,'Northline Studio','NL-2411','Olive','Development',-1,'ready']]){
   const s=addSample({customer:cust,department:i===1?'Menswear':'Womenswear',style,colour:col,sizes:i===2?'XS, S, M, L, XL':'M',stage,dueDate:days(n),submissionDate:days(n+3),ownerId:2,workStatus:work,specification:'Demonstration record. Replace with an approved customer tech pack before production.',materials:[{id:randomUUID(),kind:'fabric',name:i===0?'100% linen, 180 gsm':'Approved fabric — colour as specified',status:i===0?'in_transit':'received',expectedDate:days(i===0?1:-2),receivedDate:i===0?'':days(-1)},{id:randomUUID(),kind:'accessory',name:'Approved buttons and matching thread',status:i===0?'ordered':'received',expectedDate:days(i===0?2:-2),receivedDate:i===0?'':days(-1)}]},{id:1});
   if(i===1||i===3)db.prepare('UPDATE samples SET ack_version=1,ack_by=4,ack_at=? WHERE id=?').run(iso(),s.id);
  }
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost');const route=url.pathname;
   const method=req.method||'GET';
   if(route.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
   const rawCookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('fz_session='))?.slice(11);
   const session=rawCookie?db.prepare('SELECT s.*,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires>? AND active=1').get(sha(rawCookie),Date.now()):null;
   const requireUser=()=>session||fail('Please sign in.',401);
   const mutating=!['GET','HEAD','OPTIONS'].includes(method);
   if(mutating&&route.startsWith('/api/')){
    const expected=publicOrigin||`${secureCookies?'https':'http'}://${req.headers.host}`;
    if(req.headers.origin&&req.headers.origin!==expected)fail('Request origin is not permitted.',403);
    if(!req.headers['content-type'])fail('Content type is required.');
    if(session&&!['/api/login','/api/setup'].includes(route)&&req.headers['x-csrf-token']!==session.csrf)fail('Refresh the app and try again.',403);
   }
   const body=async(limit=1024*128)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)fail('Upload exceeds the allowed size.',413);chunks.push(chunk);}return Buffer.concat(chunks);};
   const json=async()=>{if(!req.headers['content-type']?.startsWith('application/json'))fail('JSON content type required.',415);try{return JSON.parse((await body()).toString()||'{}');}catch(e){if(e.status)throw e;fail('The request could not be read.');}};
   const login=u=>{const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),u.id,csrf,Date.now()+12*3600000);res.setHeader('Set-Cookie',`fz_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookies?'; Secure':''}`);return {user:safeUser(u),csrf};};
   if(route==='/api/status'&&method==='GET')return send(200,{demo,setupRequired:!db.prepare('SELECT id FROM users LIMIT 1').get()});
   if(route==='/api/setup'&&method==='POST'){
    if(!setupKey||db.prepare('SELECT id FROM users LIMIT 1').get())fail('Setup is already complete.',409);
    const b=await json();if(!setupKey||db.prepare('SELECT id FROM users LIMIT 1').get())fail('Setup is already complete.',409);if(typeof b.setupKey!=='string'||sha(b.setupKey)!==sha(setupKey))fail('Use the setup key shown on the server computer.',403);
    const username=text(b.username,80,true).toLowerCase();if(!/^[a-z0-9._-]+$/.test(username))fail('Username may contain letters, numbers, dots, underscores and hyphens.');
    db.prepare('INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)').run(text(b.name,120,true),username,hashPassword(password(b.password)),'admin');setupKey='';try{unlinkSync(path.join(dataDir,'first-run.txt'));}catch{}
    return send(201,login(db.prepare('SELECT * FROM users WHERE username=?').get(username)));
   }
   if(route==='/api/login'&&method==='POST'){
    const b=await json();const key=(req.socket.remoteAddress||'')+':'+String(b.username).toLowerCase();const r=rate.get(key);if(r&&r.until>Date.now()&&r.count>=8)fail('Too many attempts. Wait 15 minutes before trying again.',429);
    const u=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(b.username||'').toLowerCase());
    if(!u||typeof b.password!=='string'||b.password.length>200||!verifyPassword(b.password,u.password_hash)){rate.set(key,{count:r&&r.until>Date.now()?r.count+1:1,until:Date.now()+900000});fail('Username or password is incorrect.',401);}
    rate.delete(key);return send(200,login(u));
   }
   if(route==='/api/me'&&method==='GET'){requireUser();return send(200,{user:safeUser(session),csrf:session.csrf,demo});}
   if(route==='/api/logout'&&method==='POST'){requireUser();db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);for(const c of streams)if(c.tokenHash===session.token_hash)c.res.end();res.setHeader('Set-Cookie','fz_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
   if(route==='/api/password'&&method==='POST'){requireUser();const b=await json();if(!verifyPassword(String(b.currentPassword),session.password_hash))fail('Current password is incorrect.',403);db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password(b.newPassword)),session.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(session.id,session.token_hash);return send(200,{ok:true});}
   if(route==='/api/users'&&method==='GET'){requireUser();return send(200,db.prepare('SELECT id,name,username,role,active FROM users ORDER BY name').all().map(safeUser));}
   if(route==='/api/users'&&method==='POST'){requireUser();if(session.role!=='admin')fail('Administrator access required.',403);const b=await json();const username=text(b.username,80,true).toLowerCase();if(!/^[a-z0-9._-]+$/.test(username))fail('Invalid username.');if(db.prepare('SELECT id FROM users WHERE username=?').get(username))fail('That username already exists.',409);db.prepare('INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)').run(text(b.name,120,true),username,hashPassword(password(b.password)),enumValue(b.role,ROLES));audit(null,session.id,'user_created',`Created ${username} (${b.role})`);return send(201,{ok:true});}
   if(/^\/api\/users\/\d+$/.test(route)&&method==='PATCH'){requireUser();if(session.role!=='admin')fail('Administrator access required.',403);const id=Number(route.split('/').pop());if(id===session.id)fail('You cannot deactivate your own account.');const b=await json();if(typeof b.active!=='boolean')fail('Specify the account state.');if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))fail('User not found.',404);db.prepare('UPDATE users SET active=? WHERE id=?').run(Number(b.active),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);for(const c of streams)if(c.userId===id)c.res.end();audit(null,session.id,'user_updated',`Account ${id}: ${b.active?'enabled':'disabled'}`);return send(200,{ok:true});}
   if(route==='/api/settings'&&method==='GET'){requireUser();return send(200,getSettings());}
   if(route==='/api/settings'&&method==='PATCH'){requireUser();if(session.role!=='admin')fail('Administrator access required.',403);const b=await json();if(!Number.isInteger(b.redDays)||!Number.isInteger(b.amberDays)||b.redDays<0||b.redDays>=b.amberDays||b.amberDays>60)fail('Amber must be greater than red, between 0 and 60 days.');try{today(b.factoryTimezone);}catch{fail('Choose a valid timezone.');}const s={factoryTimezone:b.factoryTimezone,redDays:b.redDays,amberDays:b.amberDays};const before=getSettings();transaction(()=>{db.prepare('UPDATE settings SET payload=? WHERE id=1').run(JSON.stringify(s));audit(null,session.id,'settings','Updated deadline settings',before,s);});broadcast();return send(200,s);}
   if(route==='/api/events'&&method==='GET'){requireUser();res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write('event: connected\ndata: {}\n\n');const c={res,tokenHash:session.token_hash,userId:session.id};streams.add(c);const timer=setInterval(()=>{if(!db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires>?').get(c.tokenHash,Date.now()))return res.end();res.write(': keepalive\n\n');},20000);req.on('close',()=>{clearInterval(timer);streams.delete(c);});return;}
   if(route==='/api/samples'&&method==='GET'){requireUser();return send(200,db.prepare('SELECT * FROM samples ORDER BY id DESC').all().map(rowToSample));}
   if(route==='/api/samples'&&method==='POST'){requireUser();if(!canEdit(session))fail('Ask a merchandiser or account manager to create the sample.',403);const s=addSample(await json(),session);broadcast();return send(201,s);}
   const match=route.match(/^\/api\/samples\/(\d+)(?:\/(acknowledge|complete|reopen|comments|attachments))?$/);
   if(match){requireUser();const id=Number(match[1]),action=match[2];let s=getSample(id);if(!s)fail('Sample not found.',404);
    if(!action&&method==='GET')return send(200,{sample:s,activity:db.prepare('SELECT a.*,u.name actor FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE sample_id=? ORDER BY a.id DESC').all(id),attachments:db.prepare('SELECT id,name,mime,size,created_at FROM attachments WHERE sample_id=? ORDER BY created_at DESC').all(id)});
    if(!action&&method==='PUT'){
     if(s.completedAt)fail('An account manager must reopen this sample before it can be edited.',409);
     const b=await json();s=getSample(id);checkVersion(s,b.version);if(s.completedAt)fail('Reopen this sample before editing.',409);const p=normaliseSample(b);checkOwner(p);
     if(!canEdit(session)){
      const comparable=x=>JSON.stringify({...x,workStatus:'',materials:x.materials.map(m=>({...m,status:'',receivedDate:''}))});
      const old=normaliseSample(s);if(comparable(p)!==comparable(old))fail('Sample room access permits work status and material receipt updates only.',403);
     }
     const changed=specSignature(s)!==specSignature(p);const reason=text(b.reason||'',1000);
     if(changed&&!reason)fail('Explain the specification or deadline change.');
     if(p.workStatus!==s.workStatus&&['in_progress','ready'].includes(p.workStatus)&&(changed||s.ackVersion!==s.specVersion))fail('Acknowledge the current instructions before starting or marking ready.');
     if(p.workStatus==='ready'&&p.materials.some(m=>m.status!=='received'))fail('Confirm all materials received before marking the sample ready.');
     transaction(()=>{db.prepare('UPDATE samples SET payload=?,version=version+1,spec_version=spec_version+?,updated_at=?,updated_by=? WHERE id=?').run(JSON.stringify(p),Number(changed),iso(),session.id,id);audit(id,session.id,'updated',reason||'Updated progress or material status',s,getSample(id));});broadcast();return send(200,getSample(id));
    }
    if(action==='comments'&&method==='POST'){const b=await json();audit(id,session.id,'comment',text(b.body,3000,true));broadcast();return send(201,{ok:true});}
    if(['acknowledge','complete','reopen'].includes(action)&&method==='POST'){
     const b=await json();s=getSample(id);checkVersion(s,b.version);
     if(action==='acknowledge'){if(!['sample_room','admin','manager'].includes(session.role))fail('The sample room or an account manager must acknowledge instructions.',403);if(s.completedAt)fail('This sample is already completed.',409);transaction(()=>{db.prepare('UPDATE samples SET ack_version=spec_version,ack_by=?,ack_at=?,version=version+1,updated_at=?,updated_by=? WHERE id=?').run(session.id,iso(),iso(),session.id,id);audit(id,session.id,'acknowledged',`Acknowledged specification revision ${s.specVersion}`);});}
     else{if(!managers(session))fail('Only account managers or administrators can close or reopen samples.',403);
      if(action==='complete'){if(s.completedAt)fail('Already completed.',409);if(s.workStatus!=='ready'||s.ackVersion!==s.specVersion)fail('The sample must be ready with its current instructions acknowledged.');transaction(()=>{db.prepare('UPDATE samples SET completed_at=?,completed_by=?,version=version+1,updated_at=?,updated_by=? WHERE id=?').run(iso(),session.id,iso(),session.id,id);audit(id,session.id,'completed','Confirmed sample received and closed',s,getSample(id));});}
      else{if(!s.completedAt)fail('This sample is already open.',409);const reason=text(b.reason,1000,true);transaction(()=>{db.prepare('UPDATE samples SET completed_at=NULL,completed_by=NULL,version=version+1,updated_at=?,updated_by=? WHERE id=?').run(iso(),session.id,id);audit(id,session.id,'reopened',reason,s,getSample(id));});}
     }broadcast();return send(200,getSample(id));
    }
    if(action==='attachments'&&method==='POST'){
     if(!canEdit(session))fail('A merchandiser or manager must attach specifications.',403);if(s.completedAt)fail('Reopen the sample before attaching a revised specification.',409);
     checkVersion(s,Number(req.headers['x-sample-version']));const name=text(decodeURIComponent(String(req.headers['x-file-name']||'')),180,true);const content=await body(8*1024*1024);let mime='';
     if(content.subarray(0,5).toString()==='%PDF-')mime='application/pdf';else if(content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';else if(content[0]===255&&content[1]===216&&content[2]===255)mime='image/jpeg';else fail('Attach a PDF, PNG or JPEG file.');
     s=getSample(id);checkVersion(s,Number(req.headers['x-sample-version']));if(s.completedAt)fail('Reopen the sample before attaching files.',409);
     const aid=randomUUID();const disk=path.join(dataDir,'attachments',aid);writeFileSync(disk,content,{mode:0o600});try{transaction(()=>{db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').run(aid,id,session.id,name,mime,content.length,sha(content),iso());db.prepare('UPDATE samples SET version=version+1,spec_version=spec_version+1,updated_at=?,updated_by=? WHERE id=?').run(iso(),session.id,id);audit(id,session.id,'attachment',`Added specification file ${name}; re-acknowledgement required.`);});}catch(e){unlinkSync(disk);throw e;}broadcast();return send(201,{id:aid});
    }
   }
   if(route.startsWith('/api/attachments/')&&method==='GET'){requireUser();const a=db.prepare('SELECT * FROM attachments WHERE id=?').get(route.split('/').pop());if(!a)fail('Attachment not found.',404);res.writeHead(200,{'Content-Type':a.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`});return res.end(readFileSync(path.join(dataDir,'attachments',a.id)));}
   if(route==='/api/export'&&method==='GET'){requireUser();const rows=db.prepare('SELECT * FROM samples ORDER BY id').all().map(rowToSample);const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';const cols=['id','customer','department','style','colour','sizes','stage','dueDate','submissionDate','workStatus','completedAt','specification'];const csv=[cols.join(','),...rows.map(s=>cols.map(k=>cell(s[k])).join(','))].join('\r\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="samples.csv"'});return res.end('\uFEFF'+csv);}
   if(route==='/api/backup'&&method==='POST'){requireUser();if(session.role!=='admin')fail('Administrator access required.',403);await json();const dir=path.join(dataDir,'backups');mkdirSync(dir,{recursive:true});const name=`samples-${Date.now()}.sqlite`;await backup(db,path.join(dir,name));audit(null,session.id,'backup',`Created ${name}`);return send(200,{ok:true,name,message:'Database backup created on the server. Copy it and the attachments folder to a separate secure device.'});}
   if(route.startsWith('/api/'))fail('Endpoint not found.',404);
   if(!['GET','HEAD'].includes(method))fail('Method not allowed.',405);
   const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/assets/logo-intro.svg':'assets/logo-intro.svg','/assets/logo-static.svg':'assets/logo-static.svg','/assets/icon.png':'assets/icon.png'};
   const local=files[route];if(!local)fail('File not found.',404);
   const file=path.join(ROOT,'public',local);const mime=local.endsWith('.html')?'text/html; charset=utf-8':local.endsWith('.js')?'text/javascript; charset=utf-8':local.endsWith('.css')?'text/css; charset=utf-8':local.endsWith('.svg')?'image/svg+xml':'image/png';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:readFileSync(file));
  }catch(e){if(res.headersSent){res.end();return;}send(e.status||500,{error:e.status?e.message:'The server could not complete the request.'});if(!e.status)console.error(e);}
 });
 const cleanup=setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());for(const[k,v]of rate)if(v.until<Date.now())rate.delete(k);},60000);cleanup.unref();
 return {server,db,setupKey,dataDir,close:async()=>{clearInterval(cleanup);for(const c of streams)c.res.end();await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const demo=process.argv.includes('--demo');const port=Number(process.env.PORT)||4310;const app=createApp({demo,dataDir:process.env.FAZIL_DATA_DIR||path.join(ROOT,demo?'demo-data':'data')});
 app.server.listen(port,process.env.HOST||'127.0.0.1',()=>{console.log(`Fazil Samples ${demo?'DEMONSTRATION':'server'}: http://${process.env.HOST||'127.0.0.1'}:${port}`);if(app.setupKey)console.log(`First-run setup key: ${app.setupKey}`);});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit()));
}
