const {app,BrowserWindow,ipcMain,dialog,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let mainWindow,embedded,currentOrigin,configFile,closing=false;
function validateURL(raw){const u=new URL(raw);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use a workspace origin without a path, query, or password.');if(u.protocol!=='https:')throw new Error('Factory workspaces must use HTTPS.');return u.origin;}
async function loadWorkspace(origin){
 currentOrigin=origin;await mainWindow.loadURL(origin);
}
async function start(){
 app.setName('Fazil Samples');configFile=path.join(app.getPath('userData'),'connection.json');
 let remote=process.env.FAZIL_SERVER_URL||'';if(!remote&&fs.existsSync(configFile)){try{remote=JSON.parse(fs.readFileSync(configFile,'utf8')).serverUrl||'';}catch{}}
 if(remote){try{remote=validateURL(remote);}catch(e){dialog.showErrorBox('Workspace address',e.message);remote='';}}
 if(!remote){const {createApp}=await import(pathToFileURL(path.join(__dirname,'..','server.mjs')).href);embedded=createApp({demo:true,dataDir:path.join(app.getPath('userData'),'demonstration')});await new Promise(resolve=>embedded.server.listen(0,'127.0.0.1',resolve));}
 mainWindow=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,title:'Fazil Samples',backgroundColor:'#FFFFFF',icon:path.join(__dirname,'..','public','assets','icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 mainWindow.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==currentOrigin)event.preventDefault();}catch{event.preventDefault();}});
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 ipcMain.handle('fazil:connect',async(event,raw)=>{
  if(event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame||new URL(event.senderFrame.url).origin!==currentOrigin)throw new Error('Invalid connection request.');
  const origin=validateURL(String(raw));
  const response=await fetch(origin+'/api/status',{signal:AbortSignal.timeout(10000)});const status=await response.json();
  if(!response.ok||typeof status.setupRequired!=='boolean'||typeof status.demo!=='boolean')throw new Error('That address is not a Fazil Samples workspace.');
  fs.writeFileSync(configFile,JSON.stringify({serverUrl:origin},null,2));await loadWorkspace(origin);return true;
 });
 mainWindow.webContents.on('did-fail-load',(_event,code)=>{if(code!==-3)dialog.showMessageBox(mainWindow,{type:'warning',title:'Workspace unavailable',message:'The workspace could not be reached. Check the server and network, then restart the app.',detail:'To return to the demonstration, remove connection.json from the application data folder. Your sample records are unaffected.'});});
 await loadWorkspace(remote||`http://127.0.0.1:${embedded.server.address().port}`);
}
app.whenReady().then(start).catch(e=>{dialog.showErrorBox('Fazil Samples could not start',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(embedded&&!closing){event.preventDefault();closing=true;embedded.close().finally(()=>app.quit());}});
