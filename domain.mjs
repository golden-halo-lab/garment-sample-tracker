import {randomUUID} from 'node:crypto';
export const ROLES=['admin','manager','merchandiser','sample_room'];
export const STAGES=['Development','Fit','Pre-production'];
export const MATERIAL_STATES=['not_ordered','ordered','in_transit','received'];
export const WORK_STATES=['queued','in_progress','blocked','ready'];
export const DEFAULT_SETTINGS={factoryTimezone:'Asia/Dhaka',redDays:2,amberDays:5};
export function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
export function text(value,max=500,required=false){if(typeof value!=='string')fail('Expected text.');const s=value.trim();if(s.length>max||required&&!s)fail(`Enter ${required?'1–':'up to '}${max} characters.`);return s;}
export function date(value,required=false){const s=text(value??'',10,required);if(!s&&!required)return '';const d=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)fail('Use a valid calendar date.');return s;}
export function enumValue(value,list){if(!list.includes(value))fail('Invalid selection.');return value;}
export function today(timezone='Asia/Dhaka',now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function dayDifference(a,b){return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);}
export function risk(sample,settings=DEFAULT_SETTINGS,now=new Date()){
 if(sample.completedAt)return {colour:'completed',label:'Completed',days:null,reason:'Received and closed by an account manager.'};
 const days=dayDifference(sample.dueDate,today(settings.factoryTimezone,now));
 const colour=days<=settings.redDays?'red':days<=settings.amberDays?'amber':'green';
 return {colour,label:colour==='red'?'Action needed':colour==='amber'?'Due soon':'On schedule',days,reason:days<0?`${Math.abs(days)} day(s) overdue`:days===0?'Due today':`Due in ${days} calendar day(s)`};
}
export function normaliseSample(input){
 const materials=Array.isArray(input.materials)?input.materials:[];
 if(!materials.length||materials.length>30)fail('Add between 1 and 30 material requirements.');
 const clean=materials.map(m=>({id:text(m.id||randomUUID(),80,true),kind:enumValue(m.kind,['fabric','accessory']),name:text(m.name,240,true),status:enumValue(m.status,MATERIAL_STATES),expectedDate:date(m.expectedDate),receivedDate:date(m.receivedDate)}));
 if(new Set(clean.map(m=>m.id)).size!==clean.length)fail('Material rows must have unique IDs.');
 if(!clean.some(m=>m.kind==='fabric'))fail('Add a fabric requirement.');
 for(const m of clean){if(m.status==='received'&&!m.receivedDate)fail('A received material needs its receipt date.');if(m.status!=='received')m.receivedDate='';}
 return {customer:text(input.customer,120,true),department:text(input.department,100,true),style:text(input.style,100,true),colour:text(input.colour,100,true),sizes:text(input.sizes,150,true),stage:enumValue(input.stage,STAGES),dueDate:date(input.dueDate,true),submissionDate:date(input.submissionDate),ownerId:Number(input.ownerId)||null,specification:text(input.specification||'',6000),workStatus:enumValue(input.workStatus||'queued',WORK_STATES),materials:clean,previousSampleId:input.previousSampleId?Number(input.previousSampleId):null};
}
export function specSignature(p){return JSON.stringify([p.customer,p.department,p.style,p.colour,p.sizes,p.stage,p.dueDate,p.submissionDate,p.specification,p.materials.map(m=>[m.id,m.kind,m.name])]);}
export function insights(s,settings=DEFAULT_SETTINGS){
 if(s.completedAt)return [];
 const alerts=[];
 if(s.ackVersion!==s.specVersion)alerts.push({type:'spec',title:'Instructions need acknowledgement',detail:`Sample room has not acknowledged specification revision ${s.specVersion}.`});
 const missing=s.materials.filter(m=>m.status!=='received');
 if(missing.length)alerts.push({type:'material',title:`${missing.length} material requirement(s) outstanding`,detail:missing.map(m=>m.name).join(', ')});
 for(const m of missing){if(!m.expectedDate)alerts.push({type:'material',title:`No arrival date: ${m.name}`,detail:'Confirm availability with the merchandiser.'});else if(m.expectedDate>=s.dueDate)alerts.push({type:'material',title:`Arrival leaves no preparation day: ${m.name}`,detail:`Expected ${m.expectedDate}; internal ready date ${s.dueDate}.`});}
 if(s.submissionDate&&s.submissionDate<=s.dueDate)alerts.push({type:'dispatch',title:'Check courier lead time',detail:'Buyer submission is on or before the internal ready date.'});
 if(s.workStatus==='blocked')alerts.push({type:'blocked',title:'Work is blocked',detail:'Record the cause and who will resolve it in the activity thread.'});
 return alerts;
}
