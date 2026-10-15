const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// Resolve the 9router Next.js chunks dir on any machine.
// Override with NINEROUTER_CHUNKS_DIR (full path) or NINEROUTER_ROOT (9router package dir).
function resolveChunksDir() {
  const candidates = [];
  if (process.env.NINEROUTER_CHUNKS_DIR) candidates.push(process.env.NINEROUTER_CHUNKS_DIR);
  if (process.env.NINEROUTER_ROOT) candidates.push(path.join(process.env.NINEROUTER_ROOT, "app/.next-cli-build/server/chunks"));
  candidates.push(
    "/opt/homebrew/lib/node_modules/9router/app/.next-cli-build/server/chunks", // macOS arm64 (Homebrew)
    "/usr/local/lib/node_modules/9router/app/.next-cli-build/server/chunks", // macOS intel / Linux
    "/usr/lib/node_modules/9router/app/.next-cli-build/server/chunks",
    path.join(os.homedir(), ".npm-global/lib/node_modules/9router/app/.next-cli-build/server/chunks"),
    path.join(os.homedir(), "AppData/Roaming/npm/node_modules/9router/app/.next-cli-build/server/chunks"), // Windows
  );
  try {
    const root = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (root) candidates.push(path.join(root, "9router/app/.next-cli-build/server/chunks"));
  } catch {}
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

const CHUNKS_DIR = resolveChunksDir();

if (!CHUNKS_DIR) {
  console.error("Chunks directory not found. Set NINEROUTER_CHUNKS_DIR=<9router>/app/.next-cli-build/server/chunks");
  process.exit(1);
}

console.log("Scanning chunks in", CHUNKS_DIR, "...");

const files = fs.readdirSync(CHUNKS_DIR).filter(f => f.endsWith(".js"));

let patchedCount = 0;

for (const file of files) {
  const filePath = path.join(CHUNKS_DIR, file);
  let content = fs.readFileSync(filePath, "utf8");
  let modified = false;

  // 1. Fix max_output_tokens clamp: [16, 65536]
  const clampCode = `"number"==typeof b.max_output_tokens&&(b.max_output_tokens<16?b.max_output_tokens=16:b.max_output_tokens>65536&&(b.max_output_tokens=65536))`;
  if (content.includes(`"number"==typeof b.max_output_tokens&&b.max_output_tokens<16&&(b.max_output_tokens=16)`)) {
    content = content.replace(
      `"number"==typeof b.max_output_tokens&&b.max_output_tokens<16&&(b.max_output_tokens=16)`,
      clampCode
    );
    console.log(`[FIX] Upgraded max_output_tokens to [16, 65536] clamp in ${file}`);
    modified = true;
  } else if (content.includes("delete b.max_tokens,delete b.max_completion_tokens,function(a,b){let c=b.reasoning")) {
    content = content.replace(
      "delete b.max_tokens,delete b.max_completion_tokens,function(a,b){let c=b.reasoning",
      `delete b.max_tokens,delete b.max_completion_tokens,${clampCode},function(a,b){let c=b.reasoning`
    );
    console.log(`[FIX] Added max_output_tokens [16, 65536] clamp in ${file}`);
    modified = true;
  }

  // 1b. Fix max_output_tokens in OpenCode Go executor
  const ocGoOld = "delete e.max_tokens,delete e.max_completion_tokens,void 0!==e.reasoning_effort";
  const ocGoNew = `delete e.max_tokens,delete e.max_completion_tokens,"number"==typeof e.max_output_tokens&&(e.max_output_tokens<16?e.max_output_tokens=16:e.max_output_tokens>65536&&(e.max_output_tokens=65536)),void 0!==e.reasoning_effort`;
  if (content.includes(ocGoOld)) {
    content = content.replace(ocGoOld, ocGoNew);
    console.log(`[FIX] Added max_output_tokens clamp in OpenCode Go in ${file}`);
    modified = true;
  }

  // 2. Fix the tool conditional skip bug in Responses API
  const oldCall = "Array.isArray(b.tools)&&0!==b.tools.length||w(b,!0)";
  if (content.includes(oldCall)) {
    content = content.replace(oldCall, "w(b,!0)");
    console.log(`[FIX] Fixed tool-skip bug in ${file}`);
    modified = true;
  }

  // 3. OpenCode tool schemas fix (8499.js / module 60210):
  // Upstream OpenCode expects real tool schemas and [shell, glob, grep, read] with strict: false.
  // When clients (like Claude) use 'bash', map it to 'shell', and inject valid schema definitions.
  const oldToolFunc = `let d=["bash","glob","grep","read"],e=new WeakMap;function f(a){let b=String(a??"").trim().toLowerCase();return d.includes(b)?b:""}`;
  const realR = `{glob:{description:\x27Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").\x27,parameters:{type:"object",properties:{pattern:{type:"string",description:"Glob pattern to match files against"},path:{type:"string",description:"Directory to search. Defaults to current directory."},hidden:{type:"boolean",description:"Include hidden files (default: false)."},limit:{type:"integer",description:"Max matches (default: 100)"}},required:["pattern"],additionalProperties:!1}},grep:{description:"Search file contents using ripgrep syntax.",parameters:{type:"object",properties:{pattern:{type:"string",minLength:1,description:"Regex pattern to match"},path:{type:"string",description:"File or directory to search"},include:{type:"string",description:"Glob filter"},literal:{type:"boolean",description:"Treat pattern as exact text"},caseSensitive:{type:"boolean",description:"Use case-sensitive matching"},limit:{type:"integer",description:"Max matches (default: 100)"}},required:["pattern"],additionalProperties:!1}},read:{description:"Read the contents of a file or directory.",parameters:{type:"object",properties:{path:{type:"string",description:"File or directory to read"},offset:{type:"integer",description:"Line to start reading from"},limit:{type:"integer",description:"Max lines to read"}},required:["path"],additionalProperties:!1}},shell:{description:"Execute a shell command and return its output.",parameters:{type:"object",properties:{command:{type:"string",description:"Shell command string to execute"},workdir:{type:"string",description:"Working directory"},timeout:{type:"integer",description:"Timeout in milliseconds"},background:{type:"boolean",description:"Run in background"}},required:["command"],additionalProperties:!1}}}`;
  const newToolFunc = `let d=["shell","glob","grep","read"],_R=${realR},e=new WeakMap;function f(a){let b=String(a??"").trim().toLowerCase();return"bash"===b?"shell":d.includes(b)?b:""}`;
  if (content.includes(oldToolFunc)) {
    content = content.replace(oldToolFunc, newToolFunc);
    console.log(`[FIX] Updated tool names to [shell, glob, grep, read] and added bash->shell mapping in ${file}`);
    modified = true;
  }
  const oldDummyInject = `c.push(b?{type:"function",name:a,description:"This tool is currently unavailable and must not be used.",parameters:{type:"object",properties:{}}}:{type:"function",function:{name:a,description:"This tool is currently unavailable and must not be used.",parameters:{type:"object",properties:{}}}})`;
  const newRealInject = `c.push(b?{type:"function",name:a,description:_R[a]?.description||a,parameters:_R[a]?.parameters||{type:"object",properties:{}},strict:!1}:{type:"function",function:{name:a,description:_R[a]?.description||a,parameters:_R[a]?.parameters||{type:"object",properties:{}},strict:!1}})`;
  if (content.includes(oldDummyInject)) {
    content = content.replace(oldDummyInject, newRealInject);
    console.log(`[FIX] Injected real quartet tool schemas with strict: false in ${file}`);
    modified = true;
  }

  // 4. Ensure forceStream: !0 on OpenCode provider registry
  const targetRegistry = `category:"free",noAuth:!0,transport:{baseUrl:"https://opencode.ai",headers:{"x-opencode-client":"desktop"},noAuth:!0}`;
  const replacementRegistry = `category:"free",noAuth:!0,transport:{baseUrl:"https://opencode.ai",forceStream:!0,headers:{"x-opencode-client":"desktop"},noAuth:!0}`;
  if (content.includes(targetRegistry)) {
    content = content.replace(targetRegistry, replacementRegistry);
    console.log(`[FIX] Added forceStream: true for OpenCode in ${file}`);
    modified = true;
  }

  // 5. Fallback rules: allow Combo to fallback on upstream 400 parameter / availability errors
  const oldFallback = `{text:"improperly formed request",cooldownMs:12e4}`;
  const newFallback = `{text:"improperly formed request",cooldownMs:12e4},{text:"invalid parameter",cooldownMs:3e4},{text:"upstream request failed",cooldownMs:3e4}`;
  if (content.includes(oldFallback) && !content.includes(`{text:"invalid parameter"`)) {
    content = content.replaceAll(oldFallback, newFallback);
    console.log(`[FIX] Added combo fallback rules for invalid parameters / upstream failures in ${file}`);
    modified = true;
  }

  // 6. Combo Runner fix in 8910.js: ALWAYS fallback to next model if not last model.
  // NOTE: the loop index is also named `b` and gets shadowed by the inner response
  // (`let b=await c(a,e)`), so `b<o.length-1` is always false. Capture the real index first.
  const comboLoopOld = `for(let b=0;b<o.length;b++){let e=o[b];g.info("COMBO",`;
  const comboLoopNew = `for(let b=0;b<o.length;b++){let e=o[b],_ci=b;g.info("COMBO",`;
  if (content.includes(comboLoopOld)) {
    content = content.replace(comboLoopOld, comboLoopNew);
    console.log(`[FIX] Captured combo loop index before shadowing in ${file}`);
    modified = true;
  }
  const badComboCond = `(0,d.hk)(b.status,f);if(!i&&b<o.length-1)i=!0;if(!i)return`;
  const goodComboCond = `(0,d.hk)(b.status,f);if(!i&&_ci<o.length-1)i=!0;if(!i)return`;
  if (content.includes(badComboCond)) {
    content = content.replace(badComboCond, goodComboCond);
    console.log(`[FIX] Fixed forced-fallback index (was shadowed) in ${file}`);
    modified = true;
  }
  const oldComboFallbackCheck = `let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);if(!i)return g.warn("COMBO",\`Model \${e} failed (no fallback)\`,{status:b.status}),b;`;
  const newComboFallbackCheck = `let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);if(!i&&_ci<o.length-1)i=!0;if(!i)return g.warn("COMBO",\`Model \${e} failed (no fallback)\`,{status:b.status}),b;`;
  if (content.includes(oldComboFallbackCheck)) {
    content = content.replace(oldComboFallbackCheck, newComboFallbackCheck);
    console.log(`[FIX] Patched combo runner to never abort prematurely when other models exist in ${file}`);
    modified = true;
  }

  // 7. OpenCode Responses API sanitizer & debug dumper in 318.js
  const oldToolNameExtract = `d=("string"==typeof a.name?a.name:"string"==typeof c?.name?c.name:"").trim()`;
  const newToolNameExtract = `d=("string"==typeof a.name?a.name:"string"==typeof c?.name?c.name:"").replace(/[^a-zA-Z0-9_-]/g,"_").trim()`;
  if (content.includes(oldToolNameExtract)) {
    content = content.replace(oldToolNameExtract, newToolNameExtract);
    console.log(`[FIX] Sanitized tool names regex in ${file}`);
    modified = true;
  }

  // 7b. Sanitize b.input: pair function_call & function_call_output, enforce correct message types, strip orphan outputs
  const oldInputFilter = `Array.isArray(b.input)&&(b.input=b.input.filter(a=>!!(!a||"object"!=typeof a||Array.isArray(a))||"reasoning"!==a.type&&((delete a.encrypted_content,delete a.reasoning_encrypted_content,"function_call"===a.type)?!!a.name&&"string"==typeof a.name&&""!==a.name.trim()&&(a.name=a.name.trim().slice(0,128),a.call_id=(0,n.N8)(a.call_id),a.arguments=(0,n.We)(a.arguments),!0):("function_call_output"===a.type&&(a.call_id=(0,n.N8)(a.call_id),a.output=(0,n.DP)(a.output)),!0)))),w(b,!0)`;
  const newInputFilter = `b.tool_choice="auto",delete b.messages,delete b.system,Array.isArray(b.input)&&(()=>{let cl=[],cb=new Map,ob=new Map;for(let a of b.input){if(!a||"object"!=typeof a||Array.isArray(a)||"reasoning"===a.type)continue;delete a.encrypted_content,delete a.reasoning_encrypted_content;if("message"===a.type){if("user"!==a.role&&"assistant"!==a.role)continue;if(!Array.isArray(a.content)||0===a.content.length)continue;let exp="user"===a.role?"input_text":"output_text",vc=[];for(let b of a.content){if(!b||"object"!=typeof b)continue;if("user"===a.role&&"input_image"===b.type)vc.push(b);else if("string"==typeof b.text&&b.text.length>0)vc.push({type:exp,text:b.text})}vc.length>0&&(a.content=vc,cl.push(a))}else if("function_call"===a.type){let name=("string"==typeof a.name?a.name:"").replace(/[^a-zA-Z0-9_-]/g,"_").trim().slice(0,128);if(!name)continue;a.name=name,a.call_id=(0,n.N8)(a.call_id),a.arguments=(0,n.We)(a.arguments);cb.set(a.call_id,a),cl.push(a)}else if("function_call_output"===a.type){a.call_id=(0,n.N8)(a.call_id),a.output=(0,n.DP)(a.output);ob.set(a.call_id,a),cl.push(a)}}let fi=[];for(let a of cl){if("function_call_output"===a.type){cb.has(a.call_id)&&fi.push(a)}else if("function_call"===a.type){fi.push(a);ob.has(a.call_id)||(fi.push({type:"function_call_output",call_id:a.call_id,output:"{}"}),ob.set(a.call_id,!0))}else fi.push(a)}b.input=fi.length>0?fi:[{type:"message",role:"user",content:[{type:"input_text",text:"..."}]}];})(),w(b,!0)`;
  if (content.includes(oldInputFilter)) {
    content = content.replace(oldInputFilter, newInputFilter);
    console.log(`[FIX] Replaced b.input filter with robust Responses API sanitizer (0.5.91) in ${file}`);
    modified = true;
  }
  const oldInputFilter95 = `Array.isArray(b.input)&&(b.input=b.input.filter(a=>!!(!a||"object"!=typeof a||Array.isArray(a))||"reasoning"!==a.type&&((delete a.encrypted_content,delete a.reasoning_encrypted_content,"function_call"===a.type)?!!a.name&&"string"==typeof a.name&&""!==a.name.trim()&&(a.name=a.name.trim().slice(0,128),a.call_id=(0,o.N8)(a.call_id),a.arguments=(0,o.We)(a.arguments),!0):("function_call_output"===a.type&&(a.call_id=(0,o.N8)(a.call_id),a.output=(0,o.DP)(a.output)),!0)))),(0,m.Ke)(b,!0)`;
  const newInputFilter95 = `b.tool_choice="auto",delete b.messages,delete b.system,Array.isArray(b.input)&&(()=>{let cl=[],cb=new Map,ob=new Map;for(let a of b.input){if(!a||"object"!=typeof a||Array.isArray(a)||"reasoning"===a.type)continue;delete a.encrypted_content,delete a.reasoning_encrypted_content;if("message"===a.type){if("user"!==a.role&&"assistant"!==a.role)continue;if(!Array.isArray(a.content)||0===a.content.length)continue;let exp="user"===a.role?"input_text":"output_text",vc=[];for(let b of a.content){if(!b||"object"!=typeof b)continue;if("user"===a.role&&"input_image"===b.type)vc.push(b);else if("string"==typeof b.text&&b.text.length>0)vc.push({type:exp,text:b.text})}vc.length>0&&(a.content=vc,cl.push(a))}else if("function_call"===a.type){let name=("string"==typeof a.name?a.name:"").replace(/[^a-zA-Z0-9_-]/g,"_").trim().slice(0,128);if(!name)continue;a.name=name,a.call_id=(0,o.N8)(a.call_id),a.arguments=(0,o.We)(a.arguments);cb.set(a.call_id,a),cl.push(a)}else if("function_call_output"===a.type){a.call_id=(0,o.N8)(a.call_id),a.output=(0,o.DP)(a.output);ob.set(a.call_id,a),cl.push(a)}}let fi=[];for(let a of cl){if("function_call_output"===a.type){cb.has(a.call_id)&&fi.push(a)}else if("function_call"===a.type){fi.push(a);ob.has(a.call_id)||(fi.push({type:"function_call_output",call_id:a.call_id,output:"{}"}),ob.set(a.call_id,!0))}else fi.push(a)}b.input=fi.length>0?fi:[{type:"message",role:"user",content:[{type:"input_text",text:"..."}]}];})(),(0,m.Ke)(b,!0)`;
  if (content.includes(oldInputFilter95)) {
    content = content.replace(oldInputFilter95, newInputFilter95);
    console.log(`[FIX] Replaced b.input filter with robust Responses API sanitizer (0.5.95) in ${file}`);
    modified = true;
  }

  // 7c. Instrument debug dump on failure in OpenCode execute()
  const oldExecute = `async execute(a){return super.execute({...a,credentials:this.prepareRequestCredentials(a)})}`;
  const newExecute = `async execute(a){let b=await super.execute({...a,credentials:this.prepareRequestCredentials(a)});if(!b.response.ok){try{const fs=require("fs");fs.writeFileSync("/tmp/last_opencode_failed_request.json",JSON.stringify(b.transformedBody,null,2));fs.writeFileSync("/tmp/last_opencode_failed_headers.json",JSON.stringify(b.headers,null,2));b.response.clone().text().then(t=>fs.writeFileSync("/tmp/last_opencode_failed_response.json",t)).catch(()=>{});}catch(e){}}return b;}`;
  if (content.includes(oldExecute)) {
    content = content.replace(oldExecute, newExecute);
    console.log(`[FIX] Added failure dumper to execute() in ${file}`);
    modified = true;
  }

  // 13. OpenCode FreeTierError fix (5330.js / 318.js):
  // OpenCode's new inference proxy validates the 6-byte timestamp encoded in
  // x-opencode-session (ses_<12-hex><14-base62>, descending ~(now*4096+counter))
  // and x-opencode-request (msg_<12-hex><14-base62>, ascending now*4096+1).
  // 9Router's B() and opencode-req hashed conversation/prompt strings with SHA-256
  // and put raw hash bytes into the 12-hex timestamp prefix, causing 403 FreeTierError.
  const oldOcSesB = `function B(a,b=""){if("string"==typeof a&&s.test(a.trim()))return a.trim();let c=e().createHash("sha256").update(\`opencode\\0\${b||"generic"}\\0\${a||""}\`).digest(),d=c.subarray(0,6).toString("hex"),f="";for(let a=6;a<20;a++)f+=u[c[a]%62];return\`ses_\${d}\${f}\`}`;
  const newOcSesB = `function B(a,b=""){if("string"==typeof a&&s.test(a.trim()))return a.trim();let k=\`opencode:b:\${b||"generic"}:\${a||""}\`,l=D.get(k);if(l)return l.lastUsed=Date.now(),D.delete(k),D.set(k,l),l.sessionId;let c=e().createHash("sha256").update(\`opencode\\0\${b||"generic"}\\0\${a||""}\`).digest(),n=Date.now();n!==x&&(x=n,y=0),y++;let t=~(4096n*BigInt(n)+BigInt(y)),d=Array.from({length:6},(a,b)=>Number(t>>BigInt(40-8*b)&255n).toString(16).padStart(2,"0")).join(""),f="";for(let a=6;a<20;a++)f+=u[c[a]%62];let m=\`ses_\${d}\${f}\`;return D.size>=1e3&&D.delete(D.keys().next().value),D.set(k,{sessionId:m,lastUsed:n}),m}`;
  if (content.includes(oldOcSesB)) {
    content = content.replace(oldOcSesB, newOcSesB);
    console.log(`[FIX] Fixed OpenCode x-opencode-session (ses_) descending timestamp encoding in ${file}`);
    modified = true;
  }
  const oldOcReqId = `let d=e().createHash("sha256").update(\`opencode-req\\0\${a||""}\\0\${c}\`).digest(),f=d.subarray(0,6).toString("hex"),g="";for(let a=6;a<20;a++)g+=u[d[a]%62];let h=\`msg_\${f}\${g}\`;return t.test(h)?h:A()`;
  const newOcReqId = `let d=e().createHash("sha256").update(\`opencode-req\\0\${a||""}\\0\${c}\`).digest(),f=Array.from({length:6},(a,b)=>Number((4096n*BigInt(Date.now())+1n)>>BigInt(40-8*b)&255n).toString(16).padStart(2,"0")).join(""),g="";for(let a=6;a<20;a++)g+=u[d[a]%62];let h=\`msg_\${f}\${g}\`;return t.test(h)?h:A()`;
  if (content.includes(oldOcReqId)) {
    content = content.replace(oldOcReqId, newOcReqId);
    console.log(`[FIX] Fixed OpenCode x-opencode-request (msg_) ascending timestamp encoding in ${file}`);
    modified = true;
  }
  const oldOcHdr18 = `"User-Agent":g?f:"opencode/1.18.31","x-opencode-client":e["x-opencode-client"]||"desktop","x-opencode-session":h,"x-opencode-request":j`;
  const oldOcHdr19 = `"User-Agent":g?f:"opencode/1.19.0 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14","x-opencode-client":e["x-opencode-client"]||"desktop","x-opencode-session":h,"x-opencode-session-id":h,"x-opencode-request":j`;
  const newOcHdr = `"User-Agent":g?f:"opencode/latest/2.0.29/cli","x-opencode-client":e["x-opencode-client"]||"cli","x-opencode-session":h,"x-opencode-session-id":h,"x-session-affinity":h,"x-session-id":h,"x-opencode-request-id":j,"x-opencode-project":e["x-opencode-project"]||"global"`;
  if (content.includes(oldOcHdr18)) {
    content = content.replace(oldOcHdr18, newOcHdr);
    console.log(`[FIX] Updated OpenCode User-Agent to official CLI format (2.0.29) in ${file}`);
    modified = true;
  } else if (content.includes(oldOcHdr19)) {
    content = content.replace(oldOcHdr19, newOcHdr);
    console.log(`[FIX] Updated OpenCode User-Agent to official CLI format (2.0.29) in ${file}`);
    modified = true;
  }
  // Remove forbidden legacy header x-opencode-request if present
  const badReqHdr = `"x-opencode-request-id":j,"x-opencode-request":j,`;
  if (content.includes(badReqHdr)) {
    content = content.replace(badReqHdr, `"x-opencode-request-id":j,`);
    console.log(`[FIX] Stripped forbidden legacy x-opencode-request header in ${file}`);
    modified = true;
  }

  // 14. Route OpenCode to official inference endpoint (/inference/v1 instead of /zen/v1) and prompt_cache_key
  const oldBuildUrl = "buildUrl(a){let b=this.config.baseUrl;return H(a)?`${b}/zen/v1/responses`:w.has(G(a))?`${b}/zen/v1/messages`:`${b}/zen/v1/chat/completions`}";
  const newBuildUrl = "buildUrl(a){let b=this.config.baseUrl;return H(a)?`${b}/inference/v1/responses`:w.has(G(a))?`${b}/inference/v1/messages`:`${b}/inference/v1/chat/completions`}";
  if (content.includes(oldBuildUrl)) {
    content = content.replace(oldBuildUrl, newBuildUrl);
    console.log(`[FIX] Routed OpenCode to official /inference/v1 endpoint in ${file}`);
    modified = true;
  }
  const oldPromptCache = `b.stream=!0,b.store=!1,function(a){if(!Array.isArray(a.tools))`;
  const newPromptCache = `b.stream=!0,b.store=!1,b.prompt_cache_key=d?.[q]||B("generic"),function(a){if(!Array.isArray(a.tools))`;
  if (content.includes(oldPromptCache)) {
    content = content.replace(oldPromptCache, newPromptCache);
    console.log(`[FIX] Added prompt_cache_key session affinity in ${file}`);
    modified = true;
  }
  const intermediatePromptCache = `b.stream=!0,b.store=!1,c?.[q]&&(b.prompt_cache_key=c[q]),function(a){if(!Array.isArray(a.tools))`;
  if (content.includes(intermediatePromptCache)) {
    content = content.replace(intermediatePromptCache, newPromptCache);
    console.log(`[FIX] Corrected prompt_cache_key credentials parameter in ${file}`);
    modified = true;
  }

  // 8. Anthropic→OpenAI thinking-disabled mapping (8499.js): many OpenAI-format
  // providers (e.g. OpenCode free models) reject reasoning_effort="none", which makes
  // Claude Code's auto-mode classifier 400. "minimal" is accepted and equally fast.
  const oldNoneEffort = `case"openai":{if(i&&j){b.reasoning_effort="none";break}`;
  const newNoneEffort = `case"openai":{if(i&&j){b.reasoning_effort="minimal";break}`;
  if (content.includes(oldNoneEffort)) {
    content = content.replace(oldNoneEffort, newNoneEffort);
    console.log(`[FIX] Map thinking-disabled to "minimal" instead of unsupported "none" in ${file}`);
    modified = true;
  }

  // 9. Non-stream Anthropic conversion for forceStream providers (8895.js).
  // The `!stream && forceStream` branch accumulates the upstream stream into an
  // OpenAI chat.completion but never converts it to Anthropic. Claude Code's
  // auto-mode classifier is the only non-streaming caller, so it receives a body
  // it cannot parse → "auto mode classifier unavailable" (fail closed).
  const ccHelper = 'function _cc(a){if(!a?.choices?.[0])return a;let b=a.choices[0],c=b.message||{},e=[],g=c.reasoning_content||c.provider_specific_fields?.reasoning_content||"";g&&e.push({type:"thinking",thinking:g});if("string"==typeof c.content&&c.content.length>0)e.push({type:"text",text:c.content});for(let t of c.tool_calls||[]){let f=t.function||{};e.push({type:"tool_use",id:t.id||("toolu_"+Date.now()+"_"+e.length),name:f.name||t.name||"",input:function(a){if(!a)return{};if("object"==typeof a)return a;try{return JSON.parse(a)}catch{return{}}}(f.arguments||t.arguments)})}0===e.length&&e.push({type:"text",text:""});let h=a.usage||{},s0=b.finish_reason;return{id:String(a.id||("msg_"+Date.now())).replace(/^chatcmpl-/,""),type:"message",role:"assistant",model:a.model||"unknown",content:e,stop_reason:"tool_calls"===s0?"tool_use":"length"===s0?"max_tokens":"end_turn",stop_sequence:null,usage:{input_tokens:h.prompt_tokens||h.input_tokens||0,output_tokens:h.completion_tokens||h.output_tokens||0}}}';
  const ccAnchor = 'c.d(b,{I:()=>r,F:()=>q});';
  if (content.includes(ccAnchor) && !content.includes("function _cc(a)")) {
    content = content.replace(ccAnchor, ccAnchor + ccHelper);
    console.log(`[FIX] Injected OpenAI→Anthropic converter for non-stream path in ${file}`);
    modified = true;
  }
  const ccSiteResp = "JSON.stringify((0,g.HR)(c,B))";
  if (content.includes(ccSiteResp)) {
    content = content.replace(ccSiteResp, "JSON.stringify((0,g.HR)(b===j.h.CLAUDE?_cc(c):c,B))");
    console.log(`[FIX] Convert non-stream body to Anthropic (responses branch) in ${file}`);
    modified = true;
  }
  const ccSiteChat = "JSON.stringify((0,g.HR)(p,B))";
  if (content.includes(ccSiteChat)) {
    content = content.replace(ccSiteChat, "JSON.stringify((0,g.HR)(b===j.h.CLAUDE?_cc(p):p,B))");
    console.log(`[FIX] Convert non-stream body to Anthropic (chat branch) in ${file}`);
    modified = true;
  }

  // 10. Allow openai-responses → claude conversion in the streaming→JSON accumulator (8895.js)
  const oldRespCond = 'if(b===d.h.OPENAI&&c===d.h.CLAUDE)return function(a){if(!a?.choices?.[0])return a;';
  const newRespCond = 'if((b===d.h.OPENAI||b===d.h.OPENAI_RESPONSES)&&c===d.h.CLAUDE)return function(a){if(!a?.choices?.[0])return a;';
  if (content.includes(oldRespCond)) {
    content = content.replace(oldRespCond, newRespCond);
    console.log(`[FIX] Allow openai-responses→claude conversion in ${file}`);
    modified = true;
  }

  // 11. Non-stream Gemini/Antigravity/Vertex → Claude conversion in module 5016 (8895.js)
  const p11Target1 = 'if((b===d.h.OPENAI||b===d.h.OPENAI_RESPONSES)&&c===d.h.CLAUDE)return function(a){';
  const p11Replace1 = 'var _toClaude=function(a){';
  const p11Target2 = 'usage:{input_tokens:h.prompt_tokens||h.input_tokens||0,output_tokens:h.completion_tokens||h.output_tokens||0}}}(a);if(b===d.h.OPENAI)return a;';
  const p11Replace2 = 'usage:{input_tokens:h.prompt_tokens||h.input_tokens||0,output_tokens:h.completion_tokens||h.output_tokens||0}}};if((b===d.h.OPENAI||b===d.h.OPENAI_RESPONSES)&&c===d.h.CLAUDE)return _toClaude(a);if(b===d.h.OPENAI)return a;';
  const p11Target3 = 'e.thoughtsTokenCount>0&&(k.usage.completion_tokens_details={reasoning_tokens:e.thoughtsTokenCount})),k}';
  const p11Replace3 = 'e.thoughtsTokenCount>0&&(k.usage.completion_tokens_details={reasoning_tokens:e.thoughtsTokenCount})),c===d.h.CLAUDE?_toClaude(k):k}';
  if (content.includes(p11Target1) && content.includes(p11Target2) && content.includes(p11Target3)) {
    content = content.replace(p11Target1, p11Replace1).replace(p11Target2, p11Replace2).replace(p11Target3, p11Replace3);
    console.log(`[FIX] Added Gemini/Vertex→Claude non-stream conversion in ${file}`);
    modified = true;
  }

  // 12. Normalize tool call arguments (Bash -> command, Read/Edit/Write -> file_path, Glob/Grep -> pattern)
  // in 8499.js (streaming SSE) and 8895.js (non-streaming _toClaude)
  const p12_8499_t1 = 'e&&d.push({type:"content_block_delta",index:c.blockIndex,delta:{type:"input_json_delta",partial_json:e}}),d.push({type:"content_block_stop",index:c.blockIndex})';
  const p12_8499_r1 = 'let _fe=function(n,s){try{let o=JSON.parse(s);if(o&&"object"==typeof o&&!Array.isArray(o)){let l=(n||"").toLowerCase();if("bash"===l&&!o.command)o.command=o.cmd||o.script||o.command_line||o.input||o.code||"";else if(("read"===l||"fileread"===l)&&!o.file_path)o.file_path=o.path||o.filepath||o.file||"";else if(("edit"===l||"fileedit"===l)&&!o.file_path)o.file_path=o.path||o.filepath||o.file||"";else if(("write"===l||"filewrite"===l)&&!o.file_path)o.file_path=o.path||o.filepath||o.file||"";else if(("glob"===l||"globtool"===l)&&!o.pattern)o.pattern=o.glob||o.path||"*";else if(("grep"===l||"greptool"===l)&&!o.pattern)o.pattern=o.query||o.search||o.regex||"";return JSON.stringify(o)}}catch{}return s||"{}"}(c.name,e||"{}");d.push({type:"content_block_delta",index:c.blockIndex,delta:{type:"input_json_delta",partial_json:_fe}}),d.push({type:"content_block_stop",index:c.blockIndex})';
  if (content.includes(p12_8499_t1)) {
    content = content.replace(p12_8499_t1, p12_8499_r1);
    console.log(`[FIX] Added Bash/Tool streaming normalizer in ${file}`);
    modified = true;
  }
  const p12_8499_t2 = 'let a=function(a,b){try{let c=JSON.parse(b),d=a.startsWith(ae)?a.slice(ae.length):a;return"Read"===d';
  const p12_8499_r2 = 'let a=function(a,b){try{let c=JSON.parse(b),d=a.startsWith(ae)?a.slice(ae.length):a,l=(d||"").toLowerCase();if("bash"===l&&!c.command)c.command=c.cmd||c.script||c.command_line||c.input||c.code||"";else if(("read"===l||"fileread"===l)&&!c.file_path)c.file_path=c.path||c.filepath||c.file||"";else if(("edit"===l||"fileedit"===l)&&!c.file_path)c.file_path=c.path||c.filepath||c.file||"";else if(("write"===l||"filewrite"===l)&&!c.file_path)c.file_path=c.path||c.filepath||c.file||"";else if(("glob"===l||"globtool"===l)&&!c.pattern)c.pattern=c.glob||c.path||"*";else if(("grep"===l||"greptool"===l)&&!c.pattern)c.pattern=c.query||c.search||c.regex||"";return"Read"===d';
  if (content.includes(p12_8499_t2)) {
    content = content.replace(p12_8499_t2, p12_8499_r2);
    console.log(`[FIX] Added Bash/Tool response normalizer in ${file}`);
    modified = true;
  }
  const p12_8895_t3 = 'input:function(a){if(!a)return{};if("object"==typeof a)return a;try{return JSON.parse(a)}catch{return{}}}(b.arguments||a.arguments)';
  const p12_8895_r3 = 'input:function(n,a){let o=null;if(a&&"object"==typeof a)o=a;else try{o=JSON.parse(a)}catch{}o=o&&"object"==typeof o&&!Array.isArray(o)?o:{};let l=(n||"").toLowerCase();if("bash"===l&&!o.command)o.command=o.cmd||o.script||o.command_line||o.input||o.code||"";else if(("read"===l||"fileread"===l)&&!o.file_path)o.file_path=o.path||o.filepath||o.file||"";else if(("edit"===l||"fileedit"===l)&&!o.file_path)o.file_path=o.path||o.filepath||o.file||"";else if(("write"===l||"filewrite"===l)&&!o.file_path)o.file_path=o.path||o.filepath||o.file||"";else if(("glob"===l||"globtool"===l)&&!o.pattern)o.pattern=o.glob||o.path||"*";else if(("grep"===l||"greptool"===l)&&!o.pattern)o.pattern=o.query||o.search||o.regex||"";return o}(b.name||a.name||"",b.arguments||a.arguments)';
  if (content.includes(p12_8895_t3)) {
    content = content.replace(p12_8895_t3, p12_8895_r3);
    console.log(`[FIX] Added Bash/Tool non-stream normalizer in ${file}`);
    modified = true;
  }


  if (modified) {
    fs.writeFileSync(filePath, content, "utf8");
    execSync(`node -c ${filePath}`);
    console.log(`[SUCCESS] Patched & verified ${file}`);
    patchedCount++;
  }
}

console.log(`Done! ${patchedCount} files patched.`);
