import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const origin='http://127.0.0.1:3013';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3013'],{env:{...process.env,STORAGE_MODE:'demo',DATABASE_URL:'',VERCEL:'',ADMIN_PASSWORD:'audit-staff-password',DIRECTOR_PASSWORD:'audit-director-password',SESSION_SECRET:'audit-session-secret-for-local-test-only'},stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stderr.on('data',d=>process.stderr.write(d));
try {
  let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'isolated demo server started');
  const events=await (await fetch(origin+'/api/events')).json();
  const id=events.events[0].id;
  const pub=await (await fetch(origin+'/api/events/'+id)).json();
  assert.ok(!('audit' in pub));assert.ok(!('club' in pub));
  assert.equal((await fetch(origin+'/api/admin/events/'+id)).status,401);
  const login=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'audit-staff-password'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const patch={action:'rosters-import',csv:'teamId,captain,players\np1,,',revision:pub.revision,requestId:crypto.randomUUID(),reason:'audit'};
  assert.equal((await fetch(origin+'/api/events/'+id,{method:'PATCH',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(patch)})).status,403);
  assert.equal((await fetch(origin+'/api/events/'+id,{method:'PATCH',headers:{Origin:'https://invalid.example',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(patch)})).status,403);
  assert.equal((await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'null'})).status,400);
  assert.equal((await fetch(origin+'/?event='+id)).status,200);
  assert.equal((await fetch(origin+'/api/competitions')).status,200);
  console.log('Isolated production smoke passed: public data, login, staff authorization, origin protection, malformed login, page and catalog.');
} finally {child.kill();}
