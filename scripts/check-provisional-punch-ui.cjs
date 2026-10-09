// Actual DayCorrection component, fictional browser adapters only. No database/deploy mode.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),out=path.resolve(process.env.PUNCH_UI_OUTPUT||path.join(repo,'../../artifacts/provisional-inline-implementation-20261009/ui'));
const esbuild=require('esbuild'),postcss=require('postcss'),tailwind=require('tailwindcss');
const {chromium}=require('@playwright/test');
const entry=path.join(repo,'src/scripts/provisionalPunchEditPreview.tsx');
// Pin the original UI so the before/after check remains reproducible after commit.
const baselineRef=process.env.PUNCH_UI_BASE_REF||'5c964120ce0c17aaaa31fee5fd0b84f80bc79b28';
const report={passed:false,productionAccess:false,scope:'Actual client component; simulated reads/review/confirmation, no server acceptance',humanCounts:null,journeys:[],checks:[],errors:[]};
const stubs={
 '@/lib/payroll/readClient':'export const payrollRead=(...x)=>window.punchPreview.mockRead(...x);',
 '@/app/actions/provisionalCorrectionAction':'export const previewProvisionalCorrectionAction=(...x)=>window.punchPreview.mockPreview(...x);',
 '@/app/actions/attendanceWorkbenchAction':'export const getWorkBatchCompletionAction=(...x)=>window.punchPreview.mockCompletion(...x);export const approveWorkBatchAction=(...x)=>window.punchPreview.mockApprove(...x);export const refreshWorkBatchAttendanceAction=(...x)=>window.punchPreview.mockRefresh(...x);',
 '@/app/actions/scheduleWorkspaceAction':'const fail=()=>{throw Error("Unexpected schedule action")};export const confirmScheduleDays=fail,getScheduleDayRepair=fail,getScheduleRequestReceipt=fail;',
 'next/link':'import React from "react";export default function Link({children,...p}){return React.createElement("a",p,children)}',
 'next/navigation':'export const useSearchParams=()=>new URLSearchParams();',
};
async function bundle(before){
 const result=await esbuild.build({absWorkingDir:repo,entryPoints:[entry],bundle:true,write:false,minify:true,jsx:'automatic',tsconfigRaw:{compilerOptions:{baseUrl:repo,paths:{'@/*':['./src/*']},jsx:'react-jsx'}},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-preview',setup(b){
  b.onResolve({filter:/^(?:@\/app\/actions\/|@\/lib\/payroll\/readClient$|next\/)/},a=>{if(!stubs[a.path])throw Error('Unstubbed external import '+a.path);return {path:a.path,namespace:'fixture'};});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js',resolveDir:repo}));
  if(before)b.onLoad({filter:/(day-correction|batch-review)\.tsx$/},a=>{const file=path.relative(repo,a.path).replaceAll('\\','/');const r=spawnSync('git',['-c',`safe.directory=${repo.replaceAll('\\','/')}`,'show',`${baselineRef}:${file}`],{cwd:repo,windowsHide:true,encoding:'utf8'});assert.equal(r.status,0);return {contents:r.stdout,loader:'tsx',resolveDir:path.dirname(a.path)};});
 }}]});
 const css=await postcss([tailwind({content:[path.join(repo,'src/app/(ntg)/payroll/{provisional,attendance-source}/*.tsx'),entry],theme:{extend:{colors:{background:'#fff',foreground:'#111827',muted:{DEFAULT:'#f1f5f9',foreground:'#64748b'}}}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Provisional punch changes — fictional component ${before?'before':'after'}</title><style>${css.css}</style><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></html>`;
}
async function main(){
 fs.mkdirSync(out,{recursive:true});const before=await bundle(true),after=await bundle(false);
 fs.writeFileSync(path.join(out,'before.html'),before);fs.writeFileSync(path.join(out,'after.html'),after);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url.startsWith('/before')?before:after)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const width of [320,390,1280])for(const variant of ['before','after']){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   page.on('pageerror',e=>report.errors.push(e.message));
   await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
   const j={width,variant,events:[],explicitScrolls:0};report.journeys.push(j);
   await page.goto(url+'/'+variant);j.events.push({action:'direct navigation'});
   const action=page.getByRole('combobox',{name:/^Change IN /}).last();await action.waitFor();
   await action.scrollIntoViewIfNeeded();j.explicitScrolls++;j.events.push({action:'scrollIntoView shortcut',target:'last capture'});
   await action.focus();j.events.push({action:'focus shortcut',target:'last capture action'});
   await page.keyboard.press('ArrowDown');j.events.push({action:'key',key:'ArrowDown',purpose:'choose direction'});
   const edit=page.getByRole('region',{name:'Correct direction 2026-10-02',exact:true});await edit.waitFor();
   j.selectedText=await action.locator('option:checked').innerText();
   j.sameCaptureRow=await edit.evaluate(el=>!!el.closest('li[aria-label^="Saved punch"]'));
   j.proposalInitiallyVisible=await edit.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});
   if(variant==='after'){
    assert.equal(j.selectedText,'Changed to OUT');assert(j.sameCaptureRow);
    assert.equal(await page.getByRole('region',{name:'Add actual punch',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'SELECT','Selecting preserves keyboard focus');
   }else{assert.equal(j.selectedText,'Change this punch…');assert.equal(j.sameCaptureRow,false);}
   if(!j.proposalInitiallyVisible){await edit.scrollIntoViewIfNeeded();j.explicitScrolls++;j.events.push({action:'scrollIntoView shortcut',target:'pending edit'});}
   await edit.getByLabel('Direction',{exact:true}).waitFor();assert.equal(await edit.getByLabel('Direction',{exact:true}).inputValue(),'OUT');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
   await page.screenshot({path:path.join(out,`${variant}-${width}.png`),fullPage:true});
   const review=page.getByRole('button',{name:variant==='before'?'Review these changes':'Review 1 change',exact:true});
   const oldY=await page.evaluate(()=>scrollY);await review.click();j.events.push({action:'click',target:'Review',scrollDelta:await page.evaluate(()=>scrollY)-oldY});
   await page.getByRole('heading',{name:'Confirm this correction',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.punchPreview.previewState.calls.filter(x=>x.name==='confirm').length),0);
   await page.getByRole('button',{name:'Confirm correction',exact:true}).click();j.events.push({action:'click',target:'Confirm'});
   await page.getByRole('button',{name:'Make another correction',exact:true}).waitFor();
   const calls=await page.evaluate(()=>window.punchPreview.previewState.calls.map(x=>x.name));assert.equal(calls.filter(x=>x==='confirm').length,1);assert(calls.includes('saved'));j.verifiedOutcome='Fictional saved callback reached once after separate review and confirm';j.calls=calls;
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url+'/after');const action=page.getByRole('combobox',{name:/^Change IN /}).last();await action.waitFor();
  const state=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem(window.punchPreview.fixture.storage)));
  await action.selectOption('Direction');const id=(await state()).draft.changes[0].id;
  await action.selectOption('Direction');assert.equal((await state()).draft.changes.length,1);assert.equal((await state()).draft.changes[0].id,id);report.checks.push('Reselect preserves one stable edit');
  await action.selectOption('Time');assert.equal((await state()).draft.changes.length,2);assert.equal(await action.locator('option:checked').innerText(),'2 pending changes');
  await page.getByRole('region',{name:'Correct date/time 2026-10-02'}).getByLabel('Actual Philippine date and time',{exact:true}).fill('2026-10-02T17:05:30.123');
  await page.reload();await action.waitFor();assert.equal((await state()).draft.changes.find(x=>x.kind==='Time').at,'2026-10-02T17:05:30.123');report.checks.push('Combined direction/time and millisecond value survive reload');
  await page.getByRole('button',{name:'Review 2 changes',exact:true}).click();await page.getByRole('heading',{name:'Confirm this correction'}).waitFor();
  const direction=page.getByRole('region',{name:'Correct direction 2026-10-02',exact:true});await direction.getByText('Note and capture details',{exact:true}).click();await direction.getByLabel('Change note (optional)',{exact:true}).fill('Fictional retained note');
  assert.equal(await page.getByRole('heading',{name:'Confirm this correction'}).count(),0);report.checks.push('Editing optional note invalidates confirmation');
  await page.getByRole('button',{name:'Undo Correct date/time 2026-10-02',exact:true}).click();assert.equal((await state()).draft.changes[0].reason,'Fictional retained note');assert.equal((await state()).draft.changes.length,1);report.checks.push('Per-edit Undo retains other edit and note');
  await action.selectOption('Void');await action.selectOption('Restore');assert(!(await state()).draft.changes.some(x=>x.kind==='Void'));report.checks.push('Restore replaces competing pending Void');
  await page.getByRole('button',{name:'Undo all',exact:true}).click();assert.equal((await state()).draft,null);assert.equal(await action.locator('option:checked').innerText(),'Change this punch…');report.checks.push('Undo all returns to saved capture and empty draft');
  await page.getByRole('button',{name:'Add missing OUT',exact:true}).click();await page.getByRole('region',{name:'Add actual punch',exact:true}).getByLabel('Actual Philippine time',{exact:true}).fill('17:00:00');await page.getByRole('button',{name:'Review correction',exact:true}).click();await page.getByRole('heading',{name:'Confirm this correction'}).waitFor();
  assert(await page.getByRole('region',{name:'Add IN/OUT 2026-10-02',exact:true}).isVisible());report.checks.push('New manual punch remains editable in expanded additional changes');
  await page.getByRole('region',{name:'Add IN/OUT 2026-10-02',exact:true}).getByLabel('Actual Philippine date and time',{exact:true}).fill('');await page.getByRole('button',{name:'Review 1 change',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Confirm this correction'}).count(),0);report.checks.push('Missing actual time cannot produce confirmation');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>sessionStorage.clear());await page.reload();await action.waitFor();await action.selectOption('Direction');await page.getByRole('button',{name:'Review 1 change',exact:true}).click();await page.getByRole('heading',{name:'Confirm this correction'}).waitFor();
  await page.getByRole('button',{name:'Add missing OUT',exact:true}).click();assert(await page.getByRole('region',{name:'Add actual punch',exact:true}).isVisible());assert.equal(await page.getByRole('heading',{name:'Confirm this correction'}).count(),0);assert.equal((await state()).draft.changes.length,1);report.checks.push('Starting a new punch clears old confirmation and preserves existing draft');
  await context.close();
  assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 console.log(`PASS ${report.journeys.length} before/after journeys, ${report.checks.length} additional behavior checks; no production access`);
}
main().catch(e=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.txt'),e.stack||String(e));console.error('FAIL provisional punch UI; see '+out);process.exitCode=1});
