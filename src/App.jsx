import { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

// ── Constants ──────────────────────────────────────────────────────────────
const TANGU_SUBJECTS = [
  {code:"생윤",name:"생활과 윤리"},{code:"윤사",name:"윤리와 사상"},
  {code:"한지",name:"한국지리"},{code:"세지",name:"세계지리"},
  {code:"동사",name:"동아시아사"},{code:"세사",name:"세계사"},
  {code:"경제",name:"경제"},{code:"정법",name:"정치와 법"},
  {code:"사문",name:"사회·문화"},
  {code:"물1",name:"물리학Ⅰ"},{code:"화1",name:"화학Ⅰ"},
  {code:"생1",name:"생명과학Ⅰ"},{code:"지1",name:"지구과학Ⅰ"},
  {code:"물2",name:"물리학Ⅱ"},{code:"화2",name:"화학Ⅱ"},
  {code:"생2",name:"생명과학Ⅱ"},{code:"지2",name:"지구과학Ⅱ"},
];
const SUBJECTS = [
  {id:"korean", label:"국어",  count:45, color:"#1a4a8a", fullScore:100},
  {id:"math",   label:"수학",  count:30, color:"#7b2d8b", fullScore:100},
  {id:"english",label:"영어",  count:45, color:"#1a6b4a", fullScore:100},
  {id:"tangu1", label:"탐구①", count:20, color:"#b5500a", fullScore:50},
  {id:"tangu2", label:"탐구②", count:20, color:"#8a1a2e", fullScore:50},
];
const KOREAN_OPT = [{code:"언매",name:"언어와 매체"},{code:"화작",name:"화법과 작문"}];
const MATH_OPT   = [{code:"확통",name:"확률과 통계"},{code:"기하",name:"기하"},{code:"미적",name:"미적분"}];
const MATH_SHORT_ANSWER = [16,17,18,19,20,21,22,29,30];

const DEFAULT_PW   = "2580";
const SK_STUDENTS  = "omr_students_v3";
const SK_KEY       = "omr_answer_key_v4";
const SK_SCORES    = "omr_scores_v2";
const SK_PW        = "omr_teacher_pw_v2";
const SK_DEADLINES = "omr_deadlines_v1";

const emptyAnswers = ()=>({korean:{},math:{},english:{},tangu1:{},tangu2:{}});
const emptySel     = ()=>({korean:null,math:null,tangu1:null,tangu2:null});
const emptyAbsent  = ()=>({korean:false,math:false,english:false,tangu1:false,tangu2:false});
const emptyDL      = ()=>SUBJECTS.reduce((o,s)=>({...o,[s.id]:{deadline:"",closed:false}}),{});
// Nested structure for answer key (per-selection)
const emptyKey     = ()=>({
  korean: {언매:{}, 화작:{}},
  math:   {확통:{}, 기하:{}, 미적:{}},
  english: {},
  tangu:  TANGU_SUBJECTS.reduce((o,s)=>({...o,[s.code]:{}}),{})
});
const emptyScores  = ()=>emptyKey();

// ── Storage (Firebase Firestore) ───────────────────────────────────────────
async function stGet(key) {
  try {
    const snap = await getDoc(doc(db, "omr", key));
    if (!snap.exists()) return null;
    return snap.data().value;
  } catch (e) {
    console.error("[Firestore] get error:", e);
    return null;
  }
}
async function stSet(key, value) {
  try {
    await setDoc(doc(db, "omr", key), { value, updatedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    console.error("[Firestore] set error:", e);
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isClosed(subId, deadlines){
  const d=deadlines?.[subId];
  if(!d) return false;
  if(d.closed) return true;
  if(d.deadline && new Date()>new Date(d.deadline)) return true;
  return false;
}
function fmtTime(iso){
  if(!iso) return "";
  try{return new Date(iso).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});}
  catch{return iso;}
}
function defaultQScore(subId){
  const sub=SUBJECTS.find(s=>s.id===subId);
  if(!sub) return 2;
  return Math.round(sub.fullScore/sub.count);
}
// Get the answer key sub-object for a given subject + student's selection
function getKeyFor(keyRoot, subId, selection){
  if(!keyRoot) return {};
  if(subId==="english") return keyRoot.english || {};
  if(subId==="korean"||subId==="math") return (keyRoot[subId] && keyRoot[subId][selection]) || {};
  if(subId==="tangu1"||subId==="tangu2") return (keyRoot.tangu && keyRoot.tangu[selection]) || {};
  return {};
}
function getScoresFor(scoresRoot, subId, selection){
  return getKeyFor(scoresRoot, subId, selection);
}

function getQScore(subId, qNum, scoresMap){
  const stored=scoresMap?.[subId]?.[qNum];
  if(stored!=null && stored!=="") return Number(stored);
  return defaultQScore(subId);
}
function calculateScores(student, answerKey, answerScores){
  const result={};
  let total=0;
  for(const sub of SUBJECTS){
    const rec=student?.subjects?.[sub.id];
    if(!rec || !rec.submittedAt){
      result[sub.id]={status:"missing",raw:null,correct:0,keyed:0};
      continue;
    }
    if(rec.absent){
      result[sub.id]={status:"absent",raw:null,correct:0,keyed:0};
      continue;
    }
    const subKey=getKeyFor(answerKey, sub.id, rec.selection);
    const subScores=getScoresFor(answerScores, sub.id, rec.selection);
    let raw=0, correct=0, keyed=0;
    for(let i=1;i<=sub.count;i++){
      const keyAns=subKey[i];
      if(keyAns==null) continue;
      keyed++;
      if(rec.answers?.[i]===keyAns){
        correct++;
        const sc = subScores[i];
        raw += (sc!=null && sc!=="") ? Number(sc) : defaultQScore(sub.id);
      }
    }
    result[sub.id]={status:"submitted",raw:Math.round(raw*10)/10,correct,keyed};
    total+=raw;
  }
  result._total=Math.round(total*10)/10;
  return result;
}
function downloadCSV(rows, filename){
  const BOM="\uFEFF";
  const csv=BOM+rows.map(row=>
    row.map(cell=>{
      const str=cell==null?"":String(cell);
      if(str.includes(",")||str.includes('"')||str.includes("\n")){
        return '"'+str.replace(/"/g,'""')+'"';
      }
      return str;
    }).join(",")
  ).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(()=>URL.revokeObjectURL(link.href),200);
}

// ── Bubble ─────────────────────────────────────────────────────────────────
function Bubble({num,selected,onSelect,color,keyVal,showResult,disabled,scoreMode,scoreVal,onScoreChange,defScore}){
  const isCorrect=showResult&&keyVal!=null&&selected===keyVal;
  const isWrong  =showResult&&keyVal!=null&&selected!=null&&selected!==keyVal;
  return(
    <div style={{display:"flex",alignItems:"center",gap:"3px",padding:"2px 4px",borderRadius:"6px",
      background:isWrong?"#fff0f0":isCorrect?"#f0fff4":"transparent"}}>
      <span style={{width:"20px",fontSize:"11px",fontWeight:"700",color:"#888",textAlign:"right",
        flexShrink:0,fontFamily:"'Noto Sans KR',sans-serif"}}>{num}</span>
      <div style={{display:"flex",gap:"3px"}}>
        {[1,2,3,4,5].map(n=>{
          const filled=selected===n;
          const isKey=showResult&&keyVal===n;
          let bg=filled?color:"#fff",bd=filled?color:"#ccc",tc=filled?"#fff":"#999";
          if(showResult&&isKey&&!filled){bd="#16a34a";bg="#f0fff4";tc="#16a34a";}
          if(showResult&&filled&&isKey){bg="#16a34a";bd="#16a34a";tc="#fff";}
          if(showResult&&filled&&!isKey){bg="#dc2626";bd="#dc2626";tc="#fff";}
          return(
            <button key={n} onClick={()=>!disabled&&!showResult&&onSelect&&onSelect(num,filled?null:n)}
              disabled={disabled||showResult||!onSelect}
              style={{width:"26px",height:"26px",borderRadius:"50%",border:`2px solid ${bd}`,
                background:bg,color:tc,fontSize:"11px",fontWeight:"700",
                cursor:(disabled||showResult||!onSelect)?"default":"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",
                transition:"all .12s",flexShrink:0,fontFamily:"'Noto Sans KR',sans-serif",
                boxShadow:filled?`0 2px 6px ${color}44`:"none",
                transform:filled?"scale(1.07)":"scale(1)",
                opacity:disabled ? 0.35 : 1}}>{n}</button>
          );
        })}
      </div>
      {scoreMode && (
        <input type="text" inputMode="numeric"
          value={scoreVal==null||scoreVal===""?"":String(scoreVal)}
          onChange={e=>{
            const v=e.target.value;
            if(v===""){onScoreChange&&onScoreChange(num,null);return;}
            if(/^[0-9]+$/.test(v) && v.length<=2) onScoreChange&&onScoreChange(num,parseInt(v,10));
          }}
          placeholder={String(defScore)}
          style={{width:"34px",height:"22px",border:"1px solid #ddd",borderRadius:"4px",
            fontSize:"11px",fontWeight:"700",textAlign:"center",padding:"0 2px",
            marginLeft:"4px",color:scoreVal!=null?color:"#aaa",outline:"none",
            background:"#fff",fontFamily:"'Noto Sans KR',sans-serif"}}/>
      )}
      {scoreMode && <span style={{fontSize:"10px",color:"#bbb",marginLeft:"1px"}}>점</span>}
      {showResult&&keyVal!=null&&(
        <span style={{fontSize:"13px",marginLeft:"2px",color:isCorrect?"#16a34a":isWrong?"#dc2626":"#ccc"}}>
          {isCorrect?"✓":isWrong?"✗":"—"}
        </span>
      )}
    </div>
  );
}

// ── ShortAnswerRow ─────────────────────────────────────────────────────────
function ShortAnswerRow({num,value,onSelect,color,keyVal,showResult,disabled,scoreMode,scoreVal,onScoreChange,defScore}){
  const isCorrect=showResult&&keyVal!=null&&value===keyVal;
  const isWrong  =showResult&&keyVal!=null&&value!=null&&value!==keyVal;
  const handleChange=(e)=>{
    if(disabled||showResult||!onSelect) return;
    const v=e.target.value;
    if(v===""){ onSelect(num,null); return; }
    if(/^[0-9]+$/.test(v) && v.length<=4) onSelect(num,parseInt(v,10));
  };
  return(
    <div style={{display:"flex",alignItems:"center",gap:"3px",padding:"2px 4px",borderRadius:"6px",
      background:isWrong?"#fff0f0":isCorrect?"#f0fff4":"transparent"}}>
      <span style={{width:"20px",fontSize:"11px",fontWeight:"700",color:"#888",textAlign:"right",
        flexShrink:0,fontFamily:"'Noto Sans KR',sans-serif"}}>{num}</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*"
        value={value==null?"":String(value)} onChange={handleChange}
        disabled={disabled||showResult||!onSelect} placeholder="단답"
        style={{width:"110px",height:"26px",padding:"0 10px",borderRadius:"8px",
          border:isWrong?"2px solid #dc2626":isCorrect?"2px solid #16a34a":`2px solid ${color}`,
          background:value!=null?(color+"11"):"#fff",
          fontSize:"13px",fontWeight:"700",color:value!=null?color:"#aaa",
          textAlign:"center",outline:"none",fontFamily:"'Noto Sans KR',sans-serif",
          opacity:disabled?0.6:1,boxSizing:"border-box"}}/>
      {scoreMode && (
        <input type="text" inputMode="numeric"
          value={scoreVal==null||scoreVal===""?"":String(scoreVal)}
          onChange={e=>{
            const v=e.target.value;
            if(v===""){onScoreChange&&onScoreChange(num,null);return;}
            if(/^[0-9]+$/.test(v) && v.length<=2) onScoreChange&&onScoreChange(num,parseInt(v,10));
          }}
          placeholder={String(defScore)}
          style={{width:"34px",height:"22px",border:"1px solid #ddd",borderRadius:"4px",
            fontSize:"11px",fontWeight:"700",textAlign:"center",padding:"0 2px",
            marginLeft:"4px",color:scoreVal!=null?color:"#aaa",outline:"none",
            background:"#fff",fontFamily:"'Noto Sans KR',sans-serif"}}/>
      )}
      {scoreMode && <span style={{fontSize:"10px",color:"#bbb",marginLeft:"1px"}}>점</span>}
      {showResult && keyVal!=null && (
        <>
          <span style={{fontSize:"10px",color:"#888",marginLeft:"4px",fontWeight:"600"}}>
            정답:<strong style={{color:"#16a34a",marginLeft:"3px"}}>{keyVal}</strong>
          </span>
          <span style={{fontSize:"13px",marginLeft:"2px",color:isCorrect?"#16a34a":isWrong?"#dc2626":"#ccc"}}>
            {isCorrect?"✓":isWrong?"✗":"—"}
          </span>
        </>
      )}
    </div>
  );
}

// ── OMRGrid ────────────────────────────────────────────────────────────────
function OMRGrid({count,answers,onSelect,color,columns=3,answerKey={},showResult=false,disabled=false,
  shortAnswers=[],scoreMode=false,scoresMap={},onScoreChange,subjectId,startQ,endQ}){
  const realStart = startQ != null ? startQ : 1;
  const realEnd = endQ != null ? endQ : count;
  const totalQ = realEnd - realStart + 1;
  const perCol = Math.ceil(totalQ/columns);
  return(
    <div style={{display:"flex",gap:"7px",flexWrap:"wrap"}}>
      {Array.from({length:columns},(_,c)=>{
        const s=realStart+c*perCol;
        const e=Math.min(s+perCol-1, realEnd);
        if (s > realEnd) return null;
        return(
          <div key={c} style={{display:"flex",flexDirection:"column",gap:"1px",
            background:"#f5f5f7",borderRadius:"10px",padding:"8px 3px",flex:1}}>
            {Array.from({length:e-s+1},(_,i)=>{
              const n=s+i;
              const isShort=shortAnswers && shortAnswers.indexOf(n)!==-1;
              const def=subjectId?defaultQScore(subjectId):2;
              if(isShort){
                return <ShortAnswerRow key={n} num={n} value={answers?.[n]} onSelect={onSelect}
                  color={color} keyVal={answerKey?.[n]} showResult={showResult} disabled={disabled}
                  scoreMode={scoreMode} scoreVal={scoresMap?.[n]} onScoreChange={onScoreChange} defScore={def}/>;
              }
              return <Bubble key={n} num={n} selected={answers?.[n]} onSelect={onSelect}
                color={color} keyVal={answerKey?.[n]} showResult={showResult} disabled={disabled}
                scoreMode={scoreMode} scoreVal={scoresMap?.[n]} onScoreChange={onScoreChange} defScore={def}/>;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Password Modal ─────────────────────────────────────────────────────────
function PasswordModal({onSuccess,onCancel,storedPw}){
  const [input,setInput]=useState(""); const [err,setErr]=useState(false); const [show,setShow]=useState(false);
  const pw=storedPw||DEFAULT_PW;
  const try_=()=>{
    if(input===pw)onSuccess();
    else{setErr(true);setInput("");setTimeout(()=>setErr(false),900);}
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:999}}>
      <div style={{background:"#fff",borderRadius:"20px",padding:"36px 30px",width:"300px",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)",textAlign:"center"}}>
        <div style={{fontSize:"40px",marginBottom:"12px"}}>🔐</div>
        <h2 style={{margin:"0 0 5px",fontSize:"18px",fontWeight:"800",color:"#1a1a2e"}}>교사 전용</h2>
        <p style={{color:"#aaa",fontSize:"12px",marginBottom:"20px"}}>비밀번호를 입력하세요</p>
        <div style={{position:"relative",marginBottom:"12px"}}>
          <input type={show?"text":"password"} value={input} autoFocus
            onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&try_()}
            placeholder="비밀번호"
            style={{width:"100%",padding:"11px 38px 11px 14px",borderRadius:"10px",
              border:`2px solid ${err?"#dc2626":"#ddd"}`,fontSize:"16px",outline:"none",
              textAlign:"center",letterSpacing:"0.2em",fontFamily:"'Noto Sans KR',sans-serif",
              boxSizing:"border-box",animation:err?"shake .3s":"none"}}/>
          <button onClick={()=>setShow(v=>!v)} style={{position:"absolute",right:"10px",top:"50%",
            transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",
            fontSize:"15px",color:"#bbb"}}>{show?"🙈":"👁️"}</button>
        </div>
        {err&&<p style={{color:"#dc2626",fontSize:"12px",marginBottom:"8px",fontWeight:"600"}}>비밀번호가 틀렸습니다</p>}
        <div style={{display:"flex",gap:"7px"}}>
          <button onClick={onCancel} style={{flex:1,padding:"10px",background:"#f5f5f5",border:"none",
            borderRadius:"9px",fontSize:"13px",fontWeight:"600",cursor:"pointer",
            fontFamily:"'Noto Sans KR',sans-serif",color:"#666"}}>취소</button>
          <button onClick={try_} style={{flex:2,padding:"10px",
            background:"linear-gradient(135deg,#1a0a2e,#3b1a6b)",border:"none",
            borderRadius:"9px",fontSize:"13px",fontWeight:"700",cursor:"pointer",
            fontFamily:"'Noto Sans KR',sans-serif",color:"#fff"}}>확인</button>
        </div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}`}</style>
    </div>
  );
}

// ── Student View ───────────────────────────────────────────────────────────
function StudentView({deadlines, onTeacherLogin, onRefreshDeadlines}) {
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  const [identified, setIdentified] = useState(false);
  const [nameErr, setNameErr] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const [activeSubject, setActiveSubject] = useState("korean");
  const [answers, setAnswers] = useState(emptyAnswers());
  const [sel, setSel] = useState(emptySel());
  const [absent, setAbsent] = useState(emptyAbsent());
  const [submitted, setSubmitted] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [showGrading, setShowGrading] = useState(false);
  const [gradingKey, setGradingKey] = useState(null);
  const [gradingScores, setGradingScores] = useState(null);
  const [loadingGrade, setLoadingGrade] = useState(false);

  useEffect(() => {
    const id = setInterval(() => { onRefreshDeadlines(); }, 30000);
    return () => clearInterval(id);
  }, []);

  const handleShowGrading = async () => {
    setLoadingGrade(true); setErrMsg("");
    try {
      const keyData = await stGet(SK_KEY);
      const scoresData = await stGet(SK_SCORES);
      const hasKey = keyData && keyData.answers &&
        Object.values(keyData.answers).some(a => a && Object.keys(a).length > 0);
      if (!hasKey) {
        setErrMsg("선생님이 아직 정답을 입력하지 않았습니다.");
        setTimeout(() => setErrMsg(""), 4000);
      } else {
        setGradingKey(keyData.answers);
        setGradingScores(scoresData || emptyScores());
        setShowGrading(true);
      }
    } catch (e) {
      setErrMsg("채점 정보를 불러올 수 없습니다.");
      setTimeout(() => setErrMsg(""), 3000);
    } finally {
      setLoadingGrade(false);
    }
  };

  const loadRecord = async () => {
    setErrMsg("");
    if (!name.trim()) {
      setNameErr(true); setTimeout(() => setNameErr(false), 1800); return;
    }
    try {
      const students = (await stGet(SK_STUDENTS)) || [];
      const rec = students.find(s => s && s.name === name.trim() && (s.num || "") === num.trim());
      if (rec && rec.subjects) {
        const subData = {};
        const newSel = {...emptySel()};
        const newAbsent = {...emptyAbsent()};
        for (const sId of Object.keys(rec.subjects)) {
          const r = rec.subjects[sId];
          if (r && r.submittedAt) {
            subData[sId] = r;
            if (r.selection) newSel[sId] = r.selection;
            if (r.absent) newAbsent[sId] = true;
          }
        }
        setSubmitted(subData);
        setSel(newSel);
        setAbsent(newAbsent);
      }
      setIdentified(true);
    } catch (e) {
      setErrMsg("불러오기 오류: " + (e && e.message ? e.message : String(e)));
    }
  };

  const handleSelect = (subId, qNum, val) => {
    if (submitted[subId]) return;
    setAnswers(prev => ({...prev, [subId]: {...(prev[subId] || {}), [qNum]: val}}));
  };

  const toggleAbsent = (id) => {
    if (submitted[id]) return;
    const next = !absent[id];
    setAbsent(prev => ({...prev, [id]: next}));
    if (next) setAnswers(prev => ({...prev, [id]: {}}));
  };

  const handleSubjectSubmit = async (subId) => {
    setSubmitting(true); setErrMsg("");
    try {
      const subjectData = {
        answers: answers[subId] || {},
        selection: sel[subId] || null,
        absent: !!absent[subId],
        submittedAt: new Date().toISOString(),
      };
      const students = (await stGet(SK_STUDENTS)) || [];
      const idx = students.findIndex(s => s && s.name === name.trim() && (s.num || "") === num.trim());
      if (idx >= 0) {
        students[idx].subjects = {...(students[idx].subjects || {}), [subId]: subjectData};
      } else {
        students.push({
          name: name.trim(), num: num.trim(),
          key: name.trim() + "_" + num.trim(),
          createdAt: new Date().toISOString(),
          subjects: {[subId]: subjectData},
        });
      }
      await stSet(SK_STUDENTS, students);
      setSubmitted(prev => ({...prev, [subId]: subjectData}));
      setConfirming(null);
    } catch (e) {
      setErrMsg("제출 오류: " + (e && e.message ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatus = (id) => {
    if (submitted[id]) return "submitted";
    if (isClosed(id, deadlines)) return "closed";
    return "open";
  };
  const getAnsweredCount = (id) => {
    if (absent[id]) { const sub = SUBJECTS.find(s => s.id === id); return sub ? sub.count : 0; }
    return Object.values(answers[id] || {}).filter(v => v != null).length;
  };

  const totalDone = SUBJECTS.filter(s => submitted[s.id]).length;
  const allSubmitted = totalDone === SUBJECTS.length;

  // ── Grading Screen for Student ──
  if (showGrading && gradingKey) {
    const studentObj = { name: name.trim(), num: num.trim(), subjects: submitted };
    return (
      <GradingScreen
        student={studentObj} answerKey={gradingKey}
        answerScores={gradingScores || emptyScores()}
        onBack={() => setShowGrading(false)}/>
    );
  }

  // ── Login Screen ──
  if (!identified) {
    return (
      <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",
        display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",
        fontFamily:"'Noto Sans KR',sans-serif"}}>
        <div style={{background:"#fff",borderRadius:"22px",padding:"40px 36px",
          maxWidth:"360px",width:"100%",boxShadow:"0 24px 80px rgba(0,0,0,.35)"}}>
          <div style={{textAlign:"center",marginBottom:"28px"}}>
            <div style={{fontSize:"44px",marginBottom:"10px"}}>📝</div>
            <h1 style={{margin:"0 0 6px",fontSize:"22px",fontWeight:"800",color:"#1a1a2e"}}>수능 모의고사</h1>
            <p style={{color:"#aaa",fontSize:"13px",margin:0}}>OMR 온라인 답안 입력</p>
          </div>
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:nameErr?"#dc2626":"#555",marginBottom:"5px"}}>
              이름{nameErr && <span style={{marginLeft:"8px",fontSize:"11px",fontWeight:"600"}}>⚠ 이름을 입력하세요</span>}
            </div>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") loadRecord(); }}
              placeholder="홍길동"
              style={{width:"100%",padding:"12px 14px",borderRadius:"10px",
                border:nameErr?"2px solid #dc2626":"2px solid #e0e0e0",
                fontSize:"14px",outline:"none",
                fontFamily:"'Noto Sans KR',sans-serif",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:"22px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:"#555",marginBottom:"5px"}}>수험번호</div>
            <input value={num} onChange={e => setNum(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") loadRecord(); }}
              placeholder="수험번호 (선택)"
              style={{width:"100%",padding:"12px 14px",borderRadius:"10px",
                border:"2px solid #e0e0e0",fontSize:"14px",outline:"none",
                fontFamily:"'Noto Sans KR',sans-serif",boxSizing:"border-box"}}/>
          </div>
          {errMsg && (
            <div style={{background:"#fff0f0",border:"1.5px solid #dc2626",borderRadius:"8px",
              padding:"10px",fontSize:"12px",color:"#dc2626",marginBottom:"12px"}}>{errMsg}</div>
          )}
          <button onClick={loadRecord} style={{width:"100%",padding:"14px",
            background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",color:"#fff",
            border:"none",borderRadius:"12px",fontSize:"15px",fontWeight:"800",
            cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif",
            boxShadow:"0 4px 20px rgba(26,58,107,.4)"}}>시작하기 →</button>
          <button onClick={onTeacherLogin} style={{width:"100%",marginTop:"10px",padding:"10px",
            background:"transparent",color:"#bbb",border:"1.5px solid #e0e0e0",
            borderRadius:"10px",fontSize:"12px",fontWeight:"600",cursor:"pointer",
            fontFamily:"'Noto Sans KR',sans-serif"}}>🔑 교사 로그인</button>
        </div>
      </div>
    );
  }

  // ── Main Exam Screen ──
  const cur = SUBJECTS.find(s => s.id === activeSubject) || SUBJECTS[0];
  const status = getStatus(activeSubject);
  const isSubmitted = status === "submitted";
  const isClosedSub = status === "closed";
  const isOpen = status === "open";
  const subData = submitted[activeSubject];
  const curSelection = (subData && subData.selection) || sel[activeSubject] || "";

  const getTabColor = (isActive, st, color) => {
    if (isActive) return color;
    if (st === "submitted") return "#86efac";
    if (st === "closed") return "#888";
    return "#ccc";
  };
  const getSubLabel = (id) => {
    const subInfo = SUBJECTS.find(s => s.id === id);
    const base = subInfo ? subInfo.label : id;
    const chosen = (submitted[id] && submitted[id].selection) || sel[id];
    if (chosen) return base + " (" + chosen + ")";
    return base;
  };

  return (
    <div style={{minHeight:"100vh",background:"#eef1f7",fontFamily:"'Noto Sans KR','Apple SD Gothic Neo',sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",padding:"13px 18px",
        boxShadow:"0 2px 16px rgba(0,0,0,.25)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:"920px",margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:"10px",flexWrap:"wrap",gap:"8px"}}>
            <div>
              <div style={{fontSize:"10px",color:"#8ab4e8",letterSpacing:".12em",fontWeight:"600",marginBottom:"1px"}}>
                수능 모의고사 OMR
              </div>
              <div style={{fontSize:"16px",fontWeight:"800",color:"#fff"}}>
                {name}{num && <span style={{fontSize:"12px",color:"#8ab4e8",fontWeight:"600"}}> · {num}</span>}
                <span style={{fontSize:"12px",color:"#8ab4e8",fontWeight:"600",marginLeft:"10px"}}>
                  {totalDone}/{SUBJECTS.length} 과목 제출완료
                </span>
              </div>
            </div>
            <button onClick={onTeacherLogin} style={{padding:"6px 12px",
              background:"rgba(255,255,255,.08)",color:"#bbb",
              border:"1.5px solid rgba(255,255,255,.15)",borderRadius:"7px",
              fontSize:"11px",fontWeight:"600",cursor:"pointer",
              fontFamily:"'Noto Sans KR',sans-serif"}}>🔑 교사</button>
          </div>
          <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
            {SUBJECTS.map(sub => {
              const st = getStatus(sub.id);
              const isActive = activeSubject === sub.id;
              const ans = getAnsweredCount(sub.id);
              let badgeText = ans + "/" + sub.count;
              if (st === "submitted") badgeText = "✓";
              else if (st === "closed") badgeText = "🔒";
              return (
                <button key={sub.id} onClick={() => setActiveSubject(sub.id)} style={{
                  padding:"6px 11px",borderRadius:"7px",
                  border: isActive ? ("2px solid " + sub.color) : "2px solid transparent",
                  background: isActive ? "#fff" : "rgba(255,255,255,.1)",
                  color: getTabColor(isActive, st, sub.color),
                  fontSize:"12px",fontWeight:"700",cursor:"pointer",
                  fontFamily:"'Noto Sans KR',sans-serif",
                  display:"flex",alignItems:"center",gap:"4px"
                }}>
                  {sub.label}
                  <span style={{fontSize:"10px",padding:"1px 5px",borderRadius:"4px",
                    background: isActive ? (sub.color + "22") : "rgba(255,255,255,.15)"}}>{badgeText}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{maxWidth:"920px",margin:"0 auto",padding:"16px 14px"}}>
        {errMsg && (
          <div style={{background:"#fff0f0",border:"1.5px solid #dc2626",borderRadius:"10px",
            padding:"10px 14px",fontSize:"12px",color:"#dc2626",marginBottom:"12px",fontWeight:"600"}}>⚠ {errMsg}</div>
        )}
        <div style={{background:"#fff",borderRadius:"16px",padding:"20px",
          boxShadow:"0 2px 16px rgba(0,0,0,.08)",borderTop:"4px solid " + cur.color}}>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
            marginBottom:"13px",flexWrap:"wrap",gap:"8px"}}>
            <div>
              <h2 style={{margin:"0 0 2px",fontSize:"18px",fontWeight:"800",color:cur.color}}>
                {getSubLabel(activeSubject)}
              </h2>
              <p style={{margin:0,fontSize:"11px",color:"#ccc"}}>총 {cur.count}문항</p>
            </div>
            {isSubmitted && subData && (
              <div style={{padding:"7px 14px",background:"#f0fff4",borderRadius:"10px",
                border:"1.5px solid #86efac",display:"flex",alignItems:"center",gap:"6px"}}>
                <span style={{color:"#16a34a",fontSize:"14px"}}>✓</span>
                <div>
                  <div style={{fontSize:"12px",fontWeight:"800",color:"#16a34a"}}>제출완료</div>
                  <div style={{fontSize:"10px",color:"#86efac"}}>{fmtTime(subData.submittedAt)}</div>
                </div>
              </div>
            )}
            {isClosedSub && (
              <div style={{padding:"7px 14px",background:"#f5f5f5",borderRadius:"10px",
                border:"1.5px solid #ddd",display:"flex",alignItems:"center",gap:"6px"}}>
                <span style={{fontSize:"14px"}}>🔒</span>
                <div>
                  <div style={{fontSize:"12px",fontWeight:"700",color:"#666"}}>마감됨</div>
                  {deadlines[activeSubject] && deadlines[activeSubject].deadline && (
                    <div style={{fontSize:"10px",color:"#aaa"}}>마감: {fmtTime(deadlines[activeSubject].deadline)}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap",marginBottom:"13px"}}>
            {activeSubject === "korean" && (
              <div style={{flex:1,display:"flex",gap:"5px",alignItems:"center",
                padding:"8px 12px",background:"#f0f4ff",borderRadius:"9px",
                border:"1px solid #d0daf0",flexWrap:"wrap"}}>
                <span style={{fontSize:"11px",fontWeight:"700",color:"#666"}}>선택과목:</span>
                {KOREAN_OPT.map(o => {
                  const s = curSelection === o.code;
                  const dim = absent.korean || isSubmitted;
                  return (
                    <button key={o.code}
                      onClick={() => { if (!isSubmitted) setSel(p => ({...p, korean: s ? null : o.code})); }}
                      disabled={isSubmitted || absent.korean}
                      style={{padding:"4px 10px",borderRadius:"20px",
                        border: s ? "2px solid #1a4a8a" : "1.5px solid #ccc",
                        background: s ? "#1a4a8a" : "#fff", color: s ? "#fff" : "#666",
                        fontSize:"11px",fontWeight:"600",cursor:"pointer",
                        fontFamily:"'Noto Sans KR',sans-serif", opacity: dim ? 0.5 : 1}}>
                      {o.code} {o.name}
                    </button>
                  );
                })}
              </div>
            )}
            {activeSubject === "math" && (
              <div style={{flex:1,display:"flex",gap:"5px",alignItems:"center",
                padding:"8px 12px",background:"#f5f0ff",borderRadius:"9px",
                border:"1px solid #d8c8f0",flexWrap:"wrap"}}>
                <span style={{fontSize:"11px",fontWeight:"700",color:"#666"}}>선택과목:</span>
                {MATH_OPT.map(o => {
                  const s = curSelection === o.code;
                  const dim = absent.math || isSubmitted;
                  return (
                    <button key={o.code}
                      onClick={() => { if (!isSubmitted) setSel(p => ({...p, math: s ? null : o.code})); }}
                      disabled={isSubmitted || absent.math}
                      style={{padding:"4px 10px",borderRadius:"20px",
                        border: s ? "2px solid #7b2d8b" : "1.5px solid #ccc",
                        background: s ? "#7b2d8b" : "#fff", color: s ? "#fff" : "#666",
                        fontSize:"11px",fontWeight:"600",cursor:"pointer",
                        fontFamily:"'Noto Sans KR',sans-serif", opacity: dim ? 0.5 : 1}}>
                      {o.code} {o.name}
                    </button>
                  );
                })}
              </div>
            )}
            {(activeSubject === "tangu1" || activeSubject === "tangu2") && (
              <div style={{flex:1,display:"flex",alignItems:"center",gap:"8px",
                padding:"8px 12px",background:"#fff8f0",borderRadius:"9px",
                border:"1px solid #f0d8b0",flexWrap:"wrap"}}>
                <span style={{fontSize:"11px",fontWeight:"700",color:"#666",whiteSpace:"nowrap"}}>
                  {activeSubject === "tangu1" ? "탐구① 과목:" : "탐구② 과목:"}
                </span>
                <select value={curSelection || ""}
                  onChange={e => {
                    if (isSubmitted) return;
                    const v = e.target.value || null;
                    if (activeSubject === "tangu1") setSel(p => ({...p, tangu1: v}));
                    else setSel(p => ({...p, tangu2: v}));
                  }}
                  disabled={isSubmitted || absent[activeSubject]}
                  style={{padding:"5px 10px",borderRadius:"7px",border:"1.5px solid #d0a060",
                    background:"#fff",fontSize:"12px",fontWeight:"600",
                    fontFamily:"'Noto Sans KR',sans-serif",cursor:"pointer",
                    outline:"none",minWidth:"150px",
                    opacity: (absent[activeSubject] || isSubmitted) ? 0.5 : 1}}>
                  <option value="">과목 선택</option>
                  {TANGU_SUBJECTS
                    .filter(s => s.code !== (activeSubject === "tangu1" ? sel.tangu2 : sel.tangu1))
                    .map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                </select>
              </div>
            )}
            {activeSubject === "english" && (
              <div style={{flex:1,padding:"8px 12px",background:"#f0f8f4",borderRadius:"9px",
                border:"1px solid #c0e0d0",fontSize:"12px",color:"#666"}}>영어 영역 (필수)</div>
            )}
            <button onClick={() => toggleAbsent(activeSubject)} disabled={isSubmitted}
              style={{padding:"7px 12px",borderRadius:"9px",cursor: isSubmitted ? "default" : "pointer",
                whiteSpace:"nowrap",
                border: absent[activeSubject] ? "2px solid #dc2626" : "2px solid #ddd",
                background: absent[activeSubject] ? "#fff0f0" : "#fff",
                color: absent[activeSubject] ? "#dc2626" : "#aaa",
                fontSize:"12px",fontWeight:"700",
                fontFamily:"'Noto Sans KR',sans-serif", opacity: isSubmitted ? 0.5 : 1}}>
              {absent[activeSubject] ? "✓ 미응시" : "미응시"}
            </button>
          </div>

          {absent[activeSubject] ? (
            <div style={{textAlign:"center",padding:"44px 0",color:"#bbb",
              background:"#f8f8f8",borderRadius:"12px"}}>
              <div style={{fontSize:"28px",marginBottom:"8px"}}>🚫</div>
              <div style={{fontSize:"14px",fontWeight:"600"}}>미응시 처리</div>
              {!isSubmitted && (
                <div style={{fontSize:"12px",marginTop:"4px"}}>아래 [{cur.label} 제출하기] 버튼으로 미응시 상태로 제출 가능</div>
              )}
              {isSubmitted && (
                <div style={{fontSize:"12px",marginTop:"4px",color:"#16a34a",fontWeight:"700"}}>제출 완료</div>
              )}
            </div>
          ) : (
            <div style={{position:"relative"}}>
              <OMRGrid
                count={cur.count}
                answers={(subData && subData.answers) || answers[activeSubject] || {}}
                onSelect={(q, v) => handleSelect(activeSubject, q, v)}
                color={cur.color}
                columns={cur.count === 20 ? 2 : 3}
                shortAnswers={activeSubject === "math" ? MATH_SHORT_ANSWER : []}
                disabled={isSubmitted}/>
              {isSubmitted && (
                <div style={{position:"absolute",inset:0,borderRadius:"10px",
                  background:"rgba(240,255,244,.5)",display:"flex",
                  alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                  <div style={{background:"rgba(22,163,74,.1)",border:"2px solid #86efac",
                    borderRadius:"14px",padding:"12px 24px",textAlign:"center"}}>
                    <div style={{fontSize:"22px",marginBottom:"4px"}}>🔒</div>
                    <div style={{fontSize:"13px",fontWeight:"800",color:"#16a34a"}}>제출 완료 · 수정 불가</div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{marginTop:"16px",borderTop:"1px solid #f0f0f0",paddingTop:"14px"}}>
            {isSubmitted && subData && (
              <div style={{display:"flex",alignItems:"center",gap:"8px",
                padding:"10px 16px",background:"#f0fff4",borderRadius:"10px"}}>
                <span style={{color:"#16a34a",fontSize:"18px"}}>✓</span>
                <div style={{fontSize:"13px",fontWeight:"700",color:"#16a34a"}}>
                  제출완료 — {fmtTime(subData.submittedAt)}
                  {subData.absent && <span style={{color:"#aaa",fontWeight:"600",marginLeft:"8px"}}>(미응시)</span>}
                </div>
              </div>
            )}
            {isClosedSub && (
              <div style={{display:"flex",alignItems:"center",gap:"8px",
                padding:"10px 16px",background:"#f5f5f5",borderRadius:"10px"}}>
                <span style={{fontSize:"16px"}}>🔒</span>
                <div style={{fontSize:"13px",fontWeight:"700",color:"#666"}}>이 과목은 마감되었습니다. 더 이상 제출할 수 없습니다.</div>
              </div>
            )}
            {isOpen && confirming === activeSubject && (
              <div style={{display:"flex",alignItems:"center",gap:"10px",
                padding:"12px 16px",background:"#fff8e8",borderRadius:"10px",
                border:"1.5px solid #f0c060",flexWrap:"wrap"}}>
                <span style={{fontSize:"14px"}}>⚠️</span>
                <div style={{flex:1,fontSize:"13px",fontWeight:"700",color:"#7a5000"}}>
                  {absent[activeSubject] ? "미응시로 제출합니다. 확인하시겠습니까?" : "제출하면 수정이 불가능합니다. 확인하시겠습니까?"}
                </div>
                <div style={{display:"flex",gap:"7px"}}>
                  <button onClick={() => setConfirming(null)}
                    style={{padding:"8px 16px",background:"#fff",border:"1.5px solid #ddd",
                      borderRadius:"8px",fontSize:"12px",fontWeight:"700",cursor:"pointer",
                      fontFamily:"'Noto Sans KR',sans-serif",color:"#666"}}>취소</button>
                  <button onClick={() => handleSubjectSubmit(activeSubject)} disabled={submitting}
                    style={{padding:"8px 18px",
                      background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",
                      border:"none",borderRadius:"8px",fontSize:"12px",fontWeight:"700",
                      cursor: submitting ? "default" : "pointer",
                      fontFamily:"'Noto Sans KR',sans-serif",color:"#fff",
                      opacity: submitting ? 0.7 : 1}}>
                    {submitting ? "제출 중..." : "✓ 확인, 제출"}
                  </button>
                </div>
              </div>
            )}
            {isOpen && confirming !== activeSubject && (
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button onClick={() => setConfirming(activeSubject)}
                  style={{padding:"11px 24px",
                    background: "linear-gradient(135deg," + cur.color + "," + cur.color + "cc)",
                    color:"#fff",border:"none",borderRadius:"10px",fontSize:"13px",
                    fontWeight:"700",cursor:"pointer",
                    fontFamily:"'Noto Sans KR',sans-serif",
                    boxShadow: "0 3px 14px " + cur.color + "55"}}>
                  📤 {cur.label} 제출하기
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          marginTop:"12px",flexWrap:"wrap",gap:"8px"}}>
          <div style={{display:"flex",gap:"7px"}}>
            {SUBJECTS.findIndex(s => s.id === activeSubject) > 0 && (
              <button onClick={() => {
                const i = SUBJECTS.findIndex(s => s.id === activeSubject);
                setActiveSubject(SUBJECTS[i - 1].id); setConfirming(null);
              }}
                style={{padding:"9px 16px",background:"#fff",border:"1.5px solid #ddd",
                  borderRadius:"9px",fontSize:"12px",fontWeight:"600",color:"#666",
                  cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>← 이전</button>
            )}
            {SUBJECTS.findIndex(s => s.id === activeSubject) < SUBJECTS.length - 1 && (
              <button onClick={() => {
                const i = SUBJECTS.findIndex(s => s.id === activeSubject);
                setActiveSubject(SUBJECTS[i + 1].id); setConfirming(null);
              }}
                style={{padding:"9px 16px",background:"#fff",border:"1.5px solid #ddd",
                  borderRadius:"9px",fontSize:"12px",fontWeight:"600",color:"#666",
                  cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>다음 →</button>
            )}
          </div>
          {allSubmitted && (
            <div style={{display:"flex",alignItems:"center",gap:"12px",
              padding:"12px 20px",background:"#f0fff4",border:"2px solid #86efac",
              borderRadius:"12px",flexWrap:"wrap"}}>
              <span style={{fontSize:"18px"}}>🎉</span>
              <div style={{flex:1,fontSize:"13px",fontWeight:"800",color:"#16a34a"}}>
                전 과목 제출완료!
                <div style={{fontSize:"11px",fontWeight:"600",color:"#86efac",marginTop:"2px"}}>
                  아래 버튼으로 본인 점수를 확인할 수 있습니다.
                </div>
              </div>
              <button onClick={handleShowGrading} disabled={loadingGrade}
                style={{padding:"10px 22px",
                  background:"linear-gradient(135deg,#16a34a,#15803d)",
                  color:"#fff",border:"none",borderRadius:"10px",
                  fontSize:"13px",fontWeight:"800",
                  cursor: loadingGrade ? "default" : "pointer",
                  fontFamily:"'Noto Sans KR',sans-serif",
                  boxShadow:"0 3px 14px rgba(22,163,74,.4)",
                  opacity: loadingGrade ? 0.7 : 1,whiteSpace:"nowrap"}}>
                {loadingGrade ? "확인 중..." : "📊 내 점수 확인"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Deadline Panel ─────────────────────────────────────────────────────────
function DeadlinePanel({deadlines,students,onUpdate}){
  const [localDL,setLocalDL]=useState(deadlines);
  useEffect(()=>setLocalDL(deadlines),[deadlines]);

  const saveDeadline=async(id)=>{
    const updated={...deadlines,[id]:localDL[id]};
    await stSet(SK_DEADLINES,updated);
    onUpdate(updated);
  };
  const toggleClose=async(id)=>{
    const updated={...deadlines,[id]:{...deadlines[id],closed:!deadlines[id].closed}};
    await stSet(SK_DEADLINES,updated);
    onUpdate(updated);
  };

  return(
    <div style={{background:"#fff",borderRadius:"16px",padding:"22px",
      boxShadow:"0 2px 16px rgba(0,0,0,.08)",marginBottom:"16px"}}>
      <h2 style={{margin:"0 0 16px",fontSize:"16px",fontWeight:"800",color:"#1a1a2e"}}>
        ⏰ 과목별 마감 관리
      </h2>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {SUBJECTS.map(sub=>{
          const dl=localDL[sub.id]||{deadline:"",closed:false};
          const subStudents=students.filter(s=>s.subjects?.[sub.id]?.submittedAt);
          const isClosedNow=isClosed(sub.id,deadlines);
          return(
            <div key={sub.id} style={{display:"flex",alignItems:"center",gap:"10px",
              padding:"12px 16px",borderRadius:"12px",flexWrap:"wrap",
              background: isClosedNow?"#fafafa":"#f8faff",
              border:`1.5px solid ${isClosedNow?"#e0e0e0":sub.color+"33"}`}}>
              <div style={{width:"100px",flexShrink:0}}>
                <div style={{fontSize:"14px",fontWeight:"800",color:isClosedNow?"#aaa":sub.color}}>
                  {sub.label}
                </div>
                <div style={{fontSize:"11px",marginTop:"2px"}}>
                  <span style={{color:"#16a34a",fontWeight:"700"}}>{subStudents.length}명 제출</span>
                  {deadlines[sub.id]?.deadline&&!deadlines[sub.id]?.closed&&!isClosedNow&&(
                    <span style={{color:"#aaa",marginLeft:"4px"}}>· {fmtTime(deadlines[sub.id].deadline)} 마감</span>
                  )}
                </div>
              </div>
              <div style={{padding:"4px 10px",borderRadius:"6px",fontSize:"11px",fontWeight:"700",
                background: isClosedNow?"#fee2e2":"#dcfce7",
                color: isClosedNow?"#dc2626":"#16a34a",flexShrink:0}}>
                {isClosedNow?"🔒 마감됨":"● 진행중"}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"6px",flex:1,minWidth:"200px"}}>
                <input type="datetime-local" value={dl.deadline||""}
                  onChange={e=>setLocalDL(p=>({...p,[sub.id]:{...p[sub.id],deadline:e.target.value}}))}
                  style={{padding:"6px 10px",border:"1.5px solid #ddd",borderRadius:"8px",
                    fontSize:"12px",fontFamily:"'Noto Sans KR',sans-serif",
                    outline:"none",flex:1,color:dl.deadline?"#333":"#aaa"}}/>
                <button onClick={()=>saveDeadline(sub.id)}
                  style={{padding:"7px 12px",background:"#1a4a8a",color:"#fff",border:"none",
                    borderRadius:"7px",fontSize:"11px",fontWeight:"700",cursor:"pointer",
                    fontFamily:"'Noto Sans KR',sans-serif",whiteSpace:"nowrap"}}>설정</button>
              </div>
              <button onClick={()=>toggleClose(sub.id)} style={{
                padding:"7px 14px",borderRadius:"8px",cursor:"pointer",
                border: deadlines[sub.id]?.closed?"2px solid #dc2626":"2px solid #16a34a",
                background: deadlines[sub.id]?.closed?"#fff0f0":"#f0fff4",
                color: deadlines[sub.id]?.closed?"#dc2626":"#16a34a",
                fontSize:"12px",fontWeight:"700",whiteSpace:"nowrap",
                fontFamily:"'Noto Sans KR',sans-serif"}}>
                {deadlines[sub.id]?.closed?"🔓 마감해제":"🔒 즉시마감"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Class Scores Panel ─────────────────────────────────────────────────────
function ClassScoresPanel({students, answerKey, answerScores}){
  const hasKey=Object.values(answerKey||{}).some(a=>a&&Object.keys(a).length>0);
  const [sortMode,setSortMode]=useState("default");  // default | numAsc | numDesc | nameAsc | totalDesc | totalAsc

  // Build scored list
  const allScoresUnsorted=students.map(stu=>({
    student:stu,
    scores:calculateScores(stu, answerKey, answerScores)
  }));

  // Sort
  const compareNum=(a,b)=>{
    const an=String(a||""); const bn=String(b||"");
    const ai=parseFloat(an); const bi=parseFloat(bn);
    const aIsNum=!isNaN(ai)&&isFinite(ai);
    const bIsNum=!isNaN(bi)&&isFinite(bi);
    if(aIsNum&&bIsNum) return ai-bi;
    if(aIsNum) return -1;
    if(bIsNum) return 1;
    return an.localeCompare(bn,"ko");
  };
  const allScores=[...allScoresUnsorted];
  if(sortMode==="numAsc")  allScores.sort((a,b)=>compareNum(a.student.num, b.student.num));
  else if(sortMode==="numDesc") allScores.sort((a,b)=>compareNum(b.student.num, a.student.num));
  else if(sortMode==="nameAsc") allScores.sort((a,b)=>(a.student.name||"").localeCompare(b.student.name||"","ko"));
  else if(sortMode==="totalDesc") allScores.sort((a,b)=>(b.scores._total||0)-(a.scores._total||0));
  else if(sortMode==="totalAsc")  allScores.sort((a,b)=>(a.scores._total||0)-(b.scores._total||0));


  const handleDownload=()=>{
    const today=new Date();
    const dateStr=today.getFullYear()+"-"+
      String(today.getMonth()+1).padStart(2,"0")+"-"+
      String(today.getDate()).padStart(2,"0");
    const headers=["번호","이름","수험번호",
      "국어","국어선택","수학","수학선택","영어",
      "탐구①","탐구①과목","탐구②","탐구②과목","총점","제출일시"];
    const rows=[headers];
    // Download uses currently-sorted list
    allScores.forEach((row,i)=>{
      const s=row.scores;
      const stu=row.student;
      const fmt=(v)=> v==null?"미제출": v==="미응시"?"미응시":v;
      const subData=(id)=> stu.subjects?.[id];
      const koreanSel=subData("korean")?.selection||"";
      const mathSel=subData("math")?.selection||"";
      const t1Sel=subData("tangu1")?.selection||"";
      const t2Sel=subData("tangu2")?.selection||"";
      const submittedTimes=SUBJECTS.map(sub=>subData(sub.id)?.submittedAt).filter(Boolean);
      const lastSubmit=submittedTimes.length>0?
        new Date(Math.max(...submittedTimes.map(t=>new Date(t).getTime()))).toLocaleString("ko-KR"):"";
      rows.push([
        i+1, stu.name||"", stu.num||"",
        s.korean.status==="absent"?"미응시":fmt(s.korean.raw),
        koreanSel,
        s.math.status==="absent"?"미응시":fmt(s.math.raw),
        mathSel,
        s.english.status==="absent"?"미응시":fmt(s.english.raw),
        s.tangu1.status==="absent"?"미응시":fmt(s.tangu1.raw),
        t1Sel,
        s.tangu2.status==="absent"?"미응시":fmt(s.tangu2.raw),
        t2Sel,
        s._total,
        lastSubmit
      ]);
    });
    downloadCSV(rows, "모의고사_성적_"+dateStr+".csv");
  };

  return(
    <div style={{background:"#fff",borderRadius:"16px",padding:"22px",
      boxShadow:"0 2px 16px rgba(0,0,0,.08)",marginBottom:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
        <h2 style={{margin:0,fontSize:"16px",fontWeight:"800",color:"#1a1a2e"}}>
          📊 학급 전체 점수 <span style={{fontSize:"12px",color:"#aaa",fontWeight:"600"}}>({students.length}명)</span>
        </h2>
        <div style={{display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap"}}>
          {/* Sort dropdown */}
          <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
            <span style={{fontSize:"11px",color:"#666",fontWeight:"600"}}>정렬:</span>
            <select value={sortMode} onChange={e=>setSortMode(e.target.value)}
              style={{padding:"5px 10px",border:"1.5px solid #d0d0d0",borderRadius:"7px",
                fontSize:"11px",fontWeight:"600",fontFamily:"'Noto Sans KR',sans-serif",
                cursor:"pointer",outline:"none",background:"#fff",color:"#444"}}>
              <option value="default">기본 (제출순)</option>
              <option value="numAsc">수험번호 ↑</option>
              <option value="numDesc">수험번호 ↓</option>
              <option value="nameAsc">이름 (가나다)</option>
              <option value="totalDesc">총점 ↓</option>
              <option value="totalAsc">총점 ↑</option>
            </select>
          </div>
          {!hasKey && (
            <div style={{fontSize:"11px",color:"#dc2626",fontWeight:"600",padding:"4px 10px",
              background:"#fff0f0",borderRadius:"6px"}}>⚠ 정답 미입력</div>
          )}
          <button onClick={handleDownload} disabled={students.length===0}
            style={{padding:"8px 16px",
              background:students.length===0?"#ccc":"linear-gradient(135deg,#15803d,#16a34a)",
              color:"#fff",border:"none",borderRadius:"8px",
              fontSize:"12px",fontWeight:"800",
              cursor:students.length===0?"not-allowed":"pointer",
              fontFamily:"'Noto Sans KR',sans-serif",
              boxShadow:students.length===0?"none":"0 2px 10px rgba(22,163,74,.3)",whiteSpace:"nowrap"}}>
            📥 엑셀 다운로드 (CSV)
          </button>
        </div>
      </div>

      {students.length===0?(
        <div style={{textAlign:"center",padding:"32px 0",color:"#bbb",fontSize:"13px"}}>
          제출된 답안이 없습니다
        </div>
      ):(
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px",
            fontFamily:"'Noto Sans KR',sans-serif"}}>
            <thead>
              <tr style={{background:"#f5f7ff"}}>
                <th style={{padding:"10px 8px",textAlign:"center",fontWeight:"700",color:"#555",borderBottom:"2px solid #d0daf0",width:"36px"}}>#</th>
                <th style={{padding:"10px 8px",textAlign:"left",fontWeight:"700",color:"#555",borderBottom:"2px solid #d0daf0",minWidth:"80px"}}>이름</th>
                <th style={{padding:"10px 8px",textAlign:"left",fontWeight:"700",color:"#555",borderBottom:"2px solid #d0daf0",minWidth:"80px"}}>수험번호</th>
                {SUBJECTS.map(sub=>(
                  <th key={sub.id} style={{padding:"10px 6px",textAlign:"center",fontWeight:"800",
                    color:sub.color,borderBottom:"2px solid "+sub.color+"33",minWidth:"66px"}}>
                    {sub.label}
                    <div style={{fontSize:"10px",fontWeight:"600",color:"#aaa",marginTop:"2px"}}>/{sub.fullScore}</div>
                  </th>
                ))}
                <th style={{padding:"10px 6px",textAlign:"center",fontWeight:"800",color:"#1a1a2e",
                  borderBottom:"2px solid #999",background:"#eef1f7",minWidth:"66px"}}>
                  총점
                  <div style={{fontSize:"10px",fontWeight:"600",color:"#aaa",marginTop:"2px"}}>/400</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {allScores.map((row,i)=>{
                const s=row.scores;
                const stu=row.student;
                return(
                  <tr key={stu.key||i} style={{borderBottom:"1px solid #f0f0f0"}}>
                    <td style={{padding:"9px 8px",textAlign:"center",color:"#888",fontWeight:"600"}}>{i+1}</td>
                    <td style={{padding:"9px 8px",fontWeight:"700",color:"#1a1a2e"}}>{stu.name||"(이름없음)"}</td>
                    <td style={{padding:"9px 8px",color:"#888"}}>{stu.num||"-"}</td>
                    {SUBJECTS.map(sub=>{
                      const sc=s[sub.id];
                      let display="-", bg="transparent", color="#bbb";
                      if(sc.status==="absent"){display="미응시"; color="#aaa";}
                      else if(sc.status==="missing"){display="-"; color="#ddd";}
                      else if(sc.raw!=null){
                        display=sc.raw;
                        color=sub.color;
                        const pct=sc.raw/sub.fullScore;
                        if(pct>=0.9) bg=sub.color+"15";
                      }
                      const selection=stu.subjects?.[sub.id]?.selection;
                      return(
                        <td key={sub.id} style={{padding:"9px 6px",textAlign:"center",background:bg}}>
                          <div style={{fontWeight:"700",color}}>{display}</div>
                          {selection && sc.status==="submitted" && (
                            <div style={{fontSize:"9px",color:"#aaa",marginTop:"1px"}}>{selection}</div>
                          )}
                        </td>
                      );
                    })}
                    <td style={{padding:"9px 6px",textAlign:"center",background:"#f5f7ff",
                      fontWeight:"900",color:"#1a1a2e",fontSize:"13px"}}>
                      {s._total||0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Selection Edit Modal (manually set student's selections) ──────────────
function SelectionEditModal({student, onSave, onCancel}){
  const [sel,setSel]=useState({
    korean: (student.subjects?.korean?.selection)||"",
    math:   (student.subjects?.math?.selection)||"",
    tangu1: (student.subjects?.tangu1?.selection)||"",
    tangu2: (student.subjects?.tangu2?.selection)||"",
  });
  const [saving,setSaving]=useState(false);

  const submittedSubjects = SUBJECTS.filter(s=>student.subjects?.[s.id]?.submittedAt);
  if(submittedSubjects.length===0){
    return null;
  }

  const handleSave=async()=>{
    setSaving(true);
    try{
      const students=(await stGet(SK_STUDENTS))||[];
      const idx=students.findIndex(s=>s && s.name===student.name && (s.num||"")===(student.num||""));
      if(idx>=0){
        const updated={...students[idx]};
        updated.subjects={...(updated.subjects||{})};
        // Update selection for each subject that was submitted
        if(updated.subjects.korean && sel.korean) updated.subjects.korean={...updated.subjects.korean, selection:sel.korean};
        if(updated.subjects.math && sel.math) updated.subjects.math={...updated.subjects.math, selection:sel.math};
        if(updated.subjects.tangu1 && sel.tangu1) updated.subjects.tangu1={...updated.subjects.tangu1, selection:sel.tangu1};
        if(updated.subjects.tangu2 && sel.tangu2) updated.subjects.tangu2={...updated.subjects.tangu2, selection:sel.tangu2};
        students[idx]=updated;
        await stSet(SK_STUDENTS, students);
        onSave();
      }
    } catch(e){
      console.error("Save selection error:", e);
    } finally{
      setSaving(false);
    }
  };

  const hasSubj=(id)=>!!student.subjects?.[id]?.submittedAt;
  const isAbsent=(id)=>!!student.subjects?.[id]?.absent;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:999,padding:"20px"}}>
      <div style={{background:"#fff",borderRadius:"18px",padding:"28px",maxWidth:"460px",
        width:"100%",boxShadow:"0 24px 80px rgba(0,0,0,.35)",
        maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"18px"}}>
          <div>
            <div style={{fontSize:"11px",color:"#888",fontWeight:"600",marginBottom:"2px"}}>선택과목 수동 설정</div>
            <h2 style={{margin:0,fontSize:"18px",fontWeight:"800",color:"#1a1a2e"}}>
              {student.name||"(이름없음)"}{student.num&&` · ${student.num}`}
            </h2>
          </div>
          <button onClick={onCancel} style={{padding:"4px 10px",background:"none",border:"none",
            color:"#999",fontSize:"20px",cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        <div style={{fontSize:"11px",color:"#666",marginBottom:"16px",padding:"10px 12px",
          background:"#fff8e8",borderRadius:"8px",border:"1px solid #f0d8a0"}}>
          💡 학생이 마킹하지 않은 선택과목을 교사가 수동으로 입력할 수 있습니다.
          (제출된 과목만 표시됩니다)
        </div>

        {/* 국어 */}
        {hasSubj("korean") && !isAbsent("korean") && (
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:"#1a4a8a",marginBottom:"6px"}}>
              📘 국어 선택과목
              {!student.subjects.korean.selection && <span style={{color:"#dc2626",marginLeft:"6px"}}>(미입력)</span>}
            </div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {KOREAN_OPT.map(o=>{
                const isSel=sel.korean===o.code;
                return <button key={o.code} onClick={()=>setSel(p=>({...p,korean:isSel?"":o.code}))}
                  style={{padding:"6px 14px",borderRadius:"7px",
                    border:isSel?"2px solid #1a4a8a":"1.5px solid #ccc",
                    background:isSel?"#1a4a8a":"#fff",color:isSel?"#fff":"#666",
                    fontSize:"12px",fontWeight:"600",cursor:"pointer",
                    fontFamily:"'Noto Sans KR',sans-serif"}}>
                  {o.code} {o.name}
                </button>;
              })}
            </div>
          </div>
        )}

        {/* 수학 */}
        {hasSubj("math") && !isAbsent("math") && (
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:"#7b2d8b",marginBottom:"6px"}}>
              📐 수학 선택과목
              {!student.subjects.math.selection && <span style={{color:"#dc2626",marginLeft:"6px"}}>(미입력)</span>}
            </div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {MATH_OPT.map(o=>{
                const isSel=sel.math===o.code;
                return <button key={o.code} onClick={()=>setSel(p=>({...p,math:isSel?"":o.code}))}
                  style={{padding:"6px 14px",borderRadius:"7px",
                    border:isSel?"2px solid #7b2d8b":"1.5px solid #ccc",
                    background:isSel?"#7b2d8b":"#fff",color:isSel?"#fff":"#666",
                    fontSize:"12px",fontWeight:"600",cursor:"pointer",
                    fontFamily:"'Noto Sans KR',sans-serif"}}>
                  {o.code} {o.name}
                </button>;
              })}
            </div>
          </div>
        )}

        {/* 탐구1 */}
        {hasSubj("tangu1") && !isAbsent("tangu1") && (
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:"#b5500a",marginBottom:"6px"}}>
              🔬 탐구① 과목
              {!student.subjects.tangu1.selection && <span style={{color:"#dc2626",marginLeft:"6px"}}>(미입력)</span>}
            </div>
            <select value={sel.tangu1} onChange={e=>setSel(p=>({...p,tangu1:e.target.value}))}
              style={{padding:"7px 12px",borderRadius:"7px",border:"1.5px solid #d0a060",
                background:"#fff",fontSize:"13px",fontWeight:"600",
                fontFamily:"'Noto Sans KR',sans-serif",cursor:"pointer",
                outline:"none",width:"100%"}}>
              <option value="">선택안함</option>
              {TANGU_SUBJECTS.filter(s=>s.code!==sel.tangu2).map(s=>(
                <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* 탐구2 */}
        {hasSubj("tangu2") && !isAbsent("tangu2") && (
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:"#8a1a2e",marginBottom:"6px"}}>
              🔬 탐구② 과목
              {!student.subjects.tangu2.selection && <span style={{color:"#dc2626",marginLeft:"6px"}}>(미입력)</span>}
            </div>
            <select value={sel.tangu2} onChange={e=>setSel(p=>({...p,tangu2:e.target.value}))}
              style={{padding:"7px 12px",borderRadius:"7px",border:"1.5px solid #d0a060",
                background:"#fff",fontSize:"13px",fontWeight:"600",
                fontFamily:"'Noto Sans KR',sans-serif",cursor:"pointer",
                outline:"none",width:"100%"}}>
              <option value="">선택안함</option>
              {TANGU_SUBJECTS.filter(s=>s.code!==sel.tangu1).map(s=>(
                <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{display:"flex",gap:"7px",marginTop:"20px"}}>
          <button onClick={onCancel} style={{flex:1,padding:"11px",background:"#f5f5f5",
            color:"#666",border:"none",borderRadius:"9px",fontSize:"13px",fontWeight:"700",
            cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{flex:2,padding:"11px",
            background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",color:"#fff",
            border:"none",borderRadius:"9px",fontSize:"13px",fontWeight:"700",
            cursor:saving?"default":"pointer",fontFamily:"'Noto Sans KR',sans-serif",
            opacity:saving?0.7:1}}>
            {saving?"저장 중...":"💾 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Teacher Dashboard ──────────────────────────────────────────────────────
function TeacherDashboard({students,deadlines,answerKey,answerScores,
  onUpdateDeadlines,onEditKey,onGrade,onLogout,onChangePw,onClearAll,onRefreshStudents}){
  const [changePw,setChangePw]=useState(false);
  const [pw1,setPw1]=useState(""); const [pw2,setPw2]=useState(""); const [pwErr,setPwErr]=useState("");
  const [confirmClear,setConfirmClear]=useState(false);
  const [editingStudent,setEditingStudent]=useState(null);

  const handleChangePw=()=>{
    if(pw1.length<4){setPwErr("4자리 이상 입력하세요");return;}
    if(pw1!==pw2){setPwErr("비밀번호가 일치하지 않습니다");return;}
    onChangePw(pw1);setChangePw(false);setPw1("");setPw2("");setPwErr("");
  };

  const hasKey=Object.values(answerKey).some(a=>Object.keys(a).length>0);

  return(
    <div style={{minHeight:"100vh",background:"#eef1f7",fontFamily:"'Noto Sans KR',sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1a0a2e,#3b1a6b)",padding:"16px 20px",
        boxShadow:"0 2px 16px rgba(0,0,0,.25)"}}>
        <div style={{maxWidth:"920px",margin:"0 auto",display:"flex",justifyContent:"space-between",
          alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
          <div>
            <div style={{fontSize:"10px",color:"#c8a8e8",letterSpacing:".12em",fontWeight:"600",marginBottom:"1px"}}>
              교사 관리 패널
            </div>
            <h1 style={{margin:0,fontSize:"18px",fontWeight:"800",color:"#fff"}}>📋 제출·채점 관리</h1>
          </div>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
            <button onClick={onEditKey} style={{padding:"7px 13px",background:"rgba(255,200,100,.15)",
              color:"#fcd34d",border:"1.5px solid #fcd34d44",borderRadius:"8px",
              fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>
              🔑 정답·배점 입력</button>
            <button onClick={()=>setChangePw(v=>!v)} style={{padding:"7px 13px",
              background:"rgba(255,255,255,.1)",color:"#ccc",
              border:"1.5px solid rgba(255,255,255,.2)",borderRadius:"8px",
              fontSize:"12px",fontWeight:"600",cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>
              🔒 비밀번호</button>
            <button onClick={onLogout} style={{padding:"7px 13px",
              background:"rgba(255,255,255,.07)",color:"#aaa",
              border:"1.5px solid rgba(255,255,255,.12)",borderRadius:"8px",
              fontSize:"12px",fontWeight:"600",cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>
              로그아웃</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:"920px",margin:"0 auto",padding:"20px 14px"}}>
        {changePw&&(
          <div style={{background:"#fff",borderRadius:"14px",padding:"18px",marginBottom:"14px",
            border:"2px solid #e0d0f8",boxShadow:"0 2px 12px rgba(0,0,0,.07)"}}>
            <h3 style={{margin:"0 0 12px",fontSize:"14px",fontWeight:"800",color:"#5b2a9b"}}>비밀번호 변경</h3>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"flex-end"}}>
              <input type="password" value={pw1} onChange={e=>setPw1(e.target.value)} placeholder="새 비밀번호"
                style={{padding:"8px 12px",border:"1.5px solid #ddd",borderRadius:"8px",fontSize:"13px",
                  outline:"none",width:"130px",fontFamily:"'Noto Sans KR',sans-serif"}}/>
              <input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="재입력"
                style={{padding:"8px 12px",border:"1.5px solid #ddd",borderRadius:"8px",fontSize:"13px",
                  outline:"none",width:"130px",fontFamily:"'Noto Sans KR',sans-serif"}}/>
              <button onClick={handleChangePw} style={{padding:"9px 16px",background:"#5b2a9b",color:"#fff",
                border:"none",borderRadius:"8px",fontSize:"12px",fontWeight:"700",cursor:"pointer",
                fontFamily:"'Noto Sans KR',sans-serif"}}>변경</button>
              <button onClick={()=>setChangePw(false)} style={{padding:"9px 14px",background:"#f0f0f0",
                color:"#666",border:"none",borderRadius:"8px",fontSize:"12px",cursor:"pointer"}}>취소</button>
            </div>
            {pwErr&&<div style={{color:"#dc2626",fontSize:"12px",marginTop:"7px",fontWeight:"600"}}>{pwErr}</div>}
          </div>
        )}

        <DeadlinePanel deadlines={deadlines} students={students} onUpdate={onUpdateDeadlines}/>

        <ClassScoresPanel students={students} answerKey={answerKey} answerScores={answerScores}/>

        <div style={{background:"#fff",borderRadius:"16px",padding:"22px",
          boxShadow:"0 2px 16px rgba(0,0,0,.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
            <h2 style={{margin:0,fontSize:"16px",fontWeight:"800",color:"#1a1a2e"}}>
              제출 현황 <span style={{fontSize:"13px",color:"#aaa",fontWeight:"600"}}>({students.length}명)</span>
            </h2>
            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
              {hasKey&&<div style={{fontSize:"12px",color:"#16a34a",fontWeight:"700"}}>✓ 정답 입력됨</div>}
              {students.length>0 && !confirmClear && (
                <button onClick={()=>setConfirmClear(true)} style={{padding:"5px 10px",
                  background:"transparent",color:"#dc2626",border:"1px solid #fca5a5",
                  borderRadius:"6px",fontSize:"11px",fontWeight:"600",cursor:"pointer",
                  fontFamily:"'Noto Sans KR',sans-serif"}}>전체 초기화</button>
              )}
              {confirmClear && (
                <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                  <span style={{fontSize:"11px",color:"#dc2626",fontWeight:"700"}}>모든 제출 삭제?</span>
                  <button onClick={()=>{onClearAll();setConfirmClear(false);}} style={{padding:"4px 10px",
                    background:"#dc2626",color:"#fff",border:"none",borderRadius:"5px",
                    fontSize:"11px",fontWeight:"700",cursor:"pointer"}}>확인</button>
                  <button onClick={()=>setConfirmClear(false)} style={{padding:"4px 10px",
                    background:"#f5f5f5",color:"#666",border:"none",borderRadius:"5px",
                    fontSize:"11px",cursor:"pointer"}}>취소</button>
                </div>
              )}
            </div>
          </div>

          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"18px"}}>
            {SUBJECTS.map(sub=>{
              const cnt=students.filter(s=>s.subjects?.[sub.id]?.submittedAt).length;
              return(
                <div key={sub.id} style={{padding:"8px 14px",background:`${sub.color}11`,
                  borderRadius:"10px",border:`1.5px solid ${sub.color}33`,textAlign:"center"}}>
                  <div style={{fontSize:"13px",fontWeight:"800",color:sub.color}}>{sub.label}</div>
                  <div style={{fontSize:"11px",color:"#888",marginTop:"2px"}}>{cnt}명 제출</div>
                </div>
              );
            })}
          </div>

          {students.length===0?(
            <div style={{textAlign:"center",padding:"44px 0",color:"#ccc"}}>
              <div style={{fontSize:"32px",marginBottom:"8px"}}>📭</div>
              <div style={{fontSize:"14px",fontWeight:"600"}}>아직 제출된 답안이 없습니다</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
              {students.map((stu,i)=>{
                // Check if any submitted subject has missing selection
                const missingSel=SUBJECTS.some(s=>{
                  if(s.id==="english") return false;
                  const r=stu.subjects?.[s.id];
                  return r && r.submittedAt && !r.absent && !r.selection;
                });
                return(
                <div key={stu.key||i} style={{padding:"12px 16px",
                  background: missingSel?"#fff8e8":"#f8f9ff",
                  borderRadius:"10px",border: missingSel?"1.5px solid #f0c060":"1px solid #e8eaf0",
                  display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
                  <div style={{width:"26px",height:"26px",borderRadius:"50%",flexShrink:0,
                    background:"linear-gradient(135deg,#1a4a8a,#7b2d8b)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    color:"#fff",fontSize:"11px",fontWeight:"800"}}>{i+1}</div>
                  <div style={{flex:1,minWidth:"100px"}}>
                    <div style={{fontSize:"14px",fontWeight:"700",color:"#1a1a2e"}}>
                      {stu.name||"(이름없음)"}
                      {stu.num&&<span style={{fontSize:"12px",color:"#888",marginLeft:"6px"}}>{stu.num}</span>}
                    </div>
                    <div style={{fontSize:"10px",color:"#bbb",marginTop:"2px"}}>
                      가입: {fmtTime(stu.createdAt)}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                    {SUBJECTS.map(sub=>{
                      const rec=stu.subjects?.[sub.id];
                      const done=rec?.submittedAt;
                      const abs=rec?.absent;
                      return(
                        <span key={sub.id} style={{fontSize:"10px",fontWeight:"700",
                          padding:"3px 7px",borderRadius:"5px",
                          background:done?(abs?"#f3f4f6":`${sub.color}18`):"#f5f5f5",
                          color:done?(abs?"#aaa":sub.color):"#ccc",
                          border:`1px solid ${done?(abs?"#e0e0e0":sub.color+"44"):"#e8e8e8"}`}}>
                          {done?(abs?sub.label+"✗":sub.label+"✓"):sub.label}
                        </span>
                      );
                    })}
                  </div>
                  {SUBJECTS.some(s=>stu.subjects?.[s.id]?.submittedAt) && (
                    <button onClick={()=>setEditingStudent(stu)} style={{
                      padding:"7px 12px",
                      background: missingSel?"#f0c060":"#fff",
                      color: missingSel?"#fff":"#7a5000",
                      border: missingSel?"none":"1.5px solid #f0c060",
                      borderRadius:"8px",fontSize:"11px",
                      fontWeight:"700",cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif",
                      whiteSpace:"nowrap"}}>
                      📝 선택과목 {missingSel?"입력 필요":"수정"}</button>
                  )}
                  {hasKey&&SUBJECTS.some(s=>stu.subjects?.[s.id]?.submittedAt)&&(
                    <button onClick={()=>onGrade(stu)} style={{
                      padding:"7px 14px",background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",
                      color:"#fff",border:"none",borderRadius:"8px",fontSize:"12px",
                      fontWeight:"700",cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif",
                      boxShadow:"0 2px 8px rgba(26,58,107,.3)",whiteSpace:"nowrap"}}>
                      📊 상세 채점</button>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {editingStudent && (
        <SelectionEditModal student={editingStudent}
          onSave={()=>{ setEditingStudent(null); onRefreshStudents&&onRefreshStudents(); }}
          onCancel={()=>setEditingStudent(null)}/>
      )}
    </div>
  );
}

// ── Teacher Key Input (selection toggle + per-question scores) ────────────
function TeacherKeyInput({answerKey,setAnswerKey,answerScores,setAnswerScores,onDone}){
  const [activeSubject,setActiveSubject]=useState("korean");
  const [activeSel,setActiveSel]=useState({korean:"언매",math:"확통",tangu:"생윤"});

  const getSelOptions=(subId)=>{
    if(subId==="korean") return KOREAN_OPT;
    if(subId==="math") return MATH_OPT;
    if(subId==="tangu1"||subId==="tangu2") return TANGU_SUBJECTS;
    return null;
  };
  const getCurSel=()=>{
    if(activeSubject==="korean") return activeSel.korean;
    if(activeSubject==="math") return activeSel.math;
    if(activeSubject==="tangu1"||activeSubject==="tangu2") return activeSel.tangu;
    return null;
  };
  const setCurSel=(v)=>{
    if(activeSubject==="korean") setActiveSel(p=>({...p,korean:v}));
    else if(activeSubject==="math") setActiveSel(p=>({...p,math:v}));
    else if(activeSubject==="tangu1"||activeSubject==="tangu2") setActiveSel(p=>({...p,tangu:v}));
  };
  const curSel=getCurSel();
  const cur=SUBJECTS.find(s=>s.id===activeSubject);

  const curAnswers=getKeyFor(answerKey, activeSubject, curSel);
  const curScores=getKeyFor(answerScores, activeSubject, curSel);

  const countAnswered=(subId, selection)=>{
    return Object.values(getKeyFor(answerKey, subId, selection)).filter(v=>v!=null).length;
  };
  const totalAns=countAnswered(activeSubject, curSel);

  const curScoreTotal=(()=>{
    if(!cur) return 0;
    let total=0;
    for(let i=1;i<=cur.count;i++){
      const sc=curScores[i];
      total += (sc!=null && sc!=="") ? Number(sc) : defaultQScore(activeSubject);
    }
    return total;
  })();

  const handleAnsSelect=(qNum,val)=>{
    setAnswerKey(prev=>{
      const next={...prev};
      if(activeSubject==="english"){
        next.english={...(prev.english||{}),[qNum]:val};
      } else if(activeSubject==="korean"){
        next.korean={...(prev.korean||{}),
          [curSel]:{...((prev.korean&&prev.korean[curSel])||{}),[qNum]:val}};
      } else if(activeSubject==="math"){
        next.math={...(prev.math||{}),
          [curSel]:{...((prev.math&&prev.math[curSel])||{}),[qNum]:val}};
      } else if(activeSubject==="tangu1"||activeSubject==="tangu2"){
        next.tangu={...(prev.tangu||{}),
          [curSel]:{...((prev.tangu&&prev.tangu[curSel])||{}),[qNum]:val}};
      }
      return next;
    });
  };

  const handleScoreChange=(qNum,val)=>{
    setAnswerScores(prev=>{
      const next={...prev};
      if(activeSubject==="english"){
        next.english={...(prev.english||{}),[qNum]:val};
      } else if(activeSubject==="korean"){
        next.korean={...(prev.korean||{}),
          [curSel]:{...((prev.korean&&prev.korean[curSel])||{}),[qNum]:val}};
      } else if(activeSubject==="math"){
        next.math={...(prev.math||{}),
          [curSel]:{...((prev.math&&prev.math[curSel])||{}),[qNum]:val}};
      } else if(activeSubject==="tangu1"||activeSubject==="tangu2"){
        next.tangu={...(prev.tangu||{}),
          [curSel]:{...((prev.tangu&&prev.tangu[curSel])||{}),[qNum]:val}};
      }
      return next;
    });
  };

  const handleSave=async()=>{
    await stSet(SK_KEY,{answers:answerKey});
    await stSet(SK_SCORES,answerScores);
    onDone();
  };

  const resetScores=()=>{
    setAnswerScores(prev=>{
      const next={...prev};
      if(activeSubject==="english") next.english={};
      else if(activeSubject==="korean") next.korean={...(prev.korean||{}),[curSel]:{}};
      else if(activeSubject==="math") next.math={...(prev.math||{}),[curSel]:{}};
      else if(activeSubject==="tangu1"||activeSubject==="tangu2") next.tangu={...(prev.tangu||{}),[curSel]:{}};
      return next;
    });
  };

  const selOptions=getSelOptions(activeSubject);

  return(
    <div style={{minHeight:"100vh",background:"#eef1f7",fontFamily:"'Noto Sans KR',sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1a0a2e,#3b1a6b)",padding:"13px 18px",
        boxShadow:"0 2px 16px rgba(0,0,0,.25)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:"920px",margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:"10px",flexWrap:"wrap",gap:"7px"}}>
            <div>
              <div style={{fontSize:"10px",color:"#c8a8e8",letterSpacing:".12em",fontWeight:"600",marginBottom:"1px"}}>
                교사 전용 · 정답·배점 입력
              </div>
              <h1 style={{margin:0,fontSize:"17px",fontWeight:"800",color:"#fff"}}>🔑 선택과목별 정답·배점 입력</h1>
            </div>
            <button onClick={handleSave} style={{padding:"8px 18px",
              background:"linear-gradient(135deg,#fcd34d,#f59e0b)",color:"#1a1a00",
              border:"none",borderRadius:"8px",fontSize:"12px",fontWeight:"800",cursor:"pointer",
              fontFamily:"'Noto Sans KR',sans-serif",boxShadow:"0 2px 10px rgba(245,158,11,.4)"}}>
              💾 저장 후 대시보드</button>
          </div>
          <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
            {SUBJECTS.filter(s=>s.id!=="tangu2").map(sub=>{
              const isActive=activeSubject===sub.id;
              const displayLabel = sub.id==="tangu1" ? "탐구" : sub.label;
              return(
                <button key={sub.id} onClick={()=>setActiveSubject(sub.id)} style={{
                  padding:"6px 11px",borderRadius:"7px",
                  border:isActive?`2px solid ${sub.color}`:"2px solid transparent",
                  background:isActive?"#fff":"rgba(255,255,255,.1)",
                  color:isActive?sub.color:"#ccc",
                  fontSize:"12px",fontWeight:"700",cursor:"pointer",
                  fontFamily:"'Noto Sans KR',sans-serif"}}>
                  {displayLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{maxWidth:"920px",margin:"0 auto",padding:"16px 14px"}}>
        <div style={{background:"linear-gradient(90deg,#3b1a6b,#5b2a9b)",borderRadius:"12px",
          padding:"10px 16px",marginBottom:"12px",color:"#fff",fontSize:"12px",
          display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
          <span>🔑</span>
          <span style={{flex:1}}>
            {activeSubject==="english"
              ? "영어는 선택과목이 없습니다. 정답과 배점만 입력하세요."
              : "선택과목을 먼저 고른 후 정답·배점을 입력하세요. 학생이 선택한 과목에 맞게 자동 채점됩니다."}
          </span>
        </div>

        {selOptions && (
          <div style={{background:"#fff",borderRadius:"12px",padding:"12px 16px",marginBottom:"12px",
            boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:"#666",marginBottom:"8px"}}>
              {activeSubject==="korean"?"국어 선택과목":
                activeSubject==="math"?"수학 선택과목":
                "탐구 과목 (탐구① · 탐구② 공통)"}
            </div>
            {(activeSubject==="korean"||activeSubject==="math") ? (
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                {selOptions.map(opt=>{
                  const isSel = curSel===opt.code;
                  const cnt = countAnswered(activeSubject, opt.code);
                  return(
                    <button key={opt.code} onClick={()=>setCurSel(opt.code)}
                      style={{padding:"6px 14px",borderRadius:"8px",
                        border:isSel?`2px solid ${cur.color}`:"1.5px solid #ccc",
                        background:isSel?cur.color:"#fff",color:isSel?"#fff":"#666",
                        fontSize:"12px",fontWeight:"700",cursor:"pointer",
                        fontFamily:"'Noto Sans KR',sans-serif",
                        display:"flex",alignItems:"center",gap:"6px"}}>
                      <span>{opt.code} · {opt.name}</span>
                      <span style={{fontSize:"10px",opacity:.85,
                        background:isSel?"rgba(255,255,255,.2)":"#f0f0f0",
                        padding:"1px 6px",borderRadius:"4px"}}>
                        {cnt}/{cur.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
                <select value={curSel||""} onChange={e=>setCurSel(e.target.value)}
                  style={{padding:"7px 14px",borderRadius:"8px",border:`2px solid ${cur.color}`,
                    background:"#fff",fontSize:"13px",fontWeight:"700",
                    fontFamily:"'Noto Sans KR',sans-serif",cursor:"pointer",
                    outline:"none",color:cur.color,minWidth:"200px"}}>
                  {selOptions.map(s=>{
                    const cnt = countAnswered(activeSubject, s.code);
                    const has = cnt>0?` ✓ ${cnt}/${cur.count}`:"";
                    return <option key={s.code} value={s.code}>{s.code} · {s.name}{has}</option>;
                  })}
                </select>
                <span style={{fontSize:"11px",color:"#888",fontWeight:"600"}}>
                  ✓ 표시는 정답이 입력된 과목입니다
                </span>
              </div>
            )}
          </div>
        )}

        <div style={{background:"#fff",borderRadius:"16px",padding:"20px",
          boxShadow:"0 2px 16px rgba(0,0,0,.08)",borderTop:`4px solid ${cur.color}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
            <h2 style={{margin:0,fontSize:"18px",fontWeight:"800",color:cur.color}}>
              {cur.label}{curSel?` (${curSel})`:""} 정답·배점
              <span style={{fontSize:"12px",fontWeight:"600",color:"#aaa",marginLeft:"8px"}}>
                {totalAns}/{cur.count} 입력
              </span>
            </h2>
            <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
              <div style={{padding:"6px 14px",borderRadius:"8px",
                background: curScoreTotal===cur.fullScore?"#f0fff4":curScoreTotal>cur.fullScore?"#fff0f0":"#fff8e8",
                border: curScoreTotal===cur.fullScore?"1.5px solid #86efac":curScoreTotal>cur.fullScore?"1.5px solid #fca5a5":"1.5px solid #f0c060",
                fontSize:"12px",fontWeight:"800",
                color: curScoreTotal===cur.fullScore?"#16a34a":curScoreTotal>cur.fullScore?"#dc2626":"#7a5000"}}>
                배점합계: {curScoreTotal} / {cur.fullScore}점
              </div>
              <button onClick={resetScores}
                style={{padding:"5px 12px",background:"#f5f5f5",color:"#666",border:"none",
                  borderRadius:"7px",fontSize:"11px",fontWeight:"600",cursor:"pointer",
                  fontFamily:"'Noto Sans KR',sans-serif"}}>배점 초기화</button>
            </div>
          </div>
          <OMRGrid count={cur.count} answers={curAnswers}
            onSelect={handleAnsSelect}
            color={cur.color} columns={cur.count===20?2:3}
            shortAnswers={activeSubject==="math"?MATH_SHORT_ANSWER:[]}
            scoreMode={true}
            scoresMap={curScores}
            onScoreChange={handleScoreChange}
            subjectId={activeSubject}/>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:"12px"}}>
          <button onClick={handleSave} style={{padding:"9px 22px",
            background:"linear-gradient(135deg,#3b1a6b,#5b2a9b)",color:"#fff",
            border:"none",borderRadius:"9px",fontSize:"12px",fontWeight:"700",cursor:"pointer",
            fontFamily:"'Noto Sans KR',sans-serif",boxShadow:"0 3px 12px rgba(90,40,155,.35)"}}>
            💾 저장 후 대시보드
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Grading Screen ─────────────────────────────────────────────────────────
function GradingScreen({student,answerKey,answerScores,onBack}){
  const [detail,setDetail]=useState(null);
  const {name,num,subjects={}}=student;

  const scoresResult=calculateScores(student, answerKey, answerScores);

  const results=SUBJECTS.map(sub=>{
    const r=scoresResult[sub.id];
    return {...sub, ...r};
  });
  const totalRaw=scoresResult._total;

  const det=detail?SUBJECTS.find(s=>s.id===detail):null;
  const subLabel=id=>{
    const s=subjects[id];
    const base=SUBJECTS.find(sub=>sub.id===id)?.label||id;
    if(s?.selection) return `${base}(${s.selection})`;
    return base;
  };

  return(
    <div style={{minHeight:"100vh",background:"#eef1f7",fontFamily:"'Noto Sans KR',sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",padding:"16px 20px",
        boxShadow:"0 2px 16px rgba(0,0,0,.25)"}}>
        <div style={{maxWidth:"920px",margin:"0 auto",display:"flex",
          justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:"10px",color:"#8ab4e8",letterSpacing:".12em",fontWeight:"600",marginBottom:"1px"}}>채점 결과</div>
            <h1 style={{margin:0,fontSize:"18px",fontWeight:"800",color:"#fff"}}>
              {name||"(이름없음)"}{num&&<span style={{fontSize:"13px",color:"#8ab4e8",marginLeft:"8px"}}>· {num}</span>}
            </h1>
          </div>
          <button onClick={onBack} style={{padding:"8px 16px",background:"rgba(255,255,255,.12)",
            color:"#fff",border:"1.5px solid rgba(255,255,255,.25)",borderRadius:"8px",
            fontSize:"12px",fontWeight:"600",cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif"}}>
            ← 돌아가기</button>
        </div>
      </div>
      <div style={{maxWidth:"920px",margin:"0 auto",padding:"22px 14px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:"10px",marginBottom:"16px"}}>
          {results.map(r=>{
            const isMissing=r.status==="missing";
            const isAbsent=r.status==="absent";
            return(
            <div key={r.id} style={{background:"#fff",borderRadius:"14px",padding:"16px",
              borderTop:`4px solid ${r.color}`,boxShadow:"0 2px 10px rgba(0,0,0,.07)",
              opacity: isMissing ? 0.5 : 1, cursor: (isAbsent||isMissing) ? "default" : "pointer",
              transition:"transform .13s"}}
              onClick={()=>{ if(!isAbsent&&!isMissing) setDetail(detail===r.id?null:r.id); }}
              onMouseEnter={e=>{if(!isAbsent&&!isMissing){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 18px rgba(0,0,0,.12)";}}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,.07)";}}>
              <div style={{fontSize:"11px",fontWeight:"700",color:r.color,marginBottom:"6px"}}>{subLabel(r.id)}</div>
              {isMissing && <div style={{fontSize:"14px",color:"#ccc",fontWeight:"700"}}>미제출</div>}
              {isAbsent && <div style={{fontSize:"14px",color:"#aaa",fontWeight:"700"}}>미응시</div>}
              {!isMissing && !isAbsent && (
                <>
                  <div style={{fontSize:"26px",fontWeight:"900",color:"#1a1a2e",lineHeight:1}}>{r.raw!=null?r.raw:"-"}</div>
                  <div style={{fontSize:"10px",color:"#ccc",marginTop:"2px"}}>/{r.fullScore}점</div>
                  <div style={{marginTop:"8px",fontSize:"11px"}}>
                              <span style={{color:"#16a34a",fontWeight:"700"}}>{r.correct}정 </span>
                    <span style={{color:"#dc2626",fontWeight:"700"}}>{r.keyed-r.correct}오</span>
                  </div>
                  <div style={{fontSize:"10px",color:r.color,opacity:.6,marginTop:"5px",fontWeight:"600"}}>
                    {detail===r.id?"▲ 닫기":"▼ 문항별"}
                  </div>
                </>
              )}
            </div>
          );})}
          <div style={{background:"linear-gradient(135deg,#0f1f3d,#1a3a6b)",borderRadius:"14px",
            padding:"16px",boxShadow:"0 2px 12px rgba(0,0,0,.15)"}}>
            <div style={{fontSize:"11px",fontWeight:"700",color:"#8ab4e8",marginBottom:"6px"}}>총점</div>
            <div style={{fontSize:"26px",fontWeight:"900",color:"#fff",lineHeight:1}}>
              {Math.round((totalRaw||0)*10)/10}
            </div>
            <div style={{fontSize:"10px",color:"#8ab4e8",marginTop:"2px"}}>
              /{results.reduce((s,r)=>s+r.fullScore,0)}점
            </div>
            <div style={{marginTop:"8px",fontSize:"11px",color:"#a0b8d8"}}>
              {results.reduce((s,r)=>s+(r.correct||0),0)}문항 정답
            </div>
          </div>
        </div>
        {det && scoresResult[det.id]?.status==="submitted" && (
          <div style={{background:"#fff",borderRadius:"16px",padding:"22px",
            boxShadow:"0 2px 16px rgba(0,0,0,.08)",borderTop:`4px solid ${det.color}`}}>
            <h3 style={{margin:"0 0 14px",fontSize:"15px",fontWeight:"800",color:det.color}}>
              {subLabel(det.id)} 문항별 채점
              <span style={{fontSize:"11px",fontWeight:"500",color:"#aaa",marginLeft:"8px"}}>
                초록=정답 · 빨강=오답 · 초록테두리=정답번호
              </span>
            </h3>
            <OMRGrid count={det.count}
              answers={student.subjects[det.id]?.answers||{}}
              color={det.color} columns={det.count===20?2:3}
              answerKey={getKeyFor(answerKey, det.id, student.subjects[det.id]?.selection)}
              showResult={true}
              shortAnswers={det.id==="math"?MATH_SHORT_ANSWER:[]}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root App ───────────────────────────────────────────────────────────────
export default function App(){
  const [screen,setScreen]=useState("student");
  const [storedPw,setStoredPw]=useState(null);
  const [students,setStudents]=useState([]);
  const [answerKey,setAnswerKey]=useState(emptyKey());
  const [answerScores,setAnswerScores]=useState(emptyScores());
  const [deadlines,setDeadlines]=useState(emptyDL());
  const [gradingTarget,setGradingTarget]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    (async()=>{
      const pw=await stGet(SK_PW);
      const stu=await stGet(SK_STUDENTS);
      const key=await stGet(SK_KEY);
      const scr=await stGet(SK_SCORES);
      const dl=await stGet(SK_DEADLINES);
      if(pw) setStoredPw(pw);
      if(stu) setStudents(stu);
      if(key) setAnswerKey(key.answers||emptyKey());
      if(scr) setAnswerScores(scr);
      if(dl)  setDeadlines({...emptyDL(),...dl});
      setLoading(false);
    })();
  },[]);

  const refreshDeadlines=async()=>{
    const dl=await stGet(SK_DEADLINES);
    if(dl) setDeadlines({...emptyDL(),...dl});
  };
  const refreshStudents=async()=>{
    const stu=await stGet(SK_STUDENTS);
    if(stu) setStudents(stu);
  };
  const handleChangePw=async(pw)=>{
    setStoredPw(pw);
    await stSet(SK_PW,pw);
  };
  const handleClearAll=async()=>{
    await stSet(SK_STUDENTS,[]);
    setStudents([]);
  };
  const handleUpdateDeadlines=(dl)=>setDeadlines(dl);
  const handleGrade=(stu)=>{setGradingTarget(stu);setScreen("grading");};

  if(loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"#eef1f7",fontFamily:"'Noto Sans KR',sans-serif"}}>
      <div style={{textAlign:"center",color:"#aaa"}}>
        <div style={{fontSize:"28px",marginBottom:"8px"}}>⏳</div>
        <div style={{fontSize:"14px",fontWeight:"600"}}>불러오는 중...</div>
      </div>
    </div>
  );

  if(screen==="teacher_auth") return(
    <>
      <div style={{minHeight:"100vh",background:"#eef1f7"}}/>
      <PasswordModal storedPw={storedPw}
        onSuccess={()=>{refreshStudents();setScreen("teacher_dashboard");}}
        onCancel={()=>setScreen("student")}/>
    </>
  );
  if(screen==="teacher_dashboard") return(
    <TeacherDashboard students={students} deadlines={deadlines}
      answerKey={answerKey} answerScores={answerScores}
      onUpdateDeadlines={handleUpdateDeadlines}
      onEditKey={()=>setScreen("teacher_key")}
      onGrade={handleGrade}
      onLogout={()=>setScreen("student")}
      onChangePw={handleChangePw}
      onClearAll={handleClearAll}
      onRefreshStudents={refreshStudents}/>
  );
  if(screen==="teacher_key") return(
    <TeacherKeyInput answerKey={answerKey} setAnswerKey={setAnswerKey}
      answerScores={answerScores} setAnswerScores={setAnswerScores}
      onDone={()=>setScreen("teacher_dashboard")}/>
  );
  if(screen==="grading"&&gradingTarget) return(
    <GradingScreen student={gradingTarget} answerKey={answerKey}
      answerScores={answerScores}
      onBack={()=>{refreshStudents();setScreen("teacher_dashboard");}}/>
  );
  return(
    <StudentView deadlines={deadlines}
      onTeacherLogin={()=>setScreen("teacher_auth")}
      onRefreshDeadlines={refreshDeadlines}/>
  );
}
