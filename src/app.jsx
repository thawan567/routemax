import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_KEY;
const supabase  = createClient(SUPA_URL, SUPA_KEY);

// Auth helpers
const getSession  = async () => { const {data} = await supabase.auth.getSession(); return data.session; };
const getSupaUser = async () => { const s = await getSession(); return s?.user ?? null; };

const C = {
  bg:"#0A0A0A", surface:"#111111", card:"#171717",
  border:"#ffffff0d", borderHi:"#ffffff18",
  text:"#F2F2F2", muted:"#444", sub:"#777",
  yellow:"#FFD100", green:"#22C55E", red:"#EF4444", orange:"#FB923C", blue:"#60A5FA",
};
const MIN_WAGE = 7.50;
const WEAR_KM  = 0.20;

const fmtR  = (n) => "R$" + Math.abs(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtR0 = (n) => "R$" + Math.round(Math.abs(n)).toLocaleString("pt-BR");
const fmtK  = (n) => n >= 1000 ? "R$" + (n/1000).toFixed(1).replace(".0","") + "k" : fmtR0(n);
const fmtN  = (n) => n.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:1});

function getVerdict(vs, lucro) {
  if(lucro<0)  return {emoji:"😔",text:"Prejuízo hoje",          color:C.red   };
  if(vs<1)     return {emoji:"⚠️", text:"Abaixo do mínimo/hora", color:C.red   };
  if(vs<1.5)   return {emoji:"😐", text:"Dia fraco",             color:C.orange};
  if(vs<2.5)   return {emoji:"👍", text:"Acima da média",        color:C.yellow};
  return        {emoji:"🔥", text:"Dia excelente!",               color:C.green };
}

const CSS = `
  @keyframes spin      { to{transform:rotate(360deg)} }
  @keyframes fadeIn    { from{opacity:0}to{opacity:1} }
  @keyframes slideUp   { from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)} }
  @keyframes fromRight { from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:translateX(0)} }
  @keyframes fromLeft  { from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:translateX(0)} }
  @keyframes sheetUp   { from{transform:translateY(100%)}to{transform:translateY(0)} }
  @keyframes fadeUp    { from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)} }
  @keyframes costIn    { from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:translateX(0)} }
  .ovl-bg   { transition:opacity 0.72s ease; }
  .num-lift { transition:transform 0.72s cubic-bezier(0.2,0,0.2,1),opacity 0.35s ease; }
  .num-sz   { transition:font-size 0.72s cubic-bezier(0.2,0,0.2,1); }
  .ovl-list { transition:opacity 0.18s ease,transform 0.18s ease; }
  *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
  input[type=number]{-moz-appearance:textfield;}
`;

const loadUser    = () => { try{const s=localStorage.getItem("rm_user");    return s?JSON.parse(s):null;}catch{return null;} };
const loadEntries = () => { try{const s=localStorage.getItem("rm_entries"); return s?JSON.parse(s):[];  }catch{return [];  } };
const todayStr    = () => new Date().toISOString().split("T")[0];

// ── META: modelo { valor, dataInicio, dataLimite } ────────────────────────────
const loadGoal = () => {
  try {
    const s = localStorage.getItem("rm_goal");
    if(!s) return null;
    const parsed = JSON.parse(s);
    // Migração: formato antigo era só um número (valor da meta, mês corrente)
    if(typeof parsed === "number") {
      const now = new Date();
      const dim = new Date(now.getFullYear(), now.getMonth()+1, 0);
      dim.setHours(12,0,0,0);
      const ini = new Date(now.getFullYear(), now.getMonth(), 1);
      ini.setHours(12,0,0,0);
      return { valor: parsed, dataInicio: ini.toISOString(), dataLimite: dim.toISOString() };
    }
    return parsed;
  } catch { return null; }
};

const saveGoal = (goal) => localStorage.setItem("rm_goal", JSON.stringify(goal));

// ── SYNC: Supabase ↔ localStorage ────────────────────────────────────────────
const syncEntriesToSupabase = async (userId, entries) => {
  if(!entries.length) return;
  const rows = entries.map(e => ({
    user_id: userId, day: e.id,
    ganho: e.ganho, lucro: e.lucro,
    horas: e.horas||null, km: e.km||null,
    entregas: e.entregas||null,
    custos: { gasolina:e.gasolina, alimentacao:e.alimentacao, chip:e.chip, desgaste:e.desgaste },
    saved_at: e.savedAt||new Date().toISOString(),
  }));
  await supabase.from("entries").upsert(rows, { onConflict:"user_id,day" });
};

const fetchEntriesFromSupabase = async (userId) => {
  const { data, error } = await supabase.from("entries").select("*").eq("user_id", userId).order("day", { ascending:false });
  if(error || !data) return null;
  return data.map(r => ({
    id: r.day, ganho: r.ganho, lucro: r.lucro,
    horas: r.horas, km: r.km, entregas: r.entregas,
    gasolina: r.custos?.gasolina||0, alimentacao: r.custos?.alimentacao||0,
    chip: r.custos?.chip||0, desgaste: r.custos?.desgaste||0,
    totalCustos: (r.custos?.gasolina||0)+(r.custos?.alimentacao||0)+(r.custos?.chip||0)+(r.custos?.desgaste||0),
    porHora: r.horas>0 ? r.lucro/r.horas : 0,
    porEntrega: r.entregas>0 ? r.lucro/r.entregas : 0,
    projecaoMensal: r.lucro*26,
    vsMinimo: r.horas>0 ? (r.lucro/r.horas)/MIN_WAGE : 0,
    savedAt: r.saved_at,
  }));
};

const saveGoalToSupabase = async (userId, goal) => {
  await supabase.from("goals").delete().eq("user_id", userId);
  await supabase.from("goals").insert({
    user_id: userId, valor: goal.valor,
    data_inicio: goal.dataInicio, data_limite: goal.dataLimite,
  });
};

const fetchGoalFromSupabase = async (userId) => {
  const { data } = await supabase.from("goals").select("*").eq("user_id", userId).order("created_at", { ascending:false }).limit(1).maybeSingle();
  if(!data) return null;
  return { valor: data.valor, dataInicio: data.data_inicio, dataLimite: data.data_limite };
};

// ── FONTE ÚNICA: contagem de dias restantes ────────────────────────────────
// Inclui ambas as pontas. Se jaRegistrouHoje=true, hoje já foi aproveitado.
const diasRestantes = (hoje, dataLimite, jaRegistrouHoje) => {
  const h = new Date(hoje); h.setHours(0,0,0,0);
  const l = new Date(dataLimite); l.setHours(0,0,0,0);
  const total = Math.max(0, Math.round((l - h) / (1000*60*60*24)) + 1);
  return jaRegistrouHoje ? Math.max(0, total - 1) : total;
};

const getGoalProgress = (entries, goal) => {
  const hoje = new Date(); hoje.setHours(12,0,0,0);
  const hojeStr = hoje.toISOString().split('T')[0];
  const lim  = new Date(goal.dataLimite);
  const ini  = new Date(goal.dataInicio);

  const limStr = lim.toISOString().split('T')[0];
  const iniStr = ini.toISOString().split('T')[0];

  const periodEntries = entries.filter(e => e.id >= iniStr && e.id <= limStr);

  // Fonte única de verdade para o earned
  const earned = periodEntries.reduce((a, e) => a + Math.max(0, e.lucro), 0);

  // Já registrou hoje? (existe entrada com id = hojeStr dentro do período)
  const jaRegistrouHoje = periodEntries.some(e => e.id === hojeStr);

  // Fonte única de dias — usada para TODAS as métricas derivadas
  const dias = diasRestantes(hoje, lim, jaRegistrouHoje);

  // Métricas derivadas — sem arredondamento aqui, só na exibição
  const remaining    = Math.max(0, goal.valor - earned);
  const porDia       = dias > 0 ? remaining / dias : 0;
  const porSemana    = porDia * 7; // sempre derivado de porDia, nunca recalculado

  // porSemana só exibido se houver dias suficientes
  const weeklyNeeded = dias >= 7 ? porSemana : null;

  const pct = Math.min(100, (earned / goal.valor) * 100);

  return {
    earned, remaining, dias, porDia,
    weeklyNeeded, pct,
    dataLimite: lim,
    jaRegistrouHoje,
    days: periodEntries.length,
  };
};

