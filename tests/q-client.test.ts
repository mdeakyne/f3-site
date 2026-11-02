import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initQForm } from '../src/lib/q-form-controller.ts';
import { initQCalendar } from '../src/lib/q-calendar-controller.ts';
const now = new Date('2026-11-02T18:00:00Z');
const claim = {ao_slug:'beehive',ao_name:'Beehive',event_date:'2026-11-03',time:'5:30 AM',q_name:'404',title:'<img src=x onerror=alert(1)>'};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const {window} = new JSDOM(`<html><head></head><body>
  <script id="q-data" type="application/json">${JSON.stringify({pax:[{slug:'old',name:'Old',latest:'2026-08-01'},{slug:'edge',name:'Edge',latest:'2026-08-02'}]})}</script>
  <p id="availability-status"></p><ul id="q-calendar"></ul>
  <form id="q-form"><select name="ao_slug"><option value="">AO</option><option value="beehive">Beehive</option></select><select name="event_date"></select><input name="time" readonly>
  <input id="q-search" role="combobox"><ul id="q-options" role="listbox"></ul><input name="q_slug"><input name="f3_name_other" id="q-other"><input name="title" value="Test"><textarea name="description">Workout</textarea><select name="coupon"><option value=""></option><option value="yes">Yes</option><option value="no">No</option></select><input name="loaded_at"><input name="company"><input name="cf-turnstile-response"><div id="turnstile-widget"></div><p id="turnstile-status"></p><button id="q-submit">Claim</button><p id="form-status"></p><a id="q-checklist" hidden href="/q-checklist/">Open your Q Checklist</a></form></body></html>`, {url:'http://localhost/signup/?ao=beehive&date=2026-11-03'});
  const document = window.document;
  let callbacks:any;
  (window as any).turnstile = {render: (_:unknown, cb:unknown) => {callbacks=cb;return 'widget';},reset:()=>{}};
  const input = (name:string) => document.querySelector(`[name="${name}"]`) as any;
  return {document:document as unknown as Document,window,input,ready:()=>callbacks.callback('token'),expire:()=>callbacks['expired-callback']()};
}
const response = (claims:unknown[]=[]) => new Response(JSON.stringify({claims}));
test('fetch failure disables claim and shows no OPEN invitation', async()=>{
 const f=fixture();initQForm(f.document, (async()=>{throw Error('offline');}) as typeof fetch, now);await tick();f.ready();
 assert.equal((f.document.getElementById('q-submit') as HTMLButtonElement).disabled,true);assert.match(f.document.getElementById('availability-status')!.textContent!,/could not be confirmed/);assert.doesNotMatch(f.document.getElementById('q-calendar')!.textContent!,/OPEN/);
});
test('keyboard combobox arrows Enter Escape, inclusive PAX cutoff and Other',async()=>{
 const f=fixture();initQForm(f.document,(async()=>response()) as typeof fetch,now);await tick();
 const search=f.document.getElementById('q-search')!;search.dispatchEvent(new f.window.Event('focus'));
 assert.doesNotMatch(f.document.getElementById('q-options')!.textContent!,/Old/);assert.match(f.document.getElementById('q-options')!.textContent!,/Edge/);
 const key=(value:string)=>{const e=new f.window.Event('keydown');Object.defineProperty(e,'key',{value});search.dispatchEvent(e);};
 key('ArrowDown');key('Enter');assert.equal(f.input('q_slug').value,'edge');
 search.dispatchEvent(new f.window.Event('focus'));key('Escape');assert.equal(search.getAttribute('aria-expanded'),'false');
 (search as HTMLInputElement).value='Other';search.dispatchEvent(new f.window.Event('input'));key('ArrowDown');key('Enter');assert.equal(f.input('q_slug').value,'__other__');assert.equal(f.input('f3_name_other').required,true);
});
test('claimed slots disappear; calendar renders XSS literally',async()=>{
 const f=fixture();initQForm(f.document,(async()=>response([claim])) as typeof fetch,now);await tick();
 assert.equal(Array.from(f.input('event_date').querySelectorAll('option')).some((o:any)=>o.value==='2026-11-03'),false);
 assert.match(f.document.getElementById('q-calendar')!.textContent!,/404/);assert.match(f.document.getElementById('q-calendar')!.textContent!,/<img/);assert.equal(f.document.querySelector('img'),null);
});
test('calendar fails closed and empty claims provide live window',async()=>{
 const f=fixture();initQCalendar(f.document,(async()=>response()) as typeof fetch,now);await tick();assert.match(f.document.getElementById('q-calendar')!.textContent!,/OPEN/);assert.match(f.document.getElementById('q-calendar')!.textContent!,/2026-11-03/);assert.doesNotMatch(f.document.getElementById('q-calendar')!.textContent!,/2026-11-02/);
});
test('conflict refreshes availability; sending disables submit and requires fresh token',async()=>{
 const f=fixture();let reads=0;let release:(r:Response)=>void=()=>{};let posted:FormData|undefined;
 const fetcher=async (_:any,init?:RequestInit)=>{if(init?.method==='POST'){posted=init.body as FormData;return await new Promise<Response>(resolve=>{release=resolve;});}return response(++reads>1?[claim]:[]);};
 initQForm(f.document,fetcher as typeof fetch,now);await tick();f.ready();f.input('q_slug').value='edge';f.input('coupon').value='yes';
 f.document.getElementById('q-form')!.dispatchEvent(new f.window.Event('submit',{cancelable:true}));await tick();assert.equal((f.document.getElementById('q-submit') as HTMLButtonElement).disabled,true);assert.equal(posted?.get('q_slug'),'edge');release(new Response(JSON.stringify({error:'That workout was just claimed.'}),{status:409}));await tick();await tick();
 assert.equal(reads,2);assert.equal(Array.from(f.input('event_date').querySelectorAll('option')).some((o:any)=>o.value==='2026-11-03'),false);assert.equal((f.document.getElementById('q-submit') as HTMLButtonElement).disabled,true);
});
test('required coupon and Other, expired token, canonical time, success checklist remains',async()=>{
 const f=fixture();let posts=0;const fetcher=async (_:any,init?:RequestInit)=>{if(init?.method==='POST'){posts++;return new Response(JSON.stringify({ok:true,message:'Claimed and scheduled.',publication:'scheduled'}));}return response();};
 initQForm(f.document,fetcher as typeof fetch,now);await tick();assert.equal(f.input('time').value,'5:30 AM');f.ready();f.input('q_slug').value='edge';
 const submit=()=>f.document.getElementById('q-form')!.dispatchEvent(new f.window.Event('submit',{cancelable:true}));submit();await tick();assert.equal(posts,0);
 f.input('coupon').value='yes';f.expire();submit();await tick();assert.equal(posts,0);f.ready();f.input('q_slug').value='__other__';submit();await tick();assert.equal(posts,0);
 f.input('f3_name_other').value='New Q';submit();await tick();await tick();assert.equal(posts,1);assert.match(f.document.getElementById('form-status')!.textContent!,/Claimed and scheduled/);assert.equal((f.document.getElementById('q-checklist') as HTMLElement).hidden,false);assert.equal(f.document.getElementById('q-checklist')!.getAttribute('href'),'/q-checklist/');
});
test('ArrowUp from closed list selects last choice, typing invalidates selected Q',async()=>{
 const f=fixture();initQForm(f.document,(async()=>response()) as typeof fetch,now);await tick();const search=f.document.getElementById('q-search')!;
 const key=(value:string)=>{const e=new f.window.Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value});search.dispatchEvent(e);};
 key('ArrowUp');key('Enter');assert.equal(f.input('q_slug').value,'__other__');(search as HTMLInputElement).value='Ed';search.dispatchEvent(new f.window.Event('input'));assert.equal(f.input('q_slug').value,'');assert.equal(f.input('f3_name_other').required,false);
});
test('calendar network or malformed payload never invites claims',async()=>{
 for(const fetcher of [async()=>{throw Error('offline');},async()=>new Response(JSON.stringify({claims:[{ao_slug:'beehive'}]}))]){
 const f=fixture();initQCalendar(f.document,fetcher as typeof fetch,now);await tick();assert.match(f.document.getElementById('availability-status')!.textContent!,/could not be confirmed/);assert.equal(f.document.getElementById('q-calendar')!.querySelector('a'),null);assert.doesNotMatch(f.document.getElementById('q-calendar')!.textContent!,/OPEN/);
 }
});

