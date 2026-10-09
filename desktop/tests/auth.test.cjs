const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateCallback,consumeResponse}=require('../auth.cjs');
test('OAuth callback binds state and issued client; never accepts dynamic client for exchange',()=>{
 const p={state:'known-state',clientId:null};
 assert.deepEqual(validateCallback(new URL('http://127.0.0.1/auth/callback?state=known-state&client_id=issued&code=one'),p),{clientId:'issued',code:'one'});
 for(const query of ['state=wrong&client_id=issued&code=one','state=known-state&client_id=dynamic_agent_client&code=one','state=known-state&client_id=issued','state=known-state&error=access_denied','state=中文中文中文中文中文&client_id=issued&code=one'])assert.throws(()=>validateCallback(new URL('http://127.0.0.1/auth/callback?'+query),p));
 assert.throws(()=>validateCallback(new URL('http://127.0.0.1/auth/callback?state=known-state&client_id=other&code=one'),{...p,clientId:'issued'}));
});
async function* stream(events,split=false){for(const e of events){const b=Buffer.from('data: '+JSON.stringify(e)+'\n\n');if(split){for(const byte of b)yield Uint8Array.of(byte);}else yield b;}}
test('SSE preserves Chinese across byte boundaries and requires completed response',async()=>{
 const result=await consumeResponse(stream([{type:'response.output_text.delta',delta:'你好，课堂'},{type:'response.completed',response:{status:'completed',usage:{input_tokens:2,output_tokens:4}}}],true));assert.equal(result.text,'你好，课堂');assert.equal(result.usage.output_tokens,4);
 for(const events of [[{type:'response.output_text.delta',delta:'partial'}],[{type:'response.incomplete'}],[{type:'response.completed',response:{status:'failed'}}]])await assert.rejects(()=>consumeResponse(stream(events)));
});
