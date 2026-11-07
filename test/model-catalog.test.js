import test from "node:test";
import assert from "node:assert/strict";
import { fetchModels } from "../extension/modelCatalog.js";
test("catalog normalizes endpoints, sends key only to configured origin and sorts unique IDs", async()=>{
  let request;
  const models=await fetchModels({provider:"openai",baseURL:"https://openrouter.ai/api/v1/chat/completions",apiKey:"test-key"},async(url,options)=>{
    request={url,options};return {ok:true,json:async()=>({data:[{id:"z",name:"Z model"},{id:"a"},{id:"z"},{name:"missing"},{id:42}]})};
  });
  assert.equal(request.url,"https://openrouter.ai/api/v1/models");assert.equal(request.options.headers.Authorization,"Bearer test-key");assert.equal(request.options.redirect,"error");assert.equal(request.options.credentials,"omit");
  assert.deepEqual(models,[{id:"a",name:"a"},{id:"z",name:"Z model"}]);
});
test("Zhida offers built-in tiers without sending any request",async()=>{
  assert.equal((await fetchModels({provider:"zhida"},()=>assert.fail())).length,3);
});
test("catalog rejects unsafe endpoints and explains unsupported API without exposing response secrets",async()=>{
  await assert.rejects(()=>fetchModels({baseURL:"http://example.com/v1",apiKey:"secret"},()=>assert.fail()),/HTTPS/);
  await assert.rejects(()=>fetchModels({apiKey:"secret"},async()=>({ok:false,status:404})),/手动/);
  await assert.rejects(()=>fetchModels({apiKey:"secret"},async()=>({ok:true,json:async()=>({data:[]})})),/未返回/);
  await assert.rejects(()=>fetchModels({apiKey:"secret"},async()=>({ok:true,json:async()=>({models:[]})})),/格式/);
});