test('saved success stays confirmed when subsequent availability refresh fails',async()=>{
 const f=fixture();let reads=0;let posts=0;
 const fetcher=async (_:unknown,init?:RequestInit)=>{
  if(init?.method==='POST'){posts++;return Response.json({ok:true,message:'Workout claimed. Slack delivery needs attention; your claim is saved.',publication:'failed'});}
  if(++reads>1)throw Error('offline');return response();
 };
 initQForm(f.document,fetcher as typeof fetch,now);await tick();f.ready();f.input('q_slug').value='edge';f.input('coupon').value='yes';
 const send=()=>f.document.getElementById('q-form')!.dispatchEvent(new f.window.Event('submit',{cancelable:true}));
 send();await tick();await tick();
 assert.equal(posts,1);assert.match(f.document.getElementById('form-status')!.textContent!,/claim is saved/);
 assert.equal((f.document.getElementById('q-checklist') as HTMLElement).hidden,false);
 assert.match(f.document.getElementById('availability-status')!.textContent!,/could not be confirmed/);
 f.ready();send();await tick();assert.equal(posts,1);assert.equal((f.document.getElementById('q-submit') as HTMLButtonElement).disabled,true);
});

test('script load controls verification readiness and script errors fail closed',async()=>{
 for(const event of ['load','error']){
  const f=fixture();const challenge=(f.window as any).turnstile;delete (f.window as any).turnstile;
  initQForm(f.document,(async()=>response()) as typeof fetch,now);await tick();
  const submit=f.document.getElementById('q-submit') as HTMLButtonElement;
  assert.equal(submit.disabled,true);const script=f.document.getElementById('turnstile-api')!;
  assert.match(script.getAttribute('src')!,/^https:\/\/challenges.cloudflare.com\/turnstile\/v0\/api.js\?render=explicit$/);
  if(event==='load')(f.window as any).turnstile=challenge;
  script.dispatchEvent(new f.window.Event(event));
  if(event==='load'){assert.equal(submit.disabled,true);f.ready();assert.equal(submit.disabled,false);}
  else{assert.equal(submit.disabled,true);assert.match(f.document.getElementById('turnstile-status')!.textContent!,/could not complete/);}
 }
});

test('typing a known or arbitrary Q name cannot submit without choosing an option',async()=>{
 const f=fixture();let posts=0;initQForm(f.document,(async (_:unknown,init?:RequestInit)=>{if(init?.method==='POST')posts++;return response();}) as typeof fetch,now);
 await tick();f.ready();f.input('coupon').value='yes';const search=f.document.getElementById('q-search') as HTMLInputElement;
 for(const typed of ['Edge','Arbitrary']){
  search.value=typed;search.dispatchEvent(new f.window.Event('input'));
  f.document.getElementById('q-form')!.dispatchEvent(new f.window.Event('submit',{cancelable:true}));await tick();
  assert.equal(posts,0);assert.match(f.document.getElementById('form-status')!.textContent!,/listed Q or Other/);
 }
});
