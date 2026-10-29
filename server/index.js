// Backend: holds the image-provider key server-side only. Key comes from env, never from the browser.
import express from "express"; import multer from "multer"; import { randomUUID } from "crypto"; import { readFileSync, existsSync } from "fs";
const app = express(); const upload = multer({ limits: { fileSize: 5e6, files: 1 } });
const KEY = process.env.OPENAI_API_KEY; const MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const MOCK = !KEY; const jobs = new Map();
const FRAMING = { normal:"head and shoulders", closeup:"tight close-up on the face", wide:"three-quarter body with environment" };
const prompt = (style, i, view, details) => `Photoreal-likeness portrait in ${style} style. Keep the person's identity, face structure, age, ethnicity and skin tone. Variation #${i+1}: change outfit, scene, expression, hair and head angle. Framing: ${view==="mixed"?Object.values(FRAMING)[i%3]:FRAMING[view]}. ${details||""}`;
function mockImage(styleId, style, i){
  const f=`public/previews/${styleId}.svg`; const base=existsSync(f)?readFileSync(f,"utf8"):"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 500'><rect width='400' height='500' fill='#0f3b2e'/></svg>";
  const h=[500,600,440,560,520][i%5]; const tf=`public/thumbs/${styleId}.webp`; const inner=existsSync(tf)?`<image href="data:image/webp;base64,${readFileSync(tf).toString("base64")}" x="0" y="0" width="400" height="500" preserveAspectRatio="xMidYMid slice"/>`:base.replace(/<svg[^>]*>/,"").replace("</svg>","");
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="${h}" viewBox="0 0 400 ${h}"><filter id="t"><feColorMatrix type="hueRotate" values="${(i*23)%60-30}"/></filter><svg x="0" y="0" width="400" height="${h}" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><g filter="url(#t)">${inner}</g></svg><rect x="10" y="10" width="380" height="${h-20}" fill="none" stroke="#d8bf86" stroke-opacity=".55"/><text x="200" y="${h-26}" fill="#f3e6c4" font-family="Georgia,serif" font-size="15" letter-spacing="3" text-anchor="middle">MOCK · ${style.toUpperCase()} · ${i+1}</text></svg>`;
  return "data:image/svg+xml;base64,"+Buffer.from(svg).toString("base64"); }
async function realImage(buf, mime, p){
  const fd = new FormData(); fd.append("model", MODEL); fd.append("prompt", p); fd.append("quality","medium"); fd.append("size","1024x1536"); fd.append("image", new Blob([buf],{type:mime}), "ref.png");
  const r = await fetch("https://api.openai.com/v1/images/edits",{method:"POST",headers:{Authorization:`Bearer ${KEY}`},body:fd});
  if(!r.ok){console.error("image api",r.status,(await r.text()).slice(0,300)); throw new Error("Image service error "+r.status);} const j = await r.json(); return "data:image/png;base64,"+j.data[0].b64_json; }
async function run(job, file){ // one image at a time, cancellable
  for(let i=0;i<job.total;i++){ if(job.status==="cancelled") return;
    try{ job.images.push(MOCK ? (await new Promise(r=>setTimeout(r,400)), mockImage(job.styleId,job.styleName,i)) : await realImage(file.buffer,file.mimetype,prompt(job.styleName,i,job.view,job.details))); job.completed++; }
    catch(e){ job.error=String(e.message); } }
  job.status = job.status==="cancelled" ? "cancelled" : "completed"; }
const hits=new Map(); let demoUsed=0; const DEMO_TOTAL=Number(process.env.DEMO_TOTAL)||30; app.set("trust proxy",1);
app.use("/api",(q,s,n)=>{const k=q.ip,now=Date.now(),w=hits.get(k)?.filter(t=>now-t<60000)||[];const lim=q.method==="POST"&&q.path==="/generate"?5:120;
 const c=w.filter(t=>lim===5?true:true).length; if(q.method==="POST"&&q.path==="/generate"){const g=(hits.get(k+"g")||[]).filter(t=>now-t<3600000); if(g.length>=3) return s.status(429).json({error:"Demo limit reached — 3 sessions per hour from one connection. Please try again later."}); g.push(now); hits.set(k+"g",g);}
 if(w.length>=120) return s.status(429).json({error:"Too many requests"}); w.push(now); hits.set(k,w); n();});
app.get("/api/health",(_q,s)=>s.json({ok:true,mock:MOCK}));
app.get("/api/connection",(_q,s)=>s.json({mock:MOCK,model:MOCK?null:MODEL,demoRemaining:MOCK?null:DEMO_TOTAL-demoUsed,maxPerSession:5}));
app.post("/api/generate",upload.single("photo"),(q,s)=>{
  const count=Math.min(5,Math.max(1,Number(q.body.count)||1));
  if(!MOCK && demoUsed+count>DEMO_TOTAL) return s.status(429).json({error:"Demo limit reached — thanks for trying Persona Studio! The live demo has used its image allowance."});
  if(q.body.consent!=="true") return s.status(400).json({error:"Consent required"});
  if(!q.file||!/^image\/(jpeg|png|webp)$/.test(q.file.mimetype)) return s.status(400).json({error:"Upload a JPG, PNG or WebP photo"});
  const job={id:randomUUID(),styleName:q.body.styleName,styleId:q.body.styleId,view:q.body.view||"mixed",details:q.body.details,total:count,completed:0,status:"running",images:[],created:Date.now()};
  if(jobs.size>=60){const o=[...jobs.values()].sort((a,b)=>a.created-b.created)[0]; jobs.delete(o.id);} job.owner=q.ip; if(!MOCK) demoUsed+=count; jobs.set(job.id,job); run(job,q.file); s.status(202).json({id:job.id,total:count}); });
app.get("/api/jobs",(q,s)=>s.json([...jobs.values()].filter(j=>j.owner===q.ip).map(({owner,...j})=>j).sort((a,b)=>b.created-a.created)));
app.post("/api/jobs/:id/cancel",(q,s)=>{const j=jobs.get(q.params.id); if(j&&j.owner===q.ip&&j.status==="running") j.status="cancelled"; s.json({ok:true});});
app.delete("/api/jobs/:id",(q,s)=>{if(jobs.get(q.params.id)?.owner===q.ip) jobs.delete(q.params.id); s.json({ok:true});});
if(existsSync("dist")){app.use(express.static("dist")); app.get(/^(?!\/api).*/,(_q,s)=>s.sendFile(process.cwd()+"/dist/index.html"));}
app.use((e,_q,s,_n)=>s.status(e.code==="LIMIT_FILE_SIZE"?413:500).json({error:e.code==="LIMIT_FILE_SIZE"?"Photo too large (max 5 MB)":"Server error"}));
app.listen(Number(process.env.PORT)||8787,()=>console.log("API on :"+(process.env.PORT||8787)+", mode:",MOCK?"MOCK (set OPENAI_API_KEY for real images)":MODEL));
