// Isolated UI harness: exercises native DragEvent/FileReader paths without touching user sessions or an API.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../../src/styles.css";
import "../../src/capabilities.css";
import type { AppState, Attachment, DesktopBridge } from "../../src/types";
const time = new Date().toISOString();
const state: AppState = { version:1, projects:[], skills:[], connectors:[], modelLibraries:{}, models:[{id:'claude-opus-5-5',name:'Claude Opus 5.5'}], hasKey:false, warning:'', platform:'preview', settings:{baseUrl:'https://example.test/v1',model:'claude-opus-5-5',sounds:false,volume:.2,motion:true}, sessions:[{id:'attachments-qa',title:'Проверка вложений',model:'claude-opus-5-5',projectId:null,permissionMode:'auto',draft:'Черновик остаётся на месте',messages:[],archived:false,createdAt:time,updatedAt:time}] };
const listeners = new Set<(state:AppState)=>void>();
if (new URL(location.href).searchParams.has('full')) state.sessions[0].draftAttachments=Array.from({length:8},(_,i)=>({id:`full-${i}`,name:`File ${i}.png`,path:`File ${i}.png`,size:100,mime:'image/png',kind:'image'}));
const previews = new Map<string,string>();
const ok = <T,>(value:T) => ({ok:true as const,value});
const publish = () => listeners.forEach(fn=>fn(structuredClone(state)));
let emptyClipboard = true;
let incoming: File[] = [];
async function importFile(input:{name:string;data:string}) {
  await new Promise(resolve=>setTimeout(resolve,1200));
  if (!input.data.startsWith('iVBORw0KGgo')) return {ok:false as const,error:'Invalid PNG image'};
  const file: Attachment = {id:crypto.randomUUID(),name:input.name,path:input.name,kind:'image',mime:'image/png',size:atob(input.data).length};
  previews.set(file.id!,`data:image/png;base64,${input.data}`);
  return ok(file);
}
window.turwe = {
  bootstrap:async()=>ok(structuredClone(state)),
  onState:(fn)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  updateSession:async(id,patch)=>{Object.assign(state.sessions.find(s=>s.id===id)!,patch);publish();return ok(null);},
  draftAttachments:async(id,files)=>{state.sessions.find(s=>s.id===id)!.draftAttachments=files;publish();return ok(null);},
  importAttachment:importFile,
  attachmentPreview:async(id)=>ok(previews.get(id)||null),
  pasteAttachment:async()=>{
    if(emptyClipboard) return {ok:false,error:'В буфере нет изображения, файла или текста. Скопируйте их и попробуйте ещё раз.'};
    const blob=await(await fetch('/icon.png')).blob();
    const data=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});
    const result=await importFile({name:'Из буфера.png',data});
    return result.ok?ok([result.value]):result;
  },
  saveSettings:async(patch)=>{Object.assign(state.settings,patch);publish();return ok(structuredClone(state));},
  windowAction:async()=>ok(null),
} as DesktopBridge;
const {default:App}=await import('../../src/App');
createRoot(document.getElementById('root')!).render(<App/>);
const controls=document.createElement('aside');
controls.setAttribute('aria-label','Тестовые сценарии');
controls.style.cssText='position:fixed;bottom:10px;right:12px;z-index:150;background:#171717;padding:8px;border:1px solid #555;border-radius:12px;display:flex;gap:8px;font-size:10px;max-width:calc(100vw - 280px);flex-wrap:wrap';
const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.setAttribute('aria-label','Файлы для тестового перетаскивания');
picker.onchange=()=>{incoming=Array.from(picker.files||[]);};controls.append(picker);
const transfer=()=>{const data=new DataTransfer();incoming.forEach(file=>data.items.add(file));return data;};
function event(type:string, target='.workspace') {document.querySelector(target)!.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer()}));}
function button(label:string,run:()=>void){const b=document.createElement('button');b.textContent=label;b.onclick=run;controls.append(b);}
button('Внести файлы',()=>event('dragenter'));
button('Над полем',()=>{event('dragenter','.composer textarea');event('dragleave');});
button('Унести файлы',()=>event('dragleave','.composer textarea'));
button('Отпустить файлы',()=>event('drop'));
button('Сломанный файл',()=>{incoming=[...incoming,new File(['broken'],'broken.png',{type:'image/png'})];event('drop');});
button('Полный черновик',()=>{location.search='?full=1';});
button('Архив',()=>{state.sessions[0].archived=!state.sessions[0].archived;publish();});
button('Буфер: изображение',()=>{emptyClipboard=false;});
button('Буфер: пусто',()=>{emptyClipboard=true;});
document.body.append(controls);
