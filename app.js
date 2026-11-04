const STORE_KEY = "spazio-personale-v1";
const defaults = { reminders: [], interests: ["Viticoltura","Tecnologia","Storia","Geopolitica","Enologia"], projects: [] };
let state = loadState();
function loadState(){try{return {...defaults,...JSON.parse(localStorage.getItem(STORE_KEY)||"{}")}}catch{return {...defaults}}}
function saveState(){localStorage.setItem(STORE_KEY,JSON.stringify(state));}
const $ = s => document.querySelector(s);
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2300);}
function go(view){document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+view));document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));window.scrollTo({top:0,behavior:"smooth"});}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));
function renderReminders(){
 const list=$("#reminder-list"),home=$("#home-reminders");list.innerHTML="";
 $("#reminder-total").textContent=`${state.reminders.length} ELEMENTI`;
 if(!state.reminders.length){list.innerHTML='<div class="note-card"><span class="note-icon">✓</span><div><strong>Per ora è tutto tranquillo.</strong><p>Quando aggiungerai un promemoria, lo troverai qui.</p></div></div>';home.innerHTML='<strong>Qui trovi i tuoi promemoria.</strong><span>Per ora la mente può riposare.</span>';}
 else{
  const sorted=[...state.reminders].sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
  list.innerHTML=sorted.map(r=>`<div class="list-item"><span class="list-symbol">◷</span><div class="list-copy"><strong>${escapeHTML(r.title)}</strong><small>${r.date?new Date(r.date+"T12:00:00").toLocaleDateString("it-IT",{day:"numeric",month:"long",year:"numeric"}):"Data non specificata"} ${r.time?"· "+escapeHTML(r.time):""}</small></div><button class="delete-button" data-delete-reminder="${r.id}" aria-label="Elimina promemoria">×</button></div>`).join("");
  home.innerHTML=sorted.slice(0,2).map(r=>`<div style="font-size:11px;padding:7px 0;border-bottom:1px solid #edf0eb"><strong>${escapeHTML(r.title)}</strong><div style="font-size:9px;color:#849088;margin-top:3px">${r.date?new Date(r.date+"T12:00:00").toLocaleDateString("it-IT",{day:"numeric",month:"short"}):"Da definire"}</div></div>`).join("");
 }
 $("#today-count").textContent=state.reminders.length?`${state.reminders.length} promemoria registrati`:"Nessun impegno registrato";
 list.querySelectorAll("[data-delete-reminder]").forEach(b=>b.addEventListener("click",()=>{state.reminders=state.reminders.filter(r=>r.id!==b.dataset.deleteReminder);saveState();renderReminders();toast("Promemoria eliminato");}));
}
$("#reminder-form").addEventListener("submit",e=>{e.preventDefault();const title=$("#reminder-title").value.trim();if(!title)return;state.reminders.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title,date:$("#reminder-date").value,time:$("#reminder-time").value});saveState();e.target.reset();renderReminders();toast("Promemoria salvato su questo dispositivo");});
function renderInterests(){
 const list=$("#interest-list"),home=$("#home-interests");
 list.innerHTML=state.interests.length?state.interests.map((x,i)=>`<span class="interest-item">✧ ${escapeHTML(x)} <button data-remove-interest="${i}" aria-label="Rimuovi ${escapeHTML(x)}">×</button></span>`).join(""):'<p class="footnote">Non hai ancora aggiunto interessi.</p>';
 home.innerHTML=state.interests.slice(0,7).map(x=>`<span class="interest-chip">${escapeHTML(x)}</span>`).join("");
 list.querySelectorAll("[data-remove-interest]").forEach(b=>b.addEventListener("click",()=>{state.interests.splice(Number(b.dataset.removeInterest),1);saveState();renderInterests();toast("Interesse rimosso");}));
}
$("#interest-form").addEventListener("submit",e=>{e.preventDefault();const v=$("#interest-name").value.trim();if(!v)return;if(state.interests.some(x=>x.toLowerCase()===v.toLowerCase())){toast("Questo interesse è già presente");return;}state.interests.push(v);saveState();e.target.reset();renderInterests();toast("Interesse aggiunto");});
function renderProjects(){
 const list=$("#project-list");list.innerHTML=state.projects.length?state.projects.map(p=>`<div class="list-item"><span class="list-symbol">◇</span><div class="list-copy"><strong>${escapeHTML(p.name)}</strong><small>Da coltivare con i tuoi tempi</small></div><button class="delete-button" data-delete-project="${p.id}" aria-label="Elimina progetto">×</button></div>`).join(""):'<div class="note-card"><span class="note-icon">◇</span><div><strong>Nessun progetto in lista.</strong><p>Puoi aggiungere un'idea anche solo per non perderla di vista.</p></div></div>';
 list.querySelectorAll("[data-delete-project]").forEach(b=>b.addEventListener("click",()=>{state.projects=state.projects.filter(p=>p.id!==b.dataset.deleteProject);saveState();renderProjects();toast("Progetto rimosso");}));
}
$("#project-form").addEventListener("submit",e=>{e.preventDefault();const name=$("#project-name").value.trim();if(!name)return;state.projects.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),name});saveState();e.target.reset();renderProjects();toast("Idea salvata");});
document.querySelectorAll("[data-assistant-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-assistant-tab]").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".assistant-panel").forEach(x=>x.classList.toggle("active",x.id==="assistant-"+b.dataset.assistantTab));}));
document.querySelectorAll(".ai-placeholder").forEach(b=>b.addEventListener("click",()=>toast("Funzione predisposta, ma l'assistente AI non è ancora collegato.")));
$("#open-settings").addEventListener("click",()=>$("#settings-dialog").showModal());
$("#close-settings").addEventListener("click",()=>$("#settings-dialog").close());
$("#settings-dialog").addEventListener("click",e=>{if(e.target===$("#settings-dialog"))$("#settings-dialog").close()});
$("#export-data").addEventListener("click",()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="spazio-personale-dati.json";a.click();URL.revokeObjectURL(url);toast("Esportazione avviata");});
const now=new Date();$("#date-chip").innerHTML=`<strong>${now.toLocaleDateString("it-IT",{day:"2-digit"})}</strong><br>${now.toLocaleDateString("it-IT",{month:"short"}).toUpperCase()}`;
$("#connection-label").textContent=navigator.onLine?"Pronto":"Offline";
window.addEventListener("online",()=>$("#connection-label").textContent="Pronto");window.addEventListener("offline",()=>$("#connection-label").textContent="Offline");
renderReminders();renderInterests();renderProjects();
if("serviceWorker" in navigator && location.protocol.startsWith("http"))window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