const getStreak = (entries) => {
  const set=new Set(entries.map(e=>e.id));
  let s=0,i=0;
  while(true){const d=new Date();d.setDate(d.getDate()-i);if(set.has(d.toISOString().split("T")[0])){s++;i++;}else break;}
  return s;
};
const getLast7  = () => Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toISOString().split("T")[0];});
const dayLabel  = (s) => {const d=new Date(s+"T12:00:00");const t=new Date();t.setHours(12,0,0,0);if(d.toDateString()===t.toDateString())return"Hoje";return["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()];};
const dateLong  = (s) => new Date(s+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"numeric",month:"short"});

const getPeakStatus = () => {
  const now=new Date(), h=now.getHours(), dow=now.getDay();
  const isFriSat=dow===5||dow===6, isWeekend=dow===0||dow===6;
  if(isFriSat&&h>=19&&h<23)  return {level:"high",  icon:"🔥", title:"Pico máximo agora",    msg:"Sexta/sábado à noite — maior demanda da semana."};
  if(h>=18&&h<21)             return {level:"high",  icon:"🔥", title:"Horário do jantar",     msg:"Alta demanda agora. Vale a pena ligar o app."};
  if(h>=11&&h<14)             return {level:"medium",icon:"⚡", title:"Horário do almoço",     msg:"Boa demanda nesse horário."};
  if(isWeekend&&h>=11&&h<23) return {level:"medium",icon:"⚡", title:"Final de semana",        msg:"Demanda acima da média o dia todo."};
  if(h>=2&&h<7)               return {level:"low",   icon:"😴", title:"Baixa demanda",         msg:"Madrugada — poucos pedidos nesse horário."};
  return null;
};

function PeakAlert({status}) {
  if(!status) return null;
  const s={
    high:  {bg:"rgba(34,197,94,0.08)",  border:"rgba(34,197,94,0.22)",  color:C.green },
    medium:{bg:"rgba(255,209,0,0.07)",  border:"rgba(255,209,0,0.2)",   color:C.yellow},
    low:   {bg:"rgba(100,100,100,0.07)",border:"rgba(100,100,100,0.15)",color:C.muted },
  }[status.level];
  return (
    <div style={{background:s.bg,border:`1px solid ${s.border}`,borderRadius:12,padding:"11px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:20}}>{status.icon}</span>
      <div>
        <div style={{fontSize:11,fontWeight:800,color:s.color,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{status.title}</div>
        <div style={{fontSize:12,color:C.sub,lineHeight:1.5}}>{status.msg}</div>
      </div>
    </div>
  );
}

const getInsight = (entries) => {
  if(entries.length<2) return null;
  const byDow={};
  entries.forEach(e=>{const dow=new Date(e.id+"T12:00:00").getDay();if(!byDow[dow])byDow[dow]=[];byDow[dow].push(e.porHora);});
  const avgs=Object.entries(byDow).filter(([,v])=>v.length>=1).map(([k,v])=>({dow:+k,avg:v.reduce((a,b)=>a+b,0)/v.length}));
  if(avgs.length<2) return null;
  const best=avgs.reduce((a,b)=>a.avg>b.avg?a:b);
  const worst=avgs.reduce((a,b)=>a.avg<b.avg?a:b);
  const names=["domingos","segundas","terças","quartas","quintas","sextas","sábados"];
  const pct=Math.round(((best.avg-worst.avg)/worst.avg)*100);
  if(pct<10) return null;
  return `Seus ${names[best.dow]} rendem ${pct}% a mais que ${names[worst.dow]}.`;
};

// ── ÍCONES SVG CUSTOMIZADOS ───────────────────────────────────────────────────
const Ico = {
  hoje:(a)=>(
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.yellow:C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17" r="2.5"/>
      <circle cx="18.5" cy="17" r="2.5"/>
      <path d="M5.5 17h5l1.5-5h4.5l1 2.5M12 17l1.5-5M15.5 8l1.5 4"/>
      <path d="M8 12h2"/>
    </svg>
  ),
  historico:(a)=>(
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.yellow:C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 6"/>
      <polyline points="16 6 21 6 21 11"/>
    </svg>
  ),
  comparar:(a)=>(
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.yellow:C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="9" width="7" height="12" rx="1.5"/>
      <rect x="14" y="4" width="7" height="17" rx="1.5"/>
      <line x1="6.5" y1="9" x2="6.5" y2="6"/>
      <line x1="4.5" y1="6" x2="8.5" y2="6"/>
    </svg>
  ),
  perfil:(a)=>(
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.yellow:C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4C8 4 5 7 5 11v2h14v-2c0-4-3-7-7-7z"/>
      <path d="M5 13h14v1.5a2 2 0 01-2 2H7a2 2 0 01-2-2V13z"/>
      <line x1="9" y1="16.5" x2="9" y2="19"/>
      <line x1="15" y1="16.5" x2="15" y2="19"/>
      <line x1="5" y1="11" x2="9" y2="11"/>
    </svg>
  ),
};

const TAB_ORDER  = ["hoje","historico","comparar","perfil"];
const TAB_LABELS = {hoje:"Hoje",historico:"Dashboard",comparar:"Comparar",perfil:"Perfil"};

// ── META PROGRESS BAR ────────────────────────────────────────────────────────
function MetaProgressBar({goal, entries}) {
  if(!goal) return null;
  const p = getGoalProgress(entries, goal);
  const batida = p.pct >= 100;
  const fill = batida ? C.green : C.yellow;
  return (
    <div style={{display:"flex",alignItems:"center",gap:7,background:C.card,borderRadius:99,padding:"5px 10px 5px 5px",border:`1px solid ${C.border}`}}>
      {/* Ícone circular */}
      <div style={{width:20,height:20,borderRadius:"50%",background:fill,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span style={{fontSize:10}}>🎯</span>
      </div>
      {/* Barra */}
      <div style={{width:60,height:4,background:"#ffffff10",borderRadius:99,overflow:"hidden",flexShrink:0}}>
        <div style={{height:"100%",width:`${p.pct}%`,background:fill,borderRadius:99,transition:"width 0.4s ease"}}/>
      </div>
      {/* Texto */}
      <span style={{fontSize:10,fontWeight:700,color:batida?C.green:C.sub,whiteSpace:"nowrap",letterSpacing:"0.01em"}}>
        {fmtK(p.earned)} / {fmtK(goal.valor)}
      </span>
    </div>
  );
}

// ── TOPBAR ────────────────────────────────────────────────────────────────────
function TopBar({goal, entries}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 18px 14px",flexShrink:0}}>
      <div style={{fontSize:13,fontWeight:900,letterSpacing:"0.14em",color:C.yellow,textTransform:"uppercase"}}>RouteMax</div>
      <MetaProgressBar goal={goal} entries={entries}/>
    </div>
  );
}

// ── TABBAR ────────────────────────────────────────────────────────────────────
function TabBar({active,setActive}) {
  return (
    <div style={{display:"flex",background:"#0D0D0D",borderTop:`1px solid ${C.border}`,padding:"8px 0 calc(8px + env(safe-area-inset-bottom))",flexShrink:0}}>
      {TAB_ORDER.map(id=>{
        const a=active===id;
        return (
          <button key={id} onClick={()=>setActive(id)} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"6px 0",fontFamily:"inherit"}}>
            <span style={{transition:"transform 0.2s",transform:a?"scale(1.1)":"scale(1)",display:"flex"}}>{Ico[id](a)}</span>
            <span style={{fontSize:10,fontWeight:700,color:a?C.yellow:C.muted,transition:"color 0.2s"}}>{TAB_LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── AUTH SCREEN (Login / Signup / Onboarding local) ───────────────────────────
function AuthScreen({onComplete}) {
  const [mode, setMode]       = useState("choice"); // "choice" | "login" | "signup" | "local"
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const inp = {
    background:C.card, border:`1px solid ${C.borderHi}`, borderRadius:12,
    padding:"14px 16px", fontSize:16, color:C.text, outline:"none",
    fontFamily:"inherit", width:"100%", marginBottom:12,
  };
  const btn = (bg,color) => ({
    width:"100%", padding:"16px", background:bg, borderRadius:12,
    fontSize:15, fontWeight:900, color, border:"none", cursor:"pointer",
    fontFamily:"inherit", marginBottom:10, opacity: loading?0.6:1,
  });

  const handleSignup = async () => {
    if(!name.trim()||!email.trim()||!password.trim()) return setError("Preencha todos os campos.");
    setLoading(true); setError("");
    const {data, error:e} = await supabase.auth.signUp({ email: email.trim(), password });
    if(e) { setError(e.message); setLoading(false); return; }
    // Criar perfil na tabela profiles
    await supabase.from("profiles").insert({ id: data.user.id, name: name.trim() });
    onComplete({ name: name.trim(), email: email.trim(), supaId: data.user.id, isPro: false });
    setLoading(false);
  };

  const handleLogin = async () => {
    if(!email.trim()||!password.trim()) return setError("Preencha email e senha.");
    setLoading(true); setError("");
    const {data, error:e} = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if(e) { setError("Email ou senha incorretos."); setLoading(false); return; }
    const {data:prof} = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
    onComplete({ name: prof?.name||"Motoboy", email: email.trim(), supaId: data.user.id, isPro: prof?.is_pro||false });
    setLoading(false);
  };

  const handleLocal = () => {
    const n = name.trim()||"Motoboy";
    const u = { name:n, createdAt:new Date().toISOString() };
    localStorage.setItem("rm_user", JSON.stringify(u));
    onComplete(u);
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 28px",animation:"fadeIn 0.5s ease",fontFamily:"'Inter',system-ui,sans-serif",color:C.text}}>
      <style>{CSS}</style>
      <div style={{fontSize:13,fontWeight:900,letterSpacing:"0.14em",color:C.yellow,textTransform:"uppercase",marginBottom:36}}>RouteMax</div>

      {mode==="choice"&&(<>
        <div style={{fontSize:28,fontWeight:900,lineHeight:1.2,marginBottom:10,letterSpacing:"-0.5px"}}>Olá, motoboy! 👋</div>
        <p style={{fontSize:14,color:C.sub,lineHeight:1.7,marginBottom:36}}>Descubra quanto você realmente ganhou depois de descontar gasolina, alimentação e desgaste da moto.</p>
        <button style={btn(C.yellow,"#0A0A0A")} onClick={()=>setMode("signup")}>Criar conta grátis →</button>
        <button style={btn(C.card,C.text)} onClick={()=>setMode("login")}>Já tenho conta</button>
        <button style={{...btn("none",C.muted),border:`1px solid ${C.border}`,fontSize:13}} onClick={()=>setMode("local")}>Usar sem conta (só neste celular)</button>
      </>)}

      {mode==="signup"&&(<>
        <div style={{fontSize:22,fontWeight:900,marginBottom:6}}>Criar conta</div>
        <p style={{fontSize:13,color:C.sub,marginBottom:24}}>Seus dados ficam seguros na nuvem.</p>
        {error&&<div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,padding:"10px 14px",fontSize:13,color:C.red,marginBottom:12}}>{error}</div>}
        <input style={inp} placeholder="Seu nome" value={name} onChange={e=>setName(e.target.value)}/>
        <input style={inp} placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
        <input style={inp} placeholder="Senha (mín. 6 caracteres)" type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
        <button style={btn(C.yellow,"#0A0A0A")} onClick={handleSignup} disabled={loading}>{loading?"Criando conta…":"Criar conta →"}</button>
        <button style={{...btn("none",C.sub),fontSize:13}} onClick={()=>{setMode("choice");setError("");}}>← Voltar</button>
      </>)}

      {mode==="login"&&(<>
        <div style={{fontSize:22,fontWeight:900,marginBottom:6}}>Entrar</div>
        <p style={{fontSize:13,color:C.sub,marginBottom:24}}>Bem-vindo de volta!</p>
        {error&&<div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,padding:"10px 14px",fontSize:13,color:C.red,marginBottom:12}}>{error}</div>}
        <input style={inp} placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
        <input style={inp} placeholder="Senha" type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
        <button style={btn(C.yellow,"#0A0A0A")} onClick={handleLogin} disabled={loading}>{loading?"Entrando…":"Entrar →"}</button>
        <button style={{...btn("none",C.sub),fontSize:13}} onClick={()=>{setMode("choice");setError("");}}>← Voltar</button>
      </>)}

      {mode==="local"&&(<>
        <div style={{fontSize:22,fontWeight:900,marginBottom:6}}>Como você se chama?</div>
        <p style={{fontSize:13,color:C.sub,marginBottom:24,lineHeight:1.6}}>Sem conta, seus dados ficam só neste celular. Se trocar de aparelho, perde o histórico.</p>
        <input style={inp} placeholder="Ex: João" value={name} onChange={e=>setName(e.target.value)}/>
        <button style={btn(C.yellow,"#0A0A0A")} onClick={handleLocal}>Começar →</button>
        <button style={{...btn("none",C.sub),fontSize:13}} onClick={()=>setMode("choice")}>← Voltar</button>
      </>)}
    </div>
  );
}

// ── GOAL SECTION ─────────────────────────────────────────────────────────────
function fmtDateShort(d) {
  return `${d.getDate()}/${d.getMonth()+1}`;
}

function GoalDetail({goal, p, onClose}) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:60,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.75)"}}/>
      <div style={{position:"relative",background:C.surface,borderRadius:"20px 20px 0 0",display:"flex",flexDirection:"column",animation:"sheetUp 0.35s cubic-bezier(0.16,1,0.3,1)"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 0"}}>
          <div style={{width:36,height:4,borderRadius:99,background:C.border}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px 16px"}}>
          <div>
            <div style={{fontSize:10,color:C.sub,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>Meta — até {fmtDateShort(p.dataLimite)}</div>
            <div style={{fontSize:16,fontWeight:800,color:C.text}}>{fmtR0(goal.valor)}</div>
          </div>
          <button onClick={onClose} style={{background:C.card,border:"none",borderRadius:"50%",width:32,height:32,fontSize:18,color:C.sub,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        <div style={{padding:"0 18px 40px",display:"flex",flexDirection:"column",gap:8}}>
          {[
            {l:"💰 Conquistado",  v:fmtR0(p.earned), c:C.green},
            {l:"🎯 Faltam",       v:p.remaining>0?fmtR0(p.remaining):"Meta batida! 🏆", c:p.remaining>0?C.text:C.green},
            {l:"📅 Dias restantes", v:`${p.dias} ${p.dias===1?"dia":"dias"}`, c:C.text},
            ...(p.weeklyNeeded!==null
              ? [{l:"📆 Precisa por semana", v:fmtR0(p.weeklyNeeded), c:C.yellow}]
              : [{l:`📆 Precisa (${p.dias} ${p.dias===1?'dia restante':'dias restantes'})`, v:p.remaining>0?fmtR0(p.remaining):"—", c:C.yellow}]
            ),
            {l:"☀️ Precisa por dia", v:p.dias>0?fmtR0(p.porDia):"—", c:C.yellow},
          ].map((s,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.card,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`}}>
              <span style={{fontSize:13,color:C.sub}}>{s.l}</span>
              <span style={{fontSize:14,fontWeight:800,color:s.c}}>{s.v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoalSetup({onSave, initialValue, initialDate}) {
  const [input, setInput] = useState(initialValue?String(initialValue):"");
  const [endDate, setEndDate] = useState(initialDate||null);
  const [showCal, setShowCal] = useState(false);

  const today = new Date(); today.setHours(12,0,0,0);
  const defaultEnd = new Date(today.getFullYear(), today.getMonth()+1, 0); defaultEnd.setHours(12,0,0,0);
  const effectiveEnd = endDate || defaultEnd;

  const submit = () => {
    const v = parseFloat(input.replace(",","."));
    if(!v||v<=0) return;
    const ini = new Date(); ini.setHours(12,0,0,0);
    onSave({ valor:v, dataInicio:ini.toISOString(), dataLimite:effectiveEnd.toISOString() });
  };

  return (
    <div style={{background:C.card,borderRadius:14,padding:"16px",border:`1px solid ${C.borderHi}`,marginBottom:14}}>
      <div style={{fontSize:10,color:C.sub,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>meta</div>
      <p style={{fontSize:12,color:C.sub,marginBottom:12,lineHeight:1.5}}>Quanto você quer ganhar até quando?</p>

      <div style={{marginBottom:10}}>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:C.sub,pointerEvents:"none"}}>R$</span>
          <input type="number" inputMode="numeric" value={input} onChange={e=>setInput(e.target.value)} placeholder="Ex: 3000"
            style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 12px 11px 36px",fontSize:15,color:C.text,outline:"none",fontFamily:"inherit"}}/>
        </div>
      </div>

      <div style={{marginBottom:12}}>
        <button onClick={()=>setShowCal(true)} style={{width:"100%",padding:"11px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,color:endDate?C.text:C.sub,cursor:"pointer",fontFamily:"inherit",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{endDate?`Até ${fmtDateShort(effectiveEnd)}`:`Prazo padrão: até ${fmtDateShort(defaultEnd)}`}</span>
          <span style={{fontSize:11,color:C.yellow}}>escolher data</span>
        </button>
      </div>

      <button onClick={submit} style={{width:"100%",padding:"12px",background:C.yellow,borderRadius:10,fontSize:13,fontWeight:800,color:"#0A0A0A",border:"none",cursor:"pointer",fontFamily:"inherit"}}>Salvar meta</button>

      {showCal && (
        <MiniCalendar
          single
          onRangeSelect={(s,e)=>{ setEndDate(e); setShowCal(false); }}
          onClose={()=>setShowCal(false)}
        />
      )}
    </div>
  );
}

function GoalSection({goal, onGoalChange, entries}) {
  const [editing, setEditing] = useState(!goal);
  const [showDetail, setShowDetail] = useState(false);

  const handleSave = (newGoal) => {
    saveGoal(newGoal);
    onGoalChange(newGoal);
    setEditing(false);
  };

  if(editing || !goal) return (
    <GoalSetup
      onSave={handleSave}
      initialValue={goal?.valor}
      initialDate={goal?new Date(goal.dataLimite):null}
    />
  );

  const p = getGoalProgress(entries, goal);

  return (
    <>
      <div style={{background:C.card,borderRadius:14,padding:"14px 16px",border:`1px solid ${C.border}`,marginBottom:14}}>
        {/* Header discreto */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:10,color:C.sub,letterSpacing:"0.08em",textTransform:"uppercase"}}>meta — até {fmtDateShort(p.dataLimite)}</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:12,color:C.sub}}>{fmtR0(goal.valor)}</span>
            <button onClick={()=>setEditing(true)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 8px",fontSize:10,color:C.muted,cursor:"pointer",fontFamily:"inherit"}}>editar</button>
          </div>
        </div>

        {/* Barra amarelo → laranja */}
        <div style={{height:6,background:"#ffffff08",borderRadius:99,overflow:"hidden",marginBottom:6}}>
          <div style={{height:"100%",width:`${p.pct}%`,background:"linear-gradient(90deg, #FFD100, #FB923C)",borderRadius:99,transition:"width 0.5s ease"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginBottom:12}}>
          <span style={{color:C.yellow,fontWeight:700}}>{Math.round(p.pct)}% conquistado</span>
          <span>{p.dias} {p.dias===1?"dia restante":"dias restantes"}</span>
        </div>

        {/* Stats conquistado / faltam */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          <div style={{background:C.surface,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Conquistado</div>
            <div style={{fontSize:16,fontWeight:900,color:C.green}}>{fmtR0(p.earned)}</div>
          </div>
          <div style={{background:C.surface,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Faltam</div>
            <div style={{fontSize:16,fontWeight:900,color:p.remaining>0?C.text:C.green}}>{p.remaining>0?fmtR0(p.remaining):"Batida! 🏆"}</div>
          </div>
        </div>

        {/* Botão de detalhamento */}
        <button onClick={()=>setShowDetail(true)} style={{width:"100%",padding:"9px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,fontSize:12,fontWeight:600,color:C.sub,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          Ver detalhamento da meta
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {showDetail && <GoalDetail goal={goal} p={p} onClose={()=>setShowDetail(false)}/>}
    </>
  );
}

// ── TAB: HOJE ─────────────────────────────────────────────────────────────────
function TabHoje({entries,name,onRegister,goal,onGoalChange}) {
  const today=todayStr();
  const todayEntry=entries.find(e=>e.id===today);
  const last7=getLast7();
  const weekEntries=entries.filter(e=>last7.includes(e.id));
  const weekTotal=weekEntries.reduce((a,e)=>a+e.lucro,0);
  const weekCosts=weekEntries.reduce((a,e)=>a+e.totalCustos,0);
  const avgHora=weekEntries.length?weekEntries.reduce((a,e)=>a+e.porHora,0)/weekEntries.length:0;
  const insight=getInsight(entries);
  const verdict=todayEntry?getVerdict(todayEntry.vsMinimo,todayEntry.lucro):null;
  const peak=getPeakStatus();
  return (
    <div style={{padding:"4px 16px 28px"}}>
      <h1 style={{fontSize:22,fontWeight:900,margin:"4px 0 4px",letterSpacing:"-0.5px"}}>{todayEntry?`Boa, ${name}! 💪`:`Bora, ${name}! 👋`}</h1>
      <p style={{fontSize:13,color:C.sub,margin:"0 0 14px"}}>{todayEntry?"Resultado do seu dia":"Registra o dia de hoje"}</p>
      <PeakAlert status={peak}/>

      {todayEntry?(
        <div style={{background:C.card,borderRadius:16,padding:"20px 18px",marginBottom:14,border:`1px solid ${C.borderHi}`}}>
          <div style={{fontSize:10,color:C.sub,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Lucro real de hoje</div>
          <div style={{fontSize:48,fontWeight:900,color:C.green,letterSpacing:"-2px",lineHeight:1,marginBottom:10}}>{fmtR(todayEntry.lucro)}</div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:verdict.color+"18",border:`1px solid ${verdict.color}30`,borderRadius:99,padding:"5px 14px",marginBottom:14}}>
            <span>{verdict.emoji}</span><span style={{fontSize:12,fontWeight:700,color:verdict.color}}>{verdict.text}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{l:"Por hora",v:`${fmtR(todayEntry.porHora)}/h`},{l:"Custos",v:fmtR0(todayEntry.totalCustos)},{l:"Km",v:todayEntry.km?`${todayEntry.km}km`:"—"}].map((s,i)=>(
              <div key={i} style={{background:C.surface,borderRadius:8,padding:"8px 10px"}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>{s.l}</div>
                <div style={{fontSize:13,fontWeight:700,color:i===1?C.red:C.text}}>{s.v}</div>
              </div>
            ))}
          </div>
          <button onClick={onRegister} style={{marginTop:14,background:"none",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 14px",fontSize:12,color:C.sub,cursor:"pointer",fontFamily:"inherit"}}>Refazer o registro de hoje</button>
        </div>
      ):(
        <div onClick={onRegister} style={{background:`linear-gradient(135deg,${C.yellow},#FFB800)`,borderRadius:16,padding:"20px 18px",marginBottom:14,cursor:"pointer"}}>
          <div style={{fontSize:11,fontWeight:800,color:"#5A4500",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Ainda não registrado</div>
          <div style={{fontSize:18,fontWeight:900,color:"#0A0A0A",marginBottom:12}}>Registrar o dia de hoje</div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:"#0A0A0A",borderRadius:10,padding:"9px 16px"}}>
            <span style={{fontSize:13,fontWeight:800,color:C.yellow}}>Calcular agora</span>
            <span style={{color:C.yellow}}>→</span>
          </div>
        </div>
      )}

      {/* Stats da semana — 3 cards */}
      {weekEntries.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          <div style={{background:C.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.sub,marginBottom:4}}>Semana</div>
            <div style={{fontSize:18,fontWeight:900,color:C.green}}>{fmtR0(weekTotal)}</div>
          </div>
          <div style={{background:C.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.sub,marginBottom:4}}>Média/h</div>
            <div style={{fontSize:18,fontWeight:900,color:C.yellow}}>{fmtR(avgHora)}/h</div>
          </div>
          <div style={{background:C.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.sub,marginBottom:4}}>Custos</div>
            <div style={{fontSize:18,fontWeight:900,color:C.red}}>{fmtR0(weekCosts)}</div>
          </div>
        </div>
      )}

      {/* Meta do mês */}
      <GoalSection goal={goal} onGoalChange={onGoalChange} entries={entries}/>

      {/* Insight */}
      {insight&&(
        <div style={{background:"rgba(96,165,250,0.07)",border:"1px solid rgba(96,165,250,0.18)",borderRadius:12,padding:"13px 15px"}}>
          <div style={{fontSize:11,fontWeight:800,color:C.blue,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>💡 Insight</div>
          <div style={{fontSize:12,color:C.sub,lineHeight:1.6}}>{insight}</div>
        </div>
      )}

      {entries.length===0&&!todayEntry&&(
        <div style={{textAlign:"center",padding:"32px 0",color:C.muted,fontSize:13,lineHeight:1.8}}>Nenhum registro ainda.<br/>Registra o primeiro dia pra ver sua evolução.</div>
      )}
    </div>
  );
}

// ── MINI CALENDAR ────────────────────────────────────────────────────────────
function MiniCalendar({onRangeSelect, onClose, single}) {
  const today = new Date(); today.setHours(12,0,0,0);
  const [view, setView] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [start, setStart] = useState(null);
  const MONTHS=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const DAYS=["D","S","T","Q","Q","S","S"];
  const yr=view.getFullYear(), mo=view.getMonth();
  const firstDow=new Date(yr,mo,1).getDay();
  const dim=new Date(yr,mo+1,0).getDate();
  const mkDate=(day)=>{ const d=new Date(yr,mo,day); d.setHours(12,0,0,0); return d; };

  const click=(day)=>{
    const dt=mkDate(day);
    if(single){
      onRangeSelect(dt,dt); onClose();
      return;
    }
    if(!start){ setStart(dt); }
    else {
      const s=dt<start?dt:start, e=dt<start?start:dt;
      onRangeSelect(s,e); onClose();
    }
  };
  const isStart=(day)=>start&&mkDate(day).toDateString()===start.toDateString();
  const cells=[];
  for(let i=0;i<firstDow;i++) cells.push(null);
  for(let i=1;i<=dim;i++) cells.push(i);

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 24px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.borderHi}`,borderRadius:18,padding:16,width:"100%",maxWidth:300,boxShadow:"0 16px 48px rgba(0,0,0,0.85)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setView(new Date(yr,mo-1,1))} style={{background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:20,padding:"0 8px",lineHeight:1}}>‹</button>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>{MONTHS[mo]} {yr}</span>
          <button onClick={()=>setView(new Date(yr,mo+1,1))} style={{background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:20,padding:"0 8px",lineHeight:1}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:6}}>
          {DAYS.map((d,i)=><div key={i} style={{textAlign:"center",fontSize:10,color:C.muted,padding:"2px 0"}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {cells.map((day,i)=>{
            if(!day) return <div key={i}/>;
            const sel=isStart(day);
            return (
              <button key={i} onClick={()=>click(day)} style={{
                background:sel?C.yellow:"none", color:sel?"#0A0A0A":C.text,
                border:"none",borderRadius:7,padding:"7px 0",fontSize:13,
                fontWeight:sel?800:400,cursor:"pointer",fontFamily:"inherit",transition:"background 0.1s"
              }}>{day}</button>
            );
          })}
        </div>
        <div style={{marginTop:10,fontSize:12,color:C.sub,textAlign:"center"}}>
          {single?"Escolha a data limite":(!start?"Clique no dia inicial":"Agora clique no dia final")}
        </div>
        <button onClick={onClose} style={{width:"100%",marginTop:10,padding:"9px",background:"none",border:`1px solid ${C.border}`,borderRadius:10,fontSize:12,color:C.muted,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
      </div>
    </div>
  );
}

// ── DASHBOARD CHART ───────────────────────────────────────────────────────────
const CHART_ORANGE = "#FF8800";

function DashboardChart({points, labels, total}) {
  const [disp, setDisp] = useState(total);
  const prevRef = useRef(total);
  const rafRef  = useRef(null);

  useEffect(()=>{
    const from=prevRef.current, to=total;
    prevRef.current=total;
    if(from===to) return;
    cancelAnimationFrame(rafRef.current);
    const dur=1200, t0=performance.now();
    const tick=(now)=>{
      const p=Math.min((now-t0)/dur,1), ease=1-Math.pow(1-p,3);
      setDisp(from+(to-from)*ease);
      if(p<1) rafRef.current=requestAnimationFrame(tick);
      else setDisp(to);
    };
    rafRef.current=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(rafRef.current);
  },[total]);

  // Layout — viewBox fixa, padding generoso pros labels não cortarem
  const W=320, H=140;
  const PL=42,  // espaço p/ labels Y à esquerda
        PR=12,  // margem direita
        PT=12,  // topo
        PB=10;  // fundo (dentro do SVG, antes dos labels X)
  const cW=W-PL-PR, cH=H-PT-PB;

  const maxVal=Math.max(...points,1);
  const getStep=(m)=>m<=100?25:m<=300?50:m<=600?100:m<=1500?250:500;
  const step=getStep(maxVal);
  const yMax=Math.ceil(maxVal/step)*step;
  const yLabels=[];
  for(let v=0;v<=yMax;v+=step) yLabels.push(v);

  const xOf=(i)=>PL+(points.length>1?(i/(points.length-1))*cW:cW/2);
  const yOf=(v)=>PT+cH-Math.max(0,(v/yMax)*cH);

  const linePts=points.map((v,i)=>`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const areaPts=points.length>0
    ?`${xOf(0).toFixed(1)},${(PT+cH).toFixed(1)} `
      +points.map((v,i)=>`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
      +` ${xOf(points.length-1).toFixed(1)},${(PT+cH).toFixed(1)}`
    :'';

  return (
    <div>
      <div style={{fontSize:10,color:C.sub,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>
        Faturamento total
      </div>
      <div style={{fontSize:30,fontWeight:900,color:C.green,letterSpacing:"-1px",marginBottom:16,fontVariantNumeric:"tabular-nums"}}>
        {fmtR(disp)}
      </div>

      {/* Box do gráfico */}
      <div style={{background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,padding:"14px 10px 0 0"}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
          <defs>
            <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CHART_ORANGE} stopOpacity="0.35"/>
              <stop offset="100%" stopColor={C.yellow}      stopOpacity="0.04"/>
            </linearGradient>
          </defs>

          {/* Grid lines + Y labels */}
          {yLabels.map((v,i)=>{
            const y=yOf(v);
            return (
              <g key={i}>
                {/* Grid line de ponta a ponta do chart area */}
                <line
                  x1={PL} y1={y} x2={W-PR} y2={y}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="1"
                  strokeDasharray={v===0?"none":"4 4"}
                />
                {/* Label Y — alinhado à direita dentro do padding esquerdo */}
                <text
                  x={PL-6} y={y+4}
                  textAnchor="end"
                  fontSize="9"
                  fill="rgba(255,255,255,0.3)"
                  fontFamily="Inter,system-ui,sans-serif"
                  fontWeight="500"
                >
                  {v>=1000?`${(v/1000).toFixed(v%1000===0?0:1)}k`:v}
                </text>
              </g>
            );
          })}

          {/* Linha vertical do eixo Y */}
          <line x1={PL} y1={PT} x2={PL} y2={PT+cH} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>

          {/* Area fill */}
          {areaPts&&<polygon points={areaPts} fill="url(#og)"/>}

          {/* Linha do gráfico */}
          {points.length>1&&(
            <polyline
              points={linePts}
              fill="none"
              stroke={CHART_ORANGE}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Pontos */}
          {points.map((v,i)=>v>0?(
            <circle
              key={i}
              cx={xOf(i)} cy={yOf(v)}
              r="4"
              fill={CHART_ORANGE}
              stroke={C.surface}
              strokeWidth="2"
            />
          ):null)}
        </svg>

        {/* Labels X — alinhadas com os pontos do SVG */}
        <div style={{
          display:"flex",
          paddingLeft:PL,
          paddingRight:PR,
          paddingBottom:10,
          paddingTop:6,
        }}>
          {labels.map((l,i)=>(
            <div key={i} style={{
              flex:1,
              textAlign:"center",
              fontSize:9,
              fontWeight:500,
              color:"rgba(255,255,255,0.28)",
              overflow:"hidden",
              textOverflow:"ellipsis",
              whiteSpace:"nowrap"
            }}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── TAB: DASHBOARD (antigo Histórico) ─────────────────────────────────────────
function TabHistorico({entries, onSelectEntry}) {
  const [filter,   setFilter]      = useState('7d');
  const [custom,   setCustom]      = useState({start:null,end:null});
  const [showCal,  setShowCal]     = useState(false);

  const applyFilter=(fid)=>{ setFilter(fid); setShowCal(false); };

  const getFiltered=()=>{
    if(filter==='custom'&&custom.start&&custom.end){
      return entries.filter(e=>{ const d=new Date(e.id+'T12:00:00'); return d>=custom.start&&d<=custom.end; });
    }
    if(filter==='all') return entries;
    const days={'7d':7,'14d':14,'30d':30}[filter]||7;
    const cut=new Date(); cut.setDate(cut.getDate()-days+1); cut.setHours(0,0,0,0);
    return entries.filter(e=>new Date(e.id+'T12:00:00')>=cut);
  };

  const getChartData=()=>{
    const map=Object.fromEntries(entries.map(e=>[e.id,e]));
    if(filter==='custom'&&custom.start&&custom.end){
      const diffDays=Math.round((custom.end-custom.start)/(1000*60*60*24));
      if(diffDays===0){
        const str=custom.start.toISOString().split('T')[0];
        const entry=map[str];
        const hrs=['00h','03h','06h','09h','12h','15h','18h','21h'];
        return {labels:hrs, values:hrs.map((_,i)=>i===6&&entry&&entry.lucro>0?entry.lucro:0)};
      }
      const days=[], cur=new Date(custom.start);
      while(cur<=custom.end){
        const s=cur.toISOString().split('T')[0];
        days.push({label:`${cur.getDate()}/${cur.getMonth()+1}`,value:map[s]?.lucro>0?map[s].lucro:0});
        cur.setDate(cur.getDate()+1);
      }
      if(days.length>14){
        const st=Math.ceil(days.length/14);
        const sam=days.filter((_,i)=>i%st===0||i===days.length-1);
        return {labels:sam.map(d=>d.label),values:sam.map(d=>d.value)};
      }
      return {labels:days.map(d=>d.label),values:days.map(d=>d.value)};
    }
    if(filter==='all'){
      if(!entries.length) return {labels:[],values:[]};
      const months={};
      entries.forEach(e=>{ const ym=e.id.slice(0,7); if(!months[ym])months[ym]=0; months[ym]+=Math.max(0,e.lucro); });
      const sorted=Object.entries(months).sort(([a],[b])=>a.localeCompare(b));
      const MN=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      return {labels:sorted.map(([k])=>MN[+k.split('-')[1]-1]),values:sorted.map(([,v])=>v)};
    }
    const days={'7d':7,'14d':14,'30d':30}[filter]||7;
    const result=[];
    for(let i=days-1;i>=0;i--){
      const d=new Date(); d.setDate(d.getDate()-i);
      const s=d.toISOString().split('T')[0];
      result.push({label:dayLabel(s),value:map[s]&&map[s].lucro>0?map[s].lucro:0});
    }
    return {labels:result.map(r=>r.label),values:result.map(r=>r.value)};
  };

  const filtered=getFiltered();
  const chartData=getChartData();
  const total=filtered.reduce((a,e)=>a+Math.max(0,e.lucro),0);
  const FILTERS=[{id:'7d',label:'7 dias'},{id:'14d',label:'14 dias'},{id:'30d',label:'30 dias'},{id:'all',label:'Tudo'}];
  const isCustom=filter==='custom'&&custom.start;

  return (
    <div style={{padding:"4px 16px 28px"}}>
      <h1 style={{fontSize:22,fontWeight:900,margin:"4px 0 18px",letterSpacing:"-0.5px"}}>Dashboard</h1>

      {entries.length===0?(
        <div style={{textAlign:"center",padding:"48px 0",color:C.muted,fontSize:13,lineHeight:1.8}}>Nenhum registro ainda.<br/>Registra o primeiro dia pra começar.</div>
      ):(
        <>
          {/* Filtros */}
          <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center",overflowX:"auto",paddingBottom:2,position:"relative"}}>
            {FILTERS.map(f=>(
              <button key={f.id} onClick={()=>applyFilter(f.id)} style={{
                flexShrink:0,padding:"6px 13px",borderRadius:99,fontSize:11,fontWeight:700,
                background:filter===f.id&&!isCustom?"rgba(255,209,0,0.14)":"none",
                color:filter===f.id&&!isCustom?C.yellow:C.muted,
                border:`1px solid ${filter===f.id&&!isCustom?C.yellow:C.border}`,
                cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"
              }}>{f.label}</button>
            ))}
            <div style={{position:"relative",flexShrink:0}}>
              <button onClick={()=>setShowCal(v=>!v)} style={{
                padding:"6px 13px",borderRadius:99,fontSize:11,fontWeight:700,
                background:isCustom?"rgba(255,209,0,0.14)":"none",
                color:isCustom?C.yellow:C.muted,
                border:`1px solid ${isCustom?C.yellow:C.border}`,
                cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"
              }}>
                {isCustom&&custom.end
                  ?`${custom.start.getDate()}/${custom.start.getMonth()+1} → ${custom.end.getDate()}/${custom.end.getMonth()+1}`
                  :"Escolher data"}
              </button>
              {showCal&&(
                <MiniCalendar
                  onRangeSelect={(s,e)=>{ setCustom({start:s,end:e}); setFilter('custom'); setShowCal(false); }}
                  onClose={()=>setShowCal(false)}
                />
              )}
            </div>
          </div>

          {/* Gráfico */}
          <div style={{marginBottom:20}}>
            <DashboardChart points={chartData.values} labels={chartData.labels} total={total}/>
          </div>

          {/* Lista */}
          <div style={{fontSize:10,fontWeight:700,color:C.sub,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Histórico</div>
          {filtered.length===0?(
            <div style={{textAlign:"center",padding:"20px 0",color:C.muted,fontSize:13}}>Nenhum registro no período.</div>
          ):filtered.slice(0,50).map((e,i)=>{
            const v=getVerdict(e.vsMinimo,e.lucro);
            return (
              <div key={i} onClick={()=>onSelectEntry(e)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.card,borderRadius:12,padding:"13px 14px",marginBottom:8,border:`1px solid ${C.border}`,cursor:"pointer"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:3}}>{dateLong(e.id)}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:10}}>{v.emoji}</span><span style={{fontSize:11,color:C.sub}}>{fmtN(e.horas)}h · {e.entregas||0} entregas</span></div>
                </div>
                <div style={{textAlign:"right",display:"flex",alignItems:"center",gap:10}}>
                  <div>
                    <div style={{fontSize:16,fontWeight:900,color:e.lucro>=0?C.green:C.red}}>{fmtR0(e.lucro)}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>{fmtR(e.porHora)}/h</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── DAY DETAIL SHEET ──────────────────────────────────────────────────────────
function DayDetail({entry,onClose}) {
  const verdict=getVerdict(entry.vsMinimo,entry.lucro);
  const lucroColor=entry.lucro<0?C.red:C.green;
  const horaColor=entry.vsMinimo<1?C.red:entry.vsMinimo<2?C.orange:C.yellow;
  const barPct=Math.min(100,Math.max(2,(entry.vsMinimo/4)*100));
  return (
    <div style={{position:"fixed",inset:0,zIndex:60,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.75)"}}/>
      <div style={{position:"relative",background:C.surface,borderRadius:"20px 20px 0 0",maxHeight:"90vh",display:"flex",flexDirection:"column",animation:"sheetUp 0.35s cubic-bezier(0.16,1,0.3,1)"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 0"}}>
          <div style={{width:36,height:4,borderRadius:99,background:C.border}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px 8px"}}>
          <div>
            <div style={{fontSize:11,color:C.sub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Detalhamento</div>
            <div style={{fontSize:16,fontWeight:800,color:C.text}}>{dateLong(entry.id)}</div>
          </div>
          <button onClick={onClose} style={{background:C.card,border:"none",borderRadius:"50%",width:32,height:32,fontSize:18,color:C.sub,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"8px 18px 40px"}}>
          <div style={{background:C.card,borderRadius:14,padding:"20px",marginBottom:10,textAlign:"center",border:`1px solid ${C.borderHi}`}}>
            <div style={{fontSize:10,color:C.sub,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Lucro real</div>
            <div style={{fontSize:48,fontWeight:900,color:lucroColor,letterSpacing:"-2px",lineHeight:1,marginBottom:10}}>{fmtR(entry.lucro)}</div>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,background:verdict.color+"18",border:`1px solid ${verdict.color}30`,borderRadius:99,padding:"5px 14px"}}>
              <span>{verdict.emoji}</span><span style={{fontSize:12,fontWeight:700,color:verdict.color}}>{verdict.text}</span>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:20,background:C.card,borderRadius:10,padding:"10px 16px",marginBottom:8,fontSize:12,color:C.sub}}>
            <span>⏱️ {fmtN(entry.horas)}h</span>
            {entry.entregas>0&&<span>📦 {entry.entregas} entregas</span>}
            {entry.km>0&&<span>🛣️ {entry.km}km</span>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            {[{l:"💰 Ganho bruto",v:fmtR(entry.ganho),c:C.text},{l:"💸 Total custos",v:`-${fmtR(entry.totalCustos)}`,c:C.red},{l:"⏰ Lucro/hora",v:`${fmtR(entry.porHora)}/h`,c:horaColor,big:true},{l:"📦 Lucro/entrega",v:entry.entregas>0?fmtR(entry.porEntrega):"—",c:C.text,big:true}].map((s,i)=>(
              <div key={i} style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,color:C.sub,marginBottom:4}}>{s.l}</div>
                <div style={{fontSize:s.big?20:16,fontWeight:900,color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{background:C.card,borderRadius:12,padding:"14px 16px",marginBottom:8,border:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:12,color:C.sub}}>Lucro/hora vs mínimo</div>
              <div style={{fontSize:13,fontWeight:800,color:horaColor}}>{fmtR(entry.porHora)}/h</div>
            </div>
            <div style={{height:6,background:"#ffffff08",borderRadius:99,overflow:"hidden",marginBottom:6}}>
              <div style={{height:"100%",width:`${barPct}%`,background:`linear-gradient(90deg,${C.red},${C.orange} 40%,${C.yellow} 70%,${C.green})`,borderRadius:99}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted}}>
              <span>R$7,50/h</span>
              <span style={{color:horaColor,fontWeight:700}}>{entry.vsMinimo>=1?`${fmtN(entry.vsMinimo)}× o mínimo`:`${Math.round(entry.vsMinimo*100)}% do mínimo`}</span>
            </div>
          </div>
          <div style={{background:C.card,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.sub,letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:12}}>Custos detalhados</div>
            {[{l:"⛽ Gasolina",v:entry.gasolina},{l:"🍔 Alimentação",v:entry.alimentacao},{l:"📱 Crédito do chip",v:entry.chip},{l:`🔧 Desgaste (${entry.km}km)`,v:entry.desgaste}].map((item,i,arr)=>item.v>0&&(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{fontSize:13,color:C.sub}}>{item.l}</span>
                <span style={{fontSize:13,fontWeight:600,color:C.red}}>-{fmtR(item.v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TAB: COMPARAR ─────────────────────────────────────────────────────────────
function TabComparar({onAssinar,loadingCheckout,isPro}) {
  const fake=[{name:"iFood",v:81,color:C.red},{name:"99",v:96,color:C.green},{name:"Rappi",v:67,color:C.orange}];

  if(isPro) {
    return (
      <div style={{padding:"4px 16px 28px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <h1 style={{fontSize:22,fontWeight:900,margin:0,letterSpacing:"-0.5px"}}>Comparar</h1>
          <span style={{background:`${C.yellow}18`,border:`1px solid ${C.yellow}40`,borderRadius:99,padding:"3px 10px",fontSize:10,fontWeight:800,color:C.yellow,letterSpacing:"0.05em"}}>PRO</span>
        </div>
        <p style={{fontSize:13,color:C.sub,margin:"0 0 24px"}}>Compare seu desempenho entre períodos e plataformas</p>
        <div style={{background:C.card,borderRadius:16,padding:"24px 20px",border:`1px solid ${C.borderHi}`,textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:14}}>📊</div>
          <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:8}}>Em construção</div>
          <div style={{fontSize:13,color:C.sub,lineHeight:1.7,maxWidth:260,margin:"0 auto"}}>
            Comparações entre semanas, meses e plataformas chegam em breve. Seus dados já estão sendo coletados.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{padding:"4px 16px 28px"}}>
      <h1 style={{fontSize:22,fontWeight:900,margin:"4px 0 4px",letterSpacing:"-0.5px"}}>Comparar plataformas</h1>
      <p style={{fontSize:13,color:C.sub,margin:"0 0 18px"}}>Qual está pagando mais essa semana</p>
      <div style={{position:"relative",borderRadius:14,overflow:"hidden"}}>
        <div style={{filter:"blur(6px)",pointerEvents:"none"}}>
          {fake.map((f,i)=>(
            <div key={i} style={{background:C.card,borderRadius:12,padding:"16px",marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:14,fontWeight:700,color:C.text}}>{f.name}</span>
                <span style={{fontSize:14,fontWeight:900,color:f.color}}>R${f.v}/h</span>
              </div>
              <div style={{height:6,background:"#ffffff10",borderRadius:99}}><div style={{height:"100%",width:`${f.v}%`,background:f.color,borderRadius:99}}/></div>
            </div>
          ))}
        </div>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"0 28px",background:"rgba(10,10,10,0.6)"}}>
          <div style={{fontSize:28,marginBottom:10}}>🔒</div>
          <div style={{fontSize:16,fontWeight:900,color:C.text,marginBottom:6}}>Recurso Pro</div>
          <div style={{fontSize:12,color:C.sub,lineHeight:1.6,marginBottom:18,maxWidth:240}}>Veja qual plataforma está pagando mais na sua região agora.</div>
          <button style={{background:C.yellow,border:"none",borderRadius:10,padding:"12px 24px",fontSize:13,fontWeight:900,color:"#0A0A0A",cursor:"pointer",fontFamily:"inherit",opacity:loadingCheckout?0.6:1}} onClick={onAssinar} disabled={loadingCheckout}>{loadingCheckout?"Aguarde...":"Assinar por R$19/mês"}</button>
        </div>
      </div>
    </div>
  );
}

// ── TAB: PERFIL ───────────────────────────────────────────────────────────────
function TabPerfil({user,entries,onClear,onAssinar,loadingCheckout}) {
  const [confirm,setConfirm]=useState(false);
  const isCloud = !!user?.supaId;
  return (
    <div style={{padding:"4px 16px 28px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:C.card,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${C.borderHi}`}}>{Ico.perfil(true)}</div>
        <div>
          <div style={{fontSize:17,fontWeight:900,color:C.text}}>{user.name}</div>
          <div style={{fontSize:12,color:isCloud?C.green:C.sub}}>{isCloud?"☁️ Conta criada · dados na nuvem":"📱 Sem conta · só neste celular"}</div>
          {user.email&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{user.email}</div>}
        </div>
      </div>
      {entries.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          <div style={{background:C.card,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,color:C.sub,marginBottom:4}}>Dias registrados</div>
            <div style={{fontSize:22,fontWeight:900,color:C.text}}>{entries.length}</div>
          </div>
          <div style={{background:C.card,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,color:C.sub,marginBottom:4}}>Lucro total</div>
            <div style={{fontSize:20,fontWeight:900,color:C.green}}>{fmtR0(entries.reduce((a,e)=>a+e.lucro,0))}</div>
          </div>
        </div>
      )}
      {user.isPro ? (
        <div style={{background:`${C.yellow}0d`,border:`1px solid ${C.yellow}30`,borderRadius:14,padding:"16px 18px",marginBottom:18,display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:40,height:40,borderRadius:"50%",background:C.yellow,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:20}}>⭐</div>
          <div>
            <div style={{fontSize:13,fontWeight:800,color:C.yellow,marginBottom:2}}>RouteMax Pro ativo</div>
            <div style={{fontSize:12,color:C.sub,lineHeight:1.5}}>Você tem acesso a todos os recursos Pro.</div>
          </div>
        </div>
      ) : (
        <div style={{background:C.card,border:`1px solid ${C.yellow}25`,borderRadius:14,padding:"16px 18px",marginBottom:18}}>
          <div style={{fontSize:13,fontWeight:800,color:C.yellow,marginBottom:4}}>⭐ Vire RouteMax Pro</div>
          <div style={{fontSize:12,color:C.sub,lineHeight:1.6,marginBottom:12}}>Histórico ilimitado, comparativo de plataformas e alertas de horário de pico.</div>
          <button style={{width:"100%",background:C.yellow,border:"none",borderRadius:10,padding:"11px",fontSize:13,fontWeight:900,color:"#0A0A0A",cursor:"pointer",fontFamily:"inherit",opacity:loadingCheckout?0.6:1}} onClick={onAssinar} disabled={loadingCheckout}>{loadingCheckout?"Aguarde...":"Assinar por R$19/mês"}</button>
        </div>
      )}
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16,display:"flex",flexDirection:"column",gap:10}}>
        {!confirm?(
          <button onClick={()=>setConfirm(true)} style={{background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer",padding:0,fontFamily:"inherit",textAlign:"left"}}>
            {isCloud?"Sair da conta":"Apagar todos os dados"}
          </button>
        ):(
          <div>
            <div style={{fontSize:13,color:C.text,marginBottom:10}}>{isCloud?"Sair da conta? Seus dados continuam salvos na nuvem.":"Tem certeza? Isso apaga tudo."}</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={onClear} style={{flex:1,background:C.red,border:"none",borderRadius:8,padding:"10px",fontSize:13,fontWeight:700,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>{isCloud?"Sair":"Apagar"}</button>
              <button onClick={()=>setConfirm(false)} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px",fontSize:13,color:C.sub,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CALCULADORA — Field e Section como top-level pra não fechar o teclado ─────
function CalcField({label,icon,inputMode="decimal",placeholder,hint,time,value,onChange}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:12,fontWeight:700,color:C.sub,display:"block",marginBottom:6}}>{icon}&nbsp; {label}</label>
      <input
        type={time?"time":"number"}
        inputMode={time?undefined:inputMode}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",fontSize:16,color:C.text,outline:"none",fontFamily:"inherit"}}
      />
      {hint&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>{hint}</div>}
    </div>
  );
}

function CalcSection({title,children}) {
  return (
    <div style={{marginBottom:22}}>
      <div style={{fontSize:10,fontWeight:700,color:C.sub,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14,paddingBottom:8,borderBottom:`1px solid ${C.border}`}}>{title}</div>
      {children}
    </div>
  );
}

function CalcForm({onCalculate}) {
  const [form,setForm]=useState({horaInicio:"07:00",horaFim:"17:00",ganhoTotal:"",entregas:"",gasolina:"",alimentacao:"",chip:"",km:""});
  const set=(k)=>(e)=>setForm(f=>({...f,[k]:e.target.value}));
  const canCalc=form.ganhoTotal&&parseFloat(form.ganhoTotal)>0;
  const calcHours=()=>{try{const[sh,sm]=form.horaInicio.split(":").map(Number);const[eh,em]=form.horaFim.split(":").map(Number);let m=(eh*60+em)-(sh*60+sm);if(m<0)m+=1440;return Math.max(0.5,m/60);}catch{return 8;}};
  const submit=()=>{
    const horas=calcHours(),entregas=parseFloat(form.entregas)||0,ganho=parseFloat(form.ganhoTotal)||0;
    const gasolina=parseFloat(form.gasolina)||0,alimentacao=parseFloat(form.alimentacao)||0,chip=parseFloat(form.chip)||0,km=parseFloat(form.km)||0;
    const desgaste=parseFloat((km*WEAR_KM).toFixed(2)),totalCustos=gasolina+alimentacao+chip+desgaste,lucro=ganho-totalCustos,porHora=horas>0?lucro/horas:0;
    onCalculate({horas,entregas,ganho,gasolina,alimentacao,chip,km,desgaste,totalCustos,lucro,porHora,porEntrega:entregas>0?lucro/entregas:0,projecaoMensal:lucro*26,vsMinimo:porHora/MIN_WAGE});
  };
  return (
    <div style={{padding:"0 16px 40px",overflowY:"auto",flex:1}}>
      <div style={{paddingTop:8,marginBottom:24}}>
        <h2 style={{fontSize:22,fontWeight:900,margin:"0 0 6px",letterSpacing:"-0.5px"}}>Registrar hoje</h2>
        <p style={{fontSize:13,color:C.sub,margin:0}}>Quanto você ganhou de verdade?</p>
      </div>
      <CalcSection title="Seu turno">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <CalcField label="Começou às" icon="🕐" time value={form.horaInicio} onChange={set("horaInicio")}/>
          <CalcField label="Terminou às" icon="🏁" time value={form.horaFim}    onChange={set("horaFim")}/>
        </div>
      </CalcSection>
      <CalcSection title="Seus ganhos">
        <CalcField label="Total recebido"       icon="💰" placeholder="Ex: 187.50" hint="Valor que aparece no app da plataforma" value={form.ganhoTotal} onChange={set("ganhoTotal")}/>
        <CalcField label="Entregas realizadas"  icon="📦" inputMode="numeric" placeholder="Ex: 22" value={form.entregas}   onChange={set("entregas")}/>
      </CalcSection>
      <CalcSection title="Seus custos">
        <CalcField label="Gasolina"             icon="⛽" placeholder="Ex: 45.00" value={form.gasolina}    onChange={set("gasolina")}/>
        <CalcField label="Alimentação"          icon="🍔" placeholder="Ex: 18.00" value={form.alimentacao} onChange={set("alimentacao")}/>
        <CalcField label="Crédito do chip"      icon="📱" placeholder="Ex: 5.00"  value={form.chip}        onChange={set("chip")}/>
        <CalcField label="Km rodados"           icon="🛣️" inputMode="numeric" placeholder="Ex: 120" hint="R$0,20/km de desgaste automático" value={form.km} onChange={set("km")}/>
      </CalcSection>
      <button onClick={submit} disabled={!canCalc} style={{width:"100%",padding:"17px",background:canCalc?C.yellow:"#2a2a2a",color:canCalc?"#0A0A0A":C.muted,borderRadius:12,fontSize:15,fontWeight:900,cursor:canCalc?"pointer":"not-allowed",border:"none",fontFamily:"inherit"}}>
        Ver meu resultado real →
      </button>
      <div style={{fontSize:11,color:C.muted,textAlign:"center",marginTop:10}}>🔒 Seus dados ficam só aqui no celular</div>
    </div>
  );
}

function CalcResults({r,onSave,onBack}) {
  const [phase,setPhase]=useState("loading");
  const [costsShown,setCostsShown]=useState(0);
  const [animStarted,setAnimStarted]=useState(false);
  const [counterVal,setCounterVal]=useState(0);
  const [showVerdict,setShowVerdict]=useState(false);
  const [showCards,setShowCards]=useState(false);
  const [copied,setCopied]=useState(false);
  const rafRef=useRef(null);
  const costs=[r.gasolina>0&&{label:"⛽ Gasolina",value:r.gasolina},r.alimentacao>0&&{label:"🍔 Alimentação",value:r.alimentacao},r.chip>0&&{label:"📱 Chip",value:r.chip},r.desgaste>0&&{label:"🔧 Desgaste",value:r.desgaste}].filter(Boolean);
  const running=r.ganho-costs.slice(0,costsShown).reduce((a,c)=>a+c.value,0);
  useEffect(()=>{const t=setTimeout(()=>setPhase("costs"),1300);return()=>clearTimeout(t);},[]);
  useEffect(()=>{if(phase!=="costs")return;const ts=costs.map((_,i)=>setTimeout(()=>setCostsShown(i+1),300+i*560));const ex=setTimeout(()=>setPhase("exiting"),300+costs.length*560+700);return()=>{ts.forEach(clearTimeout);clearTimeout(ex);};},[phase]);
  useEffect(()=>{if(phase!=="exiting")return;setAnimStarted(true);const t=setTimeout(()=>setPhase("reveal"),760);return()=>clearTimeout(t);},[phase]);
  useEffect(()=>{if(!animStarted)return;setShowCards(true);const target=r.lucro,dur=1700,t0=performance.now();const tick=(now)=>{const p=Math.min((now-t0)/dur,1),ease=1-Math.pow(1-p,3);setCounterVal(target*ease);if(p<1){rafRef.current=requestAnimationFrame(tick);}else{setCounterVal(target);setShowVerdict(true);}};rafRef.current=requestAnimationFrame(tick);return()=>cancelAnimationFrame(rafRef.current);},[animStarted]);
  const verdict=getVerdict(r.vsMinimo,r.lucro),lc=r.lucro<0?C.red:C.green,hc=r.vsMinimo<1?C.red:r.vsMinimo<2?C.orange:C.yellow;
  const bp=Math.min(100,Math.max(2,(r.vsMinimo/4)*100));
  const isEx=phase==="exiting",ovOn=phase==="loading"||phase==="costs"||phase==="exiting";
  const ca=(i)=>showCards?{animation:`fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) ${i*75}ms both`}:{opacity:0};
  const share=()=>{const txt=`🏍️ *Resultado de hoje — RouteMax*\n\n💰 Lucro real: ${fmtR(r.lucro)}\n⏰ Por hora: ${fmtR(r.porHora)}/h\n📦 ${r.entregas} entregas | ${fmtN(r.horas)}h\n📈 Projeção mensal: ${fmtR(r.projecaoMensal)}\n\nCalculei pelo RouteMax — testa o seu!`;navigator.clipboard?.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});};
  return (
    <div style={{flex:1,overflowY:"auto",position:"relative"}}>
      <div style={{padding:"4px 16px 40px"}}>
        <div style={{marginBottom:20}}><button onClick={onBack} style={{background:"none",border:"none",color:C.sub,fontSize:13,cursor:"pointer",padding:0,fontFamily:"inherit"}}>← Voltar</button></div>
        <div style={{background:C.card,borderRadius:18,padding:"28px 20px 22px",marginBottom:10,border:`1px solid ${C.borderHi}`,textAlign:"center"}}>
          <div style={{fontSize:10,color:C.sub,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Lucro real de hoje</div>
          <div style={{fontSize:60,fontWeight:900,color:lc,letterSpacing:"-2px",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{counterVal<0?"-":""}{fmtR(Math.abs(counterVal))}</div>
          <div style={{marginTop:16,minHeight:32,opacity:showVerdict?1:0,transform:showVerdict?"translateY(0)":"translateY(8px)",transition:"all 0.4s cubic-bezier(0.16,1,0.3,1)"}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,background:verdict.color+"18",border:`1px solid ${verdict.color}35`,borderRadius:99,padding:"6px 16px"}}><span style={{fontSize:16}}>{verdict.emoji}</span><span style={{fontSize:12,fontWeight:700,color:verdict.color}}>{verdict.text}</span></div>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:20,background:C.surface,borderRadius:10,padding:"10px 16px",marginBottom:8,fontSize:12,color:C.sub,...ca(0)}}><span>⏱️ {fmtN(r.horas)}h</span>{r.entregas>0&&<span>📦 {r.entregas}</span>}{r.km>0&&<span>🛣️ {r.km}km</span>}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          {[{l:"💰 Ganho bruto",v:fmtR(r.ganho),c:C.text,d:1},{l:"💸 Total custos",v:`-${fmtR(r.totalCustos)}`,c:C.red,d:2},{l:"⏰ Lucro/hora",v:`${fmtR(r.porHora)}/h`,c:hc,big:true,d:3},{l:"📦 Lucro/entrega",v:r.entregas>0?fmtR(r.porEntrega):"—",c:C.text,big:true,d:4}].map((s,i)=>(
            <div key={i} style={{background:C.card,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`,...ca(s.d)}}>
              <div style={{fontSize:11,color:C.sub,marginBottom:5}}>{s.l}</div>
              <div style={{fontSize:s.big?22:18,fontWeight:900,color:s.c,letterSpacing:"-0.5px"}}>{s.v}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.card,borderRadius:12,padding:"14px 16px",marginBottom:8,border:`1px solid ${C.border}`,...ca(5)}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><div style={{fontSize:12,color:C.sub}}>Lucro/hora vs mínimo</div><div style={{fontSize:13,fontWeight:800,color:hc}}>{fmtR(r.porHora)}/h</div></div>
          <div style={{height:8,background:"#ffffff08",borderRadius:99,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:`${bp}%`,background:`linear-gradient(90deg,${C.red},${C.orange} 40%,${C.yellow} 70%,${C.green})`,borderRadius:99}}/></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted}}><span>R$7,50/h</span><span style={{color:hc,fontWeight:700}}>{r.vsMinimo>=1?`${fmtN(r.vsMinimo)}× o mínimo`:`${Math.round(r.vsMinimo*100)}% do mínimo`}</span></div>
        </div>
        <div style={{background:r.projecaoMensal>=0?"rgba(34,197,94,0.06)":"rgba(239,68,68,0.06)",border:`1px solid ${r.projecaoMensal>=0?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"}`,borderRadius:12,padding:"16px",marginBottom:16,...ca(6)}}>
          <div style={{fontSize:12,color:C.sub,marginBottom:6}}>📈 Se todo dia fosse igual a hoje...</div>
          <div style={{fontSize:34,fontWeight:900,color:r.projecaoMensal>=0?C.green:C.red,letterSpacing:"-1px"}}>{fmtR(Math.abs(r.projecaoMensal))}<span style={{fontSize:15,fontWeight:500,color:C.sub}}>/mês</span></div>
        </div>
        <div style={ca(7)}>
          <button onClick={onSave} style={{width:"100%",padding:"16px",background:C.yellow,borderRadius:12,fontSize:15,fontWeight:900,color:"#0A0A0A",cursor:"pointer",border:"none",fontFamily:"inherit",marginBottom:10}}>💾 Salvar no histórico</button>
          <button onClick={share} style={{width:"100%",padding:"14px",background:"none",border:`1px solid ${C.border}`,borderRadius:12,fontSize:14,fontWeight:700,color:C.sub,cursor:"pointer",fontFamily:"inherit"}}>{copied?"✅ Copiado! Cola no WhatsApp":"📤 Compartilhar resultado"}</button>
        </div>
      </div>
      {ovOn&&(
        <div style={{position:"absolute",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
          <div className="ovl-bg" style={{position:"absolute",inset:0,background:C.bg,opacity:isEx?0:1}}/>
          <div style={{position:"relative",zIndex:1,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",padding:"0 32px"}}>
            {phase==="loading"&&(<><div style={{fontSize:12,fontWeight:900,letterSpacing:"0.15em",color:C.yellow,marginBottom:32,textTransform:"uppercase"}}>RouteMax</div><div style={{width:44,height:44,borderRadius:"50%",border:`3px solid ${C.card}`,borderTopColor:C.yellow,animation:"spin 0.75s linear infinite",marginBottom:32}}/><div style={{fontSize:13,color:C.sub}}>Calculando…</div></>)}
            {(phase==="costs"||phase==="exiting")&&(<>
              <div className="ovl-list" style={{opacity:isEx?0:1,transform:isEx?"translateY(-10px)":"translateY(0)",width:"100%",maxWidth:320,marginBottom:36}}>
                <div style={{fontSize:10,fontWeight:700,color:C.sub,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:20,textAlign:"center"}}>Descontando seus custos</div>
                <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:13,color:C.sub}}>💰 Ganho bruto</span><span style={{fontSize:13,fontWeight:700,color:C.text}}>+{fmtR(r.ganho)}</span></div>
                {costs.map((c,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${C.border}`,opacity:costsShown>i?1:0,animation:costsShown>i?"costIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards":"none"}}><span style={{fontSize:13,color:C.sub}}>{c.label}</span><span style={{fontSize:13,fontWeight:700,color:C.red}}>-{fmtR(c.value)}</span></div>))}
              </div>
              <div className="num-lift" style={{transform:isEx?"translateY(-280px)":"translateY(0)",opacity:isEx?0:1,textAlign:"center"}}>
                <div className="ovl-list" style={{fontSize:11,color:C.sub,marginBottom:8,opacity:isEx?0:1}}>Restando</div>
                <div className="num-sz" style={{fontSize:isEx?60:44,fontWeight:900,letterSpacing:"-1.5px",color:running<0?C.red:C.text,fontVariantNumeric:"tabular-nums"}}>{running<0?"-":""}{fmtR(Math.abs(running))}</div>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

function CalcOverlay({onClose,onSave}) {
  const [results,setResults]=useState(null);
  return (
    <div style={{position:"fixed",inset:0,zIndex:50,background:C.bg,display:"flex",flexDirection:"column",animation:"slideUp 0.35s cubic-bezier(0.16,1,0.3,1)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 18px 10px",flexShrink:0}}>
        <div style={{fontSize:12,fontWeight:900,letterSpacing:"0.12em",color:C.yellow,textTransform:"uppercase"}}>RouteMax</div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.sub,fontSize:24,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
      </div>
      {!results?<CalcForm onCalculate={setResults}/>:<CalcResults r={results} onBack={()=>setResults(null)} onSave={()=>{onSave(results);onClose();}}/>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function RouteMaxApp() {
  const [user,setUser]             = useState(null);
  const [authChecked,setAuthChecked] = useState(false);
  const [entries,setEntries]       = useState(loadEntries);
  const [goal,setGoal]             = useState(loadGoal);
  const [tab,setTab]               = useState("hoje");
  const [direction,setDirection]   = useState("right");
  const [showCalc,setShowCalc]     = useState(false);
  const [selectedEntry,setSelectedEntry] = useState(null);

  // Verificar sessão Supabase ao abrir o app
  useEffect(()=>{
    (async()=>{
      const session = await getSession();
      if(session?.user){
        const {data:prof} = await supabase.from("profiles").select("*").eq("id",session.user.id).maybeSingle();
        const u = { name:prof?.name||"Motoboy", email:session.user.email, supaId:session.user.id, isPro:prof?.is_pro||false };
        setUser(u);
        // Carregar entries e goal da nuvem
        const cloudEntries = await fetchEntriesFromSupabase(session.user.id);
        if(cloudEntries){ setEntries(cloudEntries); localStorage.setItem("rm_entries",JSON.stringify(cloudEntries)); }
        const cloudGoal = await fetchGoalFromSupabase(session.user.id);
        if(cloudGoal){ setGoal(cloudGoal); saveGoal(cloudGoal); }
      } else {
        // Sem sessão Supabase — verificar se tem usuário local
        const localUser = loadUser();
        if(localUser) setUser(localUser);
      }
      setAuthChecked(true);
    })();
    // Escutar mudanças de auth (login/logout em outra aba)
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,session)=>{
      if(!session) { setUser(null); }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const switchTab=(newTab)=>{
    const ci=TAB_ORDER.indexOf(tab),ni=TAB_ORDER.indexOf(newTab);
    setDirection(ni>ci?"right":"left");
    setTab(newTab);
  };

  const saveEntry=async(r)=>{
    const entry={...r,id:todayStr(),savedAt:new Date().toISOString()};
    const updated=[entry,...entries.filter(e=>e.id!==todayStr())].sort((a,b)=>b.id.localeCompare(a.id));
    setEntries(updated);
    localStorage.setItem("rm_entries",JSON.stringify(updated));
    // Sync na nuvem se logado
    if(user?.supaId) await syncEntriesToSupabase(user.supaId,[entry]);
  };

  const handleGoalChange=async(newGoal)=>{
    setGoal(newGoal);
    saveGoal(newGoal);
    if(user?.supaId) await saveGoalToSupabase(user.supaId,newGoal);
  };

  const [loadingCheckout,setLoadingCheckout]=useState(false);

  const handleAssinar = async () => {
    if(!user?.supaId) { alert("Crie uma conta para assinar o Pro."); return; }
    setLoadingCheckout(true);
    try {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ userId: user.supaId, email: user.email }),
      });
      const { url, error } = await res.json();
      if(error) throw new Error(error);
      window.location.href = url;
    } catch(e) {
      alert("Erro ao iniciar pagamento. Tente novamente.");
    } finally {
      setLoadingCheckout(false);
    }
  };

  const clearAll=async()=>{
    if(user?.supaId) await supabase.auth.signOut();
    localStorage.removeItem("rm_user");
    localStorage.removeItem("rm_entries");
    localStorage.removeItem("rm_goal");
    setUser(null); setEntries([]); setGoal(null);
  };

  const handleAuthComplete=(u)=>{
    setUser(u);
    localStorage.setItem("rm_user",JSON.stringify(u));
    // Se logou com conta Supabase, carregar dados da nuvem
    if(u.supaId){
      (async()=>{
        const cloudEntries = await fetchEntriesFromSupabase(u.supaId);
        if(cloudEntries){ setEntries(cloudEntries); localStorage.setItem("rm_entries",JSON.stringify(cloudEntries)); }
        const cloudGoal = await fetchGoalFromSupabase(u.supaId);
        if(cloudGoal){ setGoal(cloudGoal); saveGoal(cloudGoal); }
      })();
    }
  };

  // Aguardar verificação de auth antes de renderizar
  if(!authChecked) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:900,letterSpacing:"0.14em",color:C.yellow,textTransform:"uppercase",marginBottom:24}}>RouteMax</div>
        <div style={{width:32,height:32,borderRadius:"50%",border:`3px solid ${C.card}`,borderTopColor:C.yellow,animation:"spin 0.75s linear infinite",margin:"0 auto"}}/>
      </div>
    </div>
  );

  if(!user) return <AuthScreen onComplete={handleAuthComplete}/>;

  const screens={
    hoje:<TabHoje entries={entries} name={user.name} onRegister={()=>setShowCalc(true)} goal={goal} onGoalChange={handleGoalChange}/>,
    historico:<TabHistorico entries={entries} onSelectEntry={e=>setSelectedEntry(e)}/>,
    comparar:<TabComparar onAssinar={handleAssinar} loadingCheckout={loadingCheckout} isPro={user.isPro||false}/>,
    perfil:<TabPerfil user={user} entries={entries} onClear={clearAll} onAssinar={handleAssinar} loadingCheckout={loadingCheckout}/>,
  };

  return (
    <div style={{background:C.bg,minHeight:"100vh",maxWidth:480,margin:"0 auto",fontFamily:"'Inter',system-ui,sans-serif",color:C.text,display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <TopBar goal={goal} entries={entries}/>
      <div style={{flex:1,overflowY:"auto"}}>
        <div key={tab} style={{animation:`${direction==="right"?"fromRight":"fromLeft"} 0.24s cubic-bezier(0.16,1,0.3,1)`}}>
          {screens[tab]}
        </div>
      </div>
      <TabBar active={tab} setActive={switchTab}/>
      {showCalc&&<CalcOverlay onClose={()=>setShowCalc(false)} onSave={r=>{saveEntry(r);setTab("historico");setDirection("right");}}/>}
      {selectedEntry&&<DayDetail entry={selectedEntry} onClose={()=>setSelectedEntry(null)}/>}
    </div>
  );
}
