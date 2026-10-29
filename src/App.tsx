import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./styles.json";
type Job = { id:string; styleName:string; total:number; completed:number; status:string; images:string[]; error?:string };
const GROUPS: Record<string,string> = { all:"All styles", art:"Art & Animation", eras:"Time Travel", professional:"Photoshoots", social:"Social Studio" };
const NEW = ["acrylic","felt","tarot","marble"];
const VIEWS: Record<string,string> = { mixed:"Mixed", normal:"Portrait", closeup:"Close-up", wide:"Wide" };
export default function App(){
  const [theme,setTheme]=useState<"noir"|"ivory">("noir"); const [group,setGroup]=useState("all"); const [q,setQ]=useState("");
  const [style,setStyle]=useState(styles[0]); const [count,setCount]=useState(3); const [view,setView]=useState("mixed");
  const [details,setDetails]=useState(""); const [file,setFile]=useState<File|null>(null); const [preview,setPreview]=useState("");
  const [consent,setConsent]=useState(false); const [drag,setDrag]=useState(false);
  const [favs,setFavs]=useState<string[]>(()=>JSON.parse(localStorage.getItem("favs")||"[]"));
  const [jobs,setJobs]=useState<Job[]>([]); const [mock,setMock]=useState<boolean|null>(null); const [err,setErr]=useState("");
  const [lb,setLb]=useState<{imgs:string[];i:number}|null>(null); const studioRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{fetch("/api/connection").then(r=>r.json()).then(d=>setMock(d.mock)).catch(()=>{});},[]);
  useEffect(()=>{localStorage.setItem("favs",JSON.stringify(favs));},[favs]);
  useEffect(()=>{const t=setInterval(()=>fetch("/api/jobs").then(r=>r.json()).then(setJobs).catch(()=>{}),1000);return()=>clearInterval(t);},[]);
  useEffect(()=>{ if(!file) return setPreview(""); const u=URL.createObjectURL(file); setPreview(u); return()=>URL.revokeObjectURL(u); },[file]);
  useEffect(()=>{ const k=(e:KeyboardEvent)=>{ if(!lb) return; if(e.key==="Escape") setLb(null);
    if(e.key==="ArrowRight") setLb({...lb,i:(lb.i+1)%lb.imgs.length}); if(e.key==="ArrowLeft") setLb({...lb,i:(lb.i-1+lb.imgs.length)%lb.imgs.length}); };
    addEventListener("keydown",k); return()=>removeEventListener("keydown",k); },[lb]);
  const list=useMemo(()=>styles.filter(s=>(group==="all"||s.group===group)&&s.name.toLowerCase().includes(q.toLowerCase())),[group,q]);
  async function go(){ setErr(""); if(!file) return setErr("Please add a reference photo."); if(!consent) return setErr("Please confirm you have consent to use this photo.");
    const fd=new FormData(); fd.append("photo",file); fd.append("styleName",style.name); fd.append("styleId",style.id); fd.append("count",String(count)); fd.append("view",view); fd.append("details",details); fd.append("consent","true");
    const r=await fetch("/api/generate",{method:"POST",body:fd}); if(!r.ok) setErr((await r.json()).error); else document.getElementById("gallery")?.scrollIntoView({behavior:"smooth"}); }
  return <div className={"app "+theme}>
    <div className="aurora"/>
    <nav><div className="brand"><span className="mono">P</span>Persona <em>Studio</em></div>
      <div className="navr"><span className={"pill "+(mock?"warn":"ok")}><i/>{mock===null?"Connecting…":mock?"Preview mode":"Live studio"}</span>
      <button className="ghost" onClick={()=>setTheme(theme==="noir"?"ivory":"noir")}>{theme==="noir"?"Ivory":"Noir"}</button></div></nav>
    <header className="hero">
      <p className="eyebrow">The private portrait atelier</p>
      <h1>Your likeness,<br/><em>reimagined in art.</em></h1>
      <p className="lede">Twenty-nine curated styles, from oil and marble to editorial and royal India. Each portrait keeps your identity while the wardrobe, scene and mood change.</p>
      <div className="heroctas"><button className="gold" onClick={()=>studioRef.current?.scrollIntoView({behavior:"smooth"})}>Begin a session</button><a className="link" href="#gallery">View gallery →</a></div>
      <div className="stats"><div><b>29</b><span>Signature styles</span></div><div><b>5</b><span>Portraits per demo session</span></div><div><b>100%</b><span>Private gallery</span></div></div>
      <div className="herostack">{["oil","marble","tarot"].map((id,i)=><img key={id} src={`/thumbs/${id}.webp`} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src=`/previews/${id}.svg`}} style={{["--i" as any]:i}} alt=""/>)}</div>
    </header>
    <div className="hair"/>
    <main ref={studioRef}>
      <aside className="side"><p className="eyebrow">Collections</p>
        {Object.entries(GROUPS).map(([k,v])=><button key={k} className={"tab "+(group===k?"on":"")} onClick={()=>setGroup(k)}><span>{v}</span><small>{k==="all"?styles.length:styles.filter(s=>s.group===k).length}</small></button>)}
        <div className="search"><input placeholder="Search styles" value={q} onChange={e=>setQ(e.target.value)}/></div></aside>
      <section className="grid">{list.map((s,i)=><article key={s.id} style={{["--d" as any]:`${i*30}ms`}} className={"card "+(style.id===s.id?"sel":"")} onClick={()=>setStyle(s)}>
        <div className="thumb"><img src={`/thumbs/${s.id}.webp`} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src=`/previews/${s.id}.svg`}} alt="" loading="lazy"/>{NEW.includes(s.id)&&<b className="new">New</b>}
          <button className={"fav "+(favs.includes(s.id)?"on":"")} aria-label="Favourite" onClick={e=>{e.stopPropagation();setFavs(f=>f.includes(s.id)?f.filter(x=>x!==s.id):[...f,s.id]);}}>{favs.includes(s.id)?"♥":"♡"}</button></div>
        <div className="meta"><h4 title={s.name}>{s.name}</h4><small>{GROUPS[s.group]}</small></div></article>)}</section>
      <aside className="panel glass"><p className="eyebrow">Your session</p><h3>{style.name}</h3>
        <label className={"drop "+(drag?"drag ":"")+(preview?"has":"")} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);setFile(e.dataTransfer.files[0]??null);}}>
          {preview?<><img src={preview} alt=""/><span className="chg">Replace photo</span></>:<><span className="ic">＋</span><b>Add a reference photo</b><small>Drop or browse · JPG, PNG, WebP · one clear face</small></>}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
        <p className="lbl">Portraits</p><div className="seg">{[1,2,3,4,5].map(n=><button key={n} className={count===n?"on":""} onClick={()=>setCount(n)}>{n}</button>)}</div>
        <p className="lbl">Framing</p><div className="seg">{Object.entries(VIEWS).map(([v,l])=><button key={v} className={view===v?"on":""} onClick={()=>setView(v)}>{l}</button>)}</div>
        <p className="lbl">Creative direction</p><textarea placeholder="e.g. evening wear, soft candlelight" value={details} onChange={e=>setDetails(e.target.value)}/>
        <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span/>This is my photo, or I have the subject's consent.</label>
        {err&&<p className="err">{err}</p>}<button className="gold wide" onClick={go}>Create {count} portraits</button></aside>
    </main>
    <section id="gallery" className="gallery"><div className="ghead"><p className="eyebrow">Private gallery</p><h2>Your <em>portraits</em></h2></div>
      {!jobs.length&&<p className="empty">Your finished sessions will appear here.</p>}
      {jobs.map(j=><div key={j.id} className="job glass">
        <div className="jh"><div><h3>{j.styleName}</h3><small>{j.completed} of {j.total} · {j.status}</small></div>
          <div className="bar"><span style={{width:`${j.completed/j.total*100}%`}}/></div>
          <div className="acts">{j.status==="running"&&<button className="ghost" onClick={()=>fetch(`/api/jobs/${j.id}/cancel`,{method:"POST"})}>Cancel</button>}<button className="ghost" onClick={()=>fetch(`/api/jobs/${j.id}`,{method:"DELETE"})}>Delete</button></div></div>
        <div className="masonry">{j.images.map((src,i)=><figure key={i} onClick={()=>setLb({imgs:j.images,i})}><img src={src} alt=""/><figcaption>No. {String(i+1).padStart(2,"0")}</figcaption></figure>)}</div></div>)}</section>
    <footer><div className="hair"/><p>Persona Studio · Emerald Noir</p></footer>
    {lb&&<div className="lb" onClick={()=>setLb(null)}><button className="nav l" onClick={e=>{e.stopPropagation();setLb({...lb,i:(lb.i-1+lb.imgs.length)%lb.imgs.length});}}>‹</button>
      <img src={lb.imgs[lb.i]} onClick={e=>e.stopPropagation()} alt=""/>
      <button className="nav r" onClick={e=>{e.stopPropagation();setLb({...lb,i:(lb.i+1)%lb.imgs.length});}}>›</button>
      <div className="lbbar" onClick={e=>e.stopPropagation()}><span>{lb.i+1} / {lb.imgs.length}</span><a className="gold sm" href={lb.imgs[lb.i]} download={`portrait-${lb.i+1}`}>Download</a><button className="ghost" onClick={()=>setLb(null)}>Close</button></div></div>}
  </div>;
}
