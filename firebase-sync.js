// HILFU FC v8.4 - 공개 열람, 경기 이력, 10개 순환 자동 백업, 편집자 복원
// Firebase 프로젝트의 공개 web config는 firebase-config.js에 있습니다.
const $ = id => document.getElementById(id);
const d = $('syncDialog');
const button = $('cloudBtn');
const badge = $('syncBadge');
const configHelp = $('cloudConfigHelp');
const signedOutPanel = $('cloudSignedOut');
const signedInPanel = $('cloudSignedIn');
const choosePanel = $('cloudChoose');
const statusLine = $('cloudStatus');
const syncedKey = uid => `hilfu-fc-last-cloud-v7-${uid}`;
const fingerprint = data => JSON.stringify(data);
let auth=null,db=null,currentUser=null,docRef=null,personalPaused=false;
let active=false,firstSnapshot=true,knownCloud=null,knownSignature=null,lastServerSignature=null;
let localDirty=false,writeRunning=false,pendingTimer=null,unsub=null;
let firestoreFns=null, authFns=null;
function setStatus(message,kind=''){
  statusLine.textContent=message;
  badge.textContent=kind==='online'?'연결됨':kind==='warn'?'확인 필요':'미연결';
  badge.className='syncbadge'+(kind==='online'?' online':kind==='warn'?' warn':'');
  if(currentUser) $('cloudSyncState').textContent=message;
  const phase = /저장 실패|연결 실패|오류|충돌|확인 필요|동기화 실패|로그인 확인 실패/i.test(message)?'error'
    : /저장 완료/.test(message)?'saved'
    : /저장 중/.test(message)?'saving'
    : /저장 대기|선택하세요/.test(message)?'pending'
    : kind==='online'?'synced':'idle';
  window.HILFU_SYNC_UI?.set('personal',phase,message,{clearSaved:!currentUser});
  // 개인 동기화 준비 상태가 바뀌면 복사 버튼 활성 상태도 즉시 갱신합니다.
  if(window.HILFU_TEAM) setTeamButtons();
}
const setVisible = (element,visible) => {element.hidden=!visible;if(element===choosePanel && window.HILFU_TEAM)setTeamButtons();};
function pendingCount(){return JSON.parse(localStorage.getItem('hilfu-fc-app-v1')||'{}')?.players?.length||0;}
function choose(title,message,remoteExists){
  setVisible(choosePanel,true);$('cloudChoiceTitle').textContent=title;$('cloudChoiceMessage').textContent=message;
  $('cloudUseRemote').disabled=!remoteExists;
  $('cloudUseRemote').hidden=!remoteExists;
  setStatus('클라우드와 이 기기 데이터 중 사용할 쪽을 선택하세요.','warn');
}
function guard(){if(!window.HILFU_APP)throw Error('힐푸FC 앱이 아직 준비되지 않았습니다.');}
function syncReady(){return active&&currentUser&&docRef&&firestoreFns;}
const getLocal=()=>window.HILFU_APP.getData();
function acceptCloud(data){
  window.HILFU_APP.applyCloudData(data);
  localDirty=false;knownCloud=data;knownSignature=fingerprint(data);
  lastServerSignature=knownSignature;
  if(currentUser)localStorage.setItem(syncedKey(currentUser.uid),knownSignature);
  setStatus('실시간 동기화 연결됨 · 서버 최신 데이터 적용','online');
}
function clearCloudTimer(){if(pendingTimer){clearTimeout(pendingTimer);pendingTimer=null;}}
function resetSession(){
  clearCloudTimer();if(unsub){unsub();unsub=null;}
  active=false;firstSnapshot=true;knownCloud=null;knownSignature=null;lastServerSignature=null;
  localDirty=false;writeRunning=false;docRef=null;
  setVisible(choosePanel,false);
}
async function flush(){
  if(!syncReady()||!localDirty||writeRunning)return;
  clearCloudTimer();writeRunning=true;
  const data=getLocal(),signature=fingerprint(data);
  try {
    setStatus('변경사항 클라우드 저장 중…','warn');
    await firestoreFns.setDoc(docRef,{state:data,updatedAt:firestoreFns.serverTimestamp(),version:7});
    // 저장하는 동안 추가 편집이 일어났다면 다시 저장합니다.
    lastServerSignature=signature;
    if(currentUser)localStorage.setItem(syncedKey(currentUser.uid),signature);
    localDirty=fingerprint(getLocal())!==signature;
    if(!localDirty)setStatus('실시간 동기화 연결됨 · 변경사항 저장 완료','online');
  }catch(error){
    localDirty=true;setStatus('저장 실패: '+error.message+' · 인터넷/Firestore 규칙을 확인해 주세요.','warn');
  }finally{writeRunning=false;if(localDirty&&syncReady())pendingTimer=setTimeout(flush,3000);if(window.HILFU_TEAM)setTeamButtons();}
}
window.HILFU_CLOUD={
  localChanged(data){
    if(!syncReady())return;
    const sig=fingerprint(data);
    if(sig===lastServerSignature)return;
    localDirty=true;clearCloudTimer();pendingTimer=setTimeout(flush,900);
    setStatus('변경사항 클라우드 저장 대기 중…','warn');
  }
};
function processSnapshot(snapshot){
  if(!currentUser||personalPaused)return;
  if(snapshot.metadata.hasPendingWrites)return;
  const remote=snapshot.exists()?snapshot.data()?.state:null;
  if(remote&&(!Array.isArray(remote.players)||!Array.isArray(remote.lineups))){
    setStatus('클라우드 데이터 구조가 올바르지 않습니다. 데이터 백업을 확인하세요.','warn');return;
  }
  knownCloud=remote;knownSignature=remote?fingerprint(remote):null;
  const localSignature=fingerprint(getLocal());
  if(!active){
    const previous=localStorage.getItem(syncedKey(currentUser.uid));
    if(remote&&knownSignature===localSignature){
      active=true;lastServerSignature=knownSignature;localStorage.setItem(syncedKey(currentUser.uid),knownSignature);
      setVisible(choosePanel,false);setStatus('실시간 동기화 연결됨 · 최신 상태','online');return;
    }
    if(remote&&previous===localSignature){
      active=true;acceptCloud(remote);setVisible(choosePanel,false);return;
    }
    if(!remote){
      choose('클라우드 데이터가 없습니다','이 기기 데이터를 첫 원본으로 클라우드에 올릴 수 있습니다. 먼저 JSON 백업을 권장합니다.',false);
    }else{
      choose('기존 데이터가 서로 다릅니다','클라우드 데이터가 이미 있습니다. 가져오기는 이 기기를 덮어쓰고, 올리기는 클라우드 전체를 덮어씁니다. 수정한 데이터가 있는 쪽을 선택하세요.',true);
    }
    return;
  }
  if(!remote){
    active=false;choose('클라우드 데이터가 삭제되었습니다','클라우드 문서가 없어졌습니다. 이 기기 데이터를 다시 올릴 수 있습니다.',false);return;
  }
  if(knownSignature===localSignature){
    lastServerSignature=knownSignature;localDirty=false;localStorage.setItem(syncedKey(currentUser.uid),knownSignature);
    setStatus('실시간 동기화 연결됨 · 최신 상태','online');return;
  }
  if(localDirty||writeRunning){
    // 원격 변경과 로컬 미전송 변경이 동시에 발생할 경우 무음 덮어쓰기 금지.
    clearCloudTimer();active=false;localDirty=false;
    choose('서로 다른 기기에서 동시에 수정했습니다','자동 덮어쓰기를 중단했습니다. 클라우드 또는 이 기기 중 보존할 데이터를 선택하세요.',true);
    return;
  }
  acceptCloud(remote);
}
async function configure(){
  const config=window.HILFU_FIREBASE_CONFIG;
  if(!config||Object.values(config).some(v=>typeof v!=='string'||!v.trim()||v.includes('YOUR_'))||!config.projectId||!config.appId){
    setVisible(configHelp,true);setStatus('Firebase 연결 설정이 아직 입력되지 않았습니다.','warn');return;
  }
  try{
    const [appSDK,authSDK,dbSDK]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js')]);
    const firebaseApp=appSDK.initializeApp(config);
    authFns=authSDK;firestoreFns=dbSDK;
    auth=authSDK.getAuth(firebaseApp);db=dbSDK.getFirestore(firebaseApp);
    setVisible(configHelp,false);
    setStatus('Firebase 준비 완료 · 공개 공식 보드를 불러오는 중…');
    let firstAuthState=true;
    authSDK.onAuthStateChanged(auth,async user=>{
      const wasTeamMode=window.HILFU_APP?.isTeamMode()===true;
      resetSession();const previousUser=currentUser;currentUser=user;
      setVisible(signedInPanel,Boolean(user));setVisible(signedOutPanel,!user);
      if(user){guard();$('cloudAccount').textContent=(user.email||user.displayName||'Google 계정')+' · 로그인됨';}
      handleTeamAuth(user,previousUser);
      window.HILFU_APP?.refreshBoardHeader?.();
      const shouldOpen=firstAuthState||wasTeamMode;
      firstAuthState=false;
      if(shouldOpen){
        const opened=await openOfficial({auto:true});
        if(!opened&&user&&!personalPaused)startPersonalSync();
      }else if(user&&!personalPaused){
        startPersonalSync();
      }else if(!user){
        setStatus('공식 팀 보드는 로그인 없이 열람할 수 있습니다. 개인 클라우드 저장은 로그인 후 사용할 수 있습니다.');
      }
    },error=>setStatus('로그인 확인 실패: '+error.message,'warn'));
  }catch(e){setStatus('Firebase SDK 불러오기 실패: '+e.message+' · 인터넷 연결을 확인하세요.','warn');}
}
function startPersonalSync(){
  if(!currentUser||personalPaused||window.HILFU_APP?.isTeamMode())return;
  resetSession();
  setStatus('개인 클라우드 확인 중…','warn');
  docRef=firestoreFns.doc(db,'hilfuStates',currentUser.uid);
  unsub=firestoreFns.onSnapshot(docRef,processSnapshot,error=>setStatus('개인 동기화 실패: '+error.message,'warn'));
}
function pausePersonal(){personalPaused=true;resetSession();}
function resumePersonal(){personalPaused=false;startPersonalSync();}
$('cloudBtn').onclick=()=>d.showModal();
$('closeSyncDialog').onclick=()=>d.close();
$('cloudLoginBtn').onclick=async()=>{
  if(!authFns||!auth)return;
  try{await authFns.signInWithPopup(auth,new authFns.GoogleAuthProvider());}
  catch(e){setStatus('Google 로그인 실패: '+e.message+' · GitHub Pages 도메인을 인증 허용 도메인에 추가했는지 확인하세요.','warn');}
};
$('cloudLogoutBtn').onclick=async()=>{if(auth)await authFns.signOut(auth);};
$('cloudUseRemote').onclick=()=>{if(personalPaused)return;
  if(!knownCloud)return;
  if(!confirm('클라우드 데이터를 이 기기로 불러옵니다. 현재 이 기기 데이터는 덮어써집니다. 백업하셨나요?'))return;
  active=true;acceptCloud(knownCloud);setVisible(choosePanel,false);
};
$('cloudUploadLocal').onclick=async()=>{if(personalPaused){setStatus('공식 팀 보드 사용 중에는 개인 동기화를 변경할 수 없습니다. 개인 보드로 돌아가세요.','warn');return;}
  if(!currentUser||!docRef)return;
  if(knownCloud&&!confirm('이 기기 데이터를 클라우드에 올리면 다른 기기의 공유 데이터도 바뀝니다. 계속할까요?'))return;
  if(!knownCloud&&!confirm('이 기기 데이터를 첫 클라우드 원본으로 올릴까요?'))return;
  active=true;setVisible(choosePanel,false);localDirty=true;
  await flush();
};
configure();


// === v8 공식 팀 보드 & 이메일 기반 편집 권한 ===
// 프로젝트 내 공식 상태는 hilfuTeams/official 한 문서에 보관합니다.
// 읽기: 누구나 hilfuTeams/official 문서만 열람. 수정: 인증된 감독 UID 또는 승인된 코치 이메일만 허용.
const TEAM_ID='official';
let teamUser=null,teamRef=null,aclRef=null,teamActive=false,teamRole='viewer';
let teamUnsub=null,aclUnsub=null,aclEmails=[],teamKnown=null,teamRevision=0;
let teamLastSig=null,teamDirty=false,teamWriting=false,teamTimer=null,teamConflict=false;
let historyView=null;
const historyDialog=$('matchHistoryDialog'),newMatchDialog=$('matchNewDialog');
const teamStatusEl=$('teamStatus');
const setTeamStatus=(message)=>{
  teamStatusEl.textContent=message;
  const phase = /실패|오류|충돌|권한 없음|접근할 수 없/.test(message)?'error'
    : /저장 완료|반영했습니다|복사했습니다/.test(message)?'saved'
    : /저장 중|저장하는 중/.test(message)?'saving'
    : /저장 대기|저장되지 않은|변경사항 저장 대기/.test(message)?'pending'
    : /연결됨|실시간 갱신/.test(message)?'synced':'idle';
  window.HILFU_SYNC_UI?.set('team',phase,message,{clearSaved:!teamUser});
};
const validTeamData=(data)=>data&&Array.isArray(data.players)&&Array.isArray(data.lineups)&&data.lineups.length===5;
function setTeamButtons(){
  const signed=Boolean(teamUser);
  $('teamOpenBtn').disabled=!db;
  $('teamOpenBtn').hidden=teamActive;
  $('teamPersonalBtn').hidden=!teamActive||!signed;
  $('teamPublishBtn').hidden=!signed || teamActive || Boolean(teamKnown);
  $('teamOwnerPanel').hidden=!(signed && (!teamKnown || teamRole==='owner'));
  $('teamOwnerUid').textContent=teamUser?.uid||'';
  $('teamInviteEmail').disabled=teamRole!=='owner';
  $('teamInviteBtn').disabled=teamRole!=='owner';
  const transferTools=$('teamTransferTools');
  transferTools.hidden=!signed||Boolean(historyView);
  $('teamCopyToPersonal').hidden=!teamActive||Boolean(historyView);
  $('teamCopyToOfficial').hidden=teamActive||Boolean(historyView);
  $('teamCopyToOfficial').disabled=!active || localDirty || writeRunning || !choosePanel.hidden;
}
function renderEditors(){
  const holder=$('teamEditorList');
  holder.replaceChildren();
  if(teamRole!=='owner'){return;}
  if(!aclEmails.length){const msg=document.createElement('span');msg.className='team-small';msg.textContent='추가된 편집자가 없습니다. 감독만 수정할 수 있습니다.';holder.appendChild(msg);}
  for(const email of aclEmails){
    const row=document.createElement('div');row.className='team-acl-row';
    const label=document.createElement('span');label.textContent=email;
    const btn=document.createElement('button');btn.className='btn small danger';btn.type='button';btn.textContent='권한 회수';
    btn.addEventListener('click',()=>removeEditor(email));
    row.append(label,btn);holder.append(row);
  }
}
function clearTeamTimers(){if(teamTimer){clearTimeout(teamTimer);teamTimer=null;}}
function clearTeamWatchers(){
  clearTeamTimers();if(teamUnsub){teamUnsub();teamUnsub=null;}if(aclUnsub){aclUnsub();aclUnsub=null;}
  teamDirty=false;teamWriting=false;teamConflict=false;
}
function handleTeamAuth(user,previousUser){
  if(teamActive && (!user || user.uid!==previousUser?.uid)){
    clearTeamWatchers();teamActive=false;window.HILFU_APP?.leaveTeamData();personalPaused=false;
  }
  teamUser=user;teamRole='viewer';aclEmails=[];teamKnown=null;teamRevision=0;teamLastSig=null;
  if(db&&firestoreFns){teamRef=firestoreFns.doc(db,'hilfuTeams',TEAM_ID);aclRef=firestoreFns.doc(db,'hilfuTeamAccess',TEAM_ID);}
  if(!user)setTeamStatus('공식 팀 보드는 로그인 없이 볼 수 있습니다. 수정하려면 감독·코치 로그인이 필요합니다.');
  else setTeamStatus('공식 팀 보드를 열면 감독이 공유한 최신 정보를 확인할 수 있습니다.');
  setTeamButtons();renderEditors();
}
async function checkTeamRole(){
  if(!teamUser||!teamKnown){teamRole='viewer';if(teamActive)window.HILFU_APP.setTeamEditable(false);setTeamButtons();return;}
  const user=teamUser;
  teamRole=teamKnown.ownerUid===user.uid?'owner':'viewer';
  if(aclUnsub){aclUnsub();aclUnsub=null;}
  if(!aclRef)return;
  if(teamRole==='owner'){
    aclUnsub=firestoreFns.onSnapshot(aclRef,snap=>{
      aclEmails=Array.isArray(snap.data()?.editorEmails)?snap.data().editorEmails:[];
      renderEditors();
    },error=>setTeamStatus('편집자 목록 확인 실패: '+error.message));
  }else{
    // 편집자는 자신이 이메일 허용 목록에 있을 때만 ACL 문서를 읽을 수 있습니다.
    try{
      const snapshot=await firestoreFns.getDoc(aclRef);
      const list=snapshot.data()?.editorEmails||[];
      if(user.emailVerified&&list.includes((user.email||'').toLowerCase())){
        teamRole='editor';
        aclUnsub=firestoreFns.onSnapshot(aclRef,async snap=>{
          const current=snap.data()?.editorEmails||[];
          if(!current.includes((teamUser?.email||'').toLowerCase()))revokeLocalEdit();
        },()=>revokeLocalEdit());
      }
    }catch{teamRole='viewer';}
  }
  if(teamActive&&!historyView)window.HILFU_APP.setTeamEditable(teamRole==='owner'||teamRole==='editor');
  setTeamButtons();
}
function revokeLocalEdit(){
  teamRole='viewer';teamDirty=false;clearTeamTimers();
  if(teamKnown?.state)window.HILFU_APP.enterTeamData(teamKnown.state,false);
  else window.HILFU_APP.setTeamEditable(false);
  setTeamStatus('편집 권한이 해제되었습니다. 미전송 변경은 공식 자료에 반영되지 않으며 이제 열람만 할 수 있습니다.');
}
function snapshotTeam(snap){
  if(!teamActive||snap.metadata.hasPendingWrites)return;
  if(!snap.exists()){
    setTeamStatus('공식 팀 데이터가 삭제되거나 접근할 수 없습니다.');return;
  }
  const raw=snap.data(),newData=raw.state;
  if(!validTeamData(newData)){setTeamStatus('공식 팀 데이터 형식이 올바르지 않습니다.');return;}
  const signature=fingerprint(newData),nextRevision=Number(raw.revision)||0;
  if(teamDirty && !teamWriting && signature!==fingerprint(window.HILFU_APP.getData()) && nextRevision!==teamRevision){
    teamConflict=true;clearTeamTimers();
    setTeamStatus('⚠️ 동시 수정 감지: 서버가 먼저 변경되었습니다. 내 수정은 아직 서버에 저장되지 않았습니다. JSON 백업 후 공식 팀 보드를 다시 여세요.');
    return;
  }
  teamKnown=raw;teamRevision=nextRevision;teamLastSig=signature;
  if(teamDirty||teamWriting||historyView)return;
  window.HILFU_APP.enterTeamData(newData,teamRole==='owner'||teamRole==='editor');
  setTeamStatus(`공식 팀 보드 연결됨 · ${teamRole==='owner'?'감독':teamRole==='editor'?'편집자':'열람 전용'} · 실시간 갱신`);
}
async function openOfficial({auto=false}={}){
  if(!db||!firestoreFns){
    setTeamStatus('Firebase 초기화 중입니다. 잠시 뒤 다시 시도해 주세요.');
    if(!auto)d.showModal();
    return false;
  }
  if(teamActive){
    if(historyView)await returnCurrentMatch();
    if(!auto&&d.open)d.close();return true;
  }
  try{
    setTeamStatus('공식 팀 데이터를 확인하는 중…');
    teamRef=firestoreFns.doc(db,'hilfuTeams',TEAM_ID);aclRef=firestoreFns.doc(db,'hilfuTeamAccess',TEAM_ID);
    const snap=await firestoreFns.getDoc(teamRef);
    if(!snap.exists()){
      teamKnown=null;
      setTeamStatus('아직 공식 팀 보드가 게시되지 않았습니다. 감독이 공식 보드를 최초 게시해야 합니다.');
      setTeamButtons();if(!auto)d.showModal();
      return false;
    }
    const raw=snap.data();
    if(!validTeamData(raw.state))throw Error('공식 보드 데이터가 올바르지 않습니다.');
    clearTeamWatchers();pausePersonal();
    teamActive=true;teamKnown=raw;teamRevision=Number(raw.revision)||0;teamLastSig=fingerprint(raw.state);
    window.HILFU_APP.enterTeamData(raw.state,false);
    setTeamButtons();
    await checkTeamRole();
    teamUnsub=firestoreFns.onSnapshot(teamRef,snapshotTeam,err=>setTeamStatus('공식 팀 보드 실시간 수신 실패: '+err.message));
    if(!auto)window.scrollTo({top:0,behavior:'smooth'});
    if(d.open)d.close();
    return true;
  }catch(error){
    clearTeamWatchers();teamActive=false;resumePersonal();
    if(window.HILFU_APP.isTeamMode())window.HILFU_APP.leaveTeamData();
    const permissions=error.code==='permission-denied'||/permission-denied|Missing or insufficient permissions/i.test(error.message||'');
    const detail=permissions?'Firebase 콘솔의 Firestore 규칙에서 official 문서의 로그인 없는 읽기를 허용하고 게시해야 합니다.':error.message;
    setTeamStatus('공식 보드 읽기 실패: '+detail);
    if(auto)setStatus('공식 보드 불러오기 실패: '+detail,'warn');
    else d.showModal();
    return false;
  }
}
async function leaveOfficial(){
  if(!teamActive)return;
  clearTeamWatchers();teamActive=false;teamRole='viewer';historyView=null;
  // Keep the last known official snapshot only as a UI hint; every write rereads from the server.
  window.HILFU_APP.leaveTeamData();resumePersonal();setTeamButtons();
  setTeamStatus('개인 보드로 돌아왔습니다.');
}
async function firstPublish(){
  if(!teamUser||teamActive)return;
  if(!confirm('현재 개인 보드의 선수·라인업·전술을 공식 팀 보드로 처음 게시할까요? 게시된 내용은 로그인 없이 누구나 열람할 수 있습니다. 먼저 JSON 백업을 권장합니다.'))return;
  try{
    teamRef=firestoreFns.doc(db,'hilfuTeams',TEAM_ID);aclRef=firestoreFns.doc(db,'hilfuTeamAccess',TEAM_ID);
    if((await firestoreFns.getDoc(teamRef)).exists()){setTeamStatus('이미 공식 보드가 있습니다. 기존 공식 보드를 먼저 열어주세요.');return;}
    const data=window.HILFU_APP.getData();
    // 규칙에서 하드코딩된 감독 UID와 인증 UID가 일치할 때만 생성됩니다.
    await firestoreFns.setDoc(teamRef,{ownerUid:teamUser.uid,state:data,revision:1,version:8,updatedAt:firestoreFns.serverTimestamp()});
    // 첫 게시 후 권한 설정 문서 생성. 실패하더라도 감독은 이후 수정·재시도 가능.
    try{await firestoreFns.setDoc(aclRef,{ownerUid:teamUser.uid,editorEmails:[],updatedAt:firestoreFns.serverTimestamp()});}
    catch(error){setTeamStatus('공식 보드는 게시됐지만 편집자 설정 생성 실패: '+error.message);}
    await openOfficial();
  }catch(error){setTeamStatus('최초 게시 실패: '+error.message+' · Firestore 규칙의 감독 UID와 게시 상태를 확인하세요.');}
}
async function setEditors(emails){
  if(teamRole!=='owner'||!teamUser||!aclRef)return;
  const cleaned=[...new Set(emails.map(x=>x.trim().toLowerCase()))];
  if(cleaned.length>20){setTeamStatus('편집자는 최대 20명까지 등록할 수 있습니다.');return;}
  try{
    await firestoreFns.setDoc(aclRef,{ownerUid:teamUser.uid,editorEmails:cleaned,updatedAt:firestoreFns.serverTimestamp()});
    aclEmails=cleaned;renderEditors();setTeamStatus(`편집자 ${cleaned.length}명 등록됨. 해당 Google 계정으로 로그인하면 수정 가능합니다.`);
  }catch(error){setTeamStatus('권한 수정 실패: '+error.message+' · Firestore 보안 규칙을 확인하세요.');}
}
function inviteEditor(){
  if(teamRole!=='owner')return;
  const email=$('teamInviteEmail').value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setTeamStatus('올바른 이메일 주소를 입력하세요.');return;}
  if(aclEmails.includes(email)){setTeamStatus('이미 등록된 이메일입니다.');return;}
  if(!confirm(`${email} 계정에 공식 보드 수정 권한을 부여할까요?`))return;
  setEditors([...aclEmails,email]);$('teamInviteEmail').value='';
}
function removeEditor(email){
  if(teamRole!=='owner'||!confirm(email+' 계정의 수정 권한을 회수할까요?'))return;
  setEditors(aclEmails.filter(x=>x!==email));
}
function triggerTeamSave(data){
  if(!teamActive||historyView||!['owner','editor'].includes(teamRole)||teamConflict)return;
  if(fingerprint(data)===teamLastSig && !teamDirty)return;
  teamDirty=true;clearTeamTimers();teamTimer=setTimeout(flushOfficial,1100);
  setTeamStatus('공식 팀 변경사항 저장 대기 중…');
}
async function flushOfficial(){
  if(!teamActive||historyView||!teamDirty||teamWriting||teamConflict||!['owner','editor'].includes(teamRole))return;
  clearTeamTimers();teamWriting=true;
  setTeamStatus('공식 팀 변경사항 서버 저장 중…');
  const state=window.HILFU_APP.getData(),sig=fingerprint(state),expected=teamRevision;
  try{
    await firestoreFns.runTransaction(db,async transaction=>{
      const snap=await transaction.get(teamRef);
      if(!snap.exists()||snap.data().revision!==expected)throw Error('동시 편집 충돌');
      const backupRef=firestoreFns.doc(db,'hilfuTeamBackups','slot'+(expected%10));
      transaction.set(backupRef,{state:snap.data().state,sourceRevision:expected,reason:'공식 보드 수정 전',actorUid:teamUser.uid,createdAt:firestoreFns.serverTimestamp()});
      transaction.update(teamRef,{state,revision:expected+1,version:8,updatedAt:firestoreFns.serverTimestamp()});
    });
    teamRevision=expected+1;teamLastSig=sig;
    teamDirty=fingerprint(window.HILFU_APP.getData())!==sig;
    setTeamStatus(teamDirty?'추가 변경사항 저장 대기 중…':'공식 팀 보드 저장 완료 · 다른 팀원에게 실시간 반영됨');
  }catch(error){
    if(/동시 편집 충돌|ABORTED|permission-denied/i.test(error.message||'')){
      teamConflict=true;setTeamStatus('저장 충돌 또는 권한 없음: '+error.message+' · 데이터를 백업한 뒤 공식 보드를 다시 여세요.');
    }else{setTeamStatus('공식 보드 저장 오류: '+error.message+' · 재시도 예정');}
  }finally{
    teamWriting=false;
    if(teamDirty&&!teamConflict&&teamActive)teamTimer=setTimeout(flushOfficial,2200);
  }
}
// === v8.1 개인 ↔ 공식 보드 복사 (자동 쌍방 동기화 아님) ===
const PERSONAL_KEY='hilfu-fc-app-v1';
function downloadBoardBackup(data,tag){
  if(!validTeamData(data))return;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const blob=new Blob([JSON.stringify({version:8,exportedAt:new Date().toISOString(),...data},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`hilfu_fc_${tag}_${stamp}.json`;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function storedPersonal(){try{
  const data=JSON.parse(localStorage.getItem(PERSONAL_KEY)||'null');return validTeamData(data)?data:null;
}catch{return null;}}
async function copyOfficialToPersonal(){
  if(!teamActive||!teamUser||!teamRef)return;
  if(teamDirty||teamWriting||teamConflict){setTeamStatus('공식 보드에서 저장되지 않은 변경 또는 충돌이 있습니다. 저장 상태를 먼저 확인하세요.');return;}
  const question='공식 보드 전체(선수·참석·5쿼터·전술)를 내 개인 보드로 복사할까요?\n\n내 개인 보드의 기존 내용(이 기기 + 개인 Firebase)이 교체됩니다. 공식 보드는 바뀌지 않습니다. 기존 개인 데이터는 JSON으로 백업할 수 있습니다.';
  if(!confirm(question))return;
  const button=$('teamCopyToPersonal');button.disabled=true;
  try{
    setTeamStatus('최신 공식 데이터와 개인 클라우드 데이터를 확인하는 중…');
    const latest=await firestoreFns.getDocFromServer(teamRef);
    if(!latest.exists()||!validTeamData(latest.data().state))throw Error('공식 데이터가 없습니다.');
    if(Number(latest.data().revision)!==teamRevision)throw Error('공식 보드가 다른 기기에서 변경됐습니다. 보드를 새로 연 뒤 다시 진행하세요.');
    const personalRef=firestoreFns.doc(db,'hilfuStates',teamUser.uid);
    const personalSnapshot=await firestoreFns.getDocFromServer(personalRef);
    const oldRemote=personalSnapshot.exists()?personalSnapshot.data()?.state:null;
    const oldLocal=storedPersonal();
    // Backup old personal data before changing it. Both are independent, importable JSON files.
    if(validTeamData(oldLocal))downloadBoardBackup(oldLocal,'old_personal_device_backup');
    if(validTeamData(oldRemote)&&fingerprint(oldRemote)!==fingerprint(oldLocal))downloadBoardBackup(oldRemote,'old_personal_cloud_backup');
    if(!confirm('기존 개인 보드 백업을 확인했나요? 이제 공식 보드 내용을 개인 Firebase와 이 기기 개인 보드에 복사합니다. 계속할까요?')){
      setTeamStatus('복사를 취소했습니다. 기존 데이터는 변경되지 않았습니다.');return;
    }
    const copy=JSON.parse(JSON.stringify(latest.data().state));
    await firestoreFns.setDoc(personalRef,{state:copy,version:8,updatedAt:firestoreFns.serverTimestamp()});
    const localShell=oldLocal||{};
    localStorage.setItem(PERSONAL_KEY,JSON.stringify({...localShell,...copy}));
    localStorage.setItem(syncedKey(teamUser.uid),fingerprint(copy));
    await leaveOfficial();
    setTeamStatus('✅ 공식 팀 보드를 내 개인 보드와 개인 클라우드로 복사했습니다. 공식 보드에는 변화가 없습니다.');
    d.showModal();
  }catch(error){setTeamStatus('복사 실패: '+error.message+' · 원본 데이터는 유지되는지 확인하세요.');}
  finally{button.disabled=false;setTeamButtons();}
}
async function copyPersonalToOfficial(){
  if(teamActive||!teamUser||!db)return;
  if(!syncReady()||localDirty||writeRunning||!choosePanel.hidden){
    setTeamStatus('먼저 개인 보드에서 클라우드/이 기기 데이터 선택을 완료하고 개인 동기화가 저장된 상태인지 확인하세요.');return;
  }
  const question='개인 보드 전체를 공식 팀 보드로 반영할까요?\n\n기존 공식 선수·참석·5쿼터·전술 정보가 모두 교체되고 팀원에게 즉시 공유됩니다. 감독/지정 편집자만 가능하며 자동 반영이 아닌 명시적 일회성 작업입니다.';
  if(!confirm(question))return;
  const button=$('teamCopyToOfficial');button.disabled=true;
  try{
    setTeamStatus('기존 공식 데이터를 확인하고 백업 준비 중…');
    const ref=firestoreFns.doc(db,'hilfuTeams',TEAM_ID);
    const snap=await firestoreFns.getDocFromServer(ref);
    if(!snap.exists()||!validTeamData(snap.data()?.state))throw Error('공식 팀 보드가 없습니다. 감독이 먼저 생성해야 합니다.');
    const old=snap.data(),rev=Number(old.revision)||0;
    downloadBoardBackup(old.state,'old_official_board_backup');
    if(!confirm(`기존 공식 팀 보드(revision ${rev})의 백업을 확인했나요? 개인 보드를 공식 자료로 교체할까요?`)){
      setTeamStatus('공식 보드 변경을 취소했습니다.');return;
    }
    const data=JSON.parse(JSON.stringify(getLocal()));
    // Transaction CAS: refuse to overwrite if another team editor committed meanwhile.
    await firestoreFns.runTransaction(db,async tx=>{
      const current=await tx.get(ref);
      if(!current.exists()||Number(current.data().revision)!==rev)throw Error('다른 편집자가 방금 수정했습니다. 공식 팀 보드를 확인하고 다시 시도하세요.');
      tx.set(firestoreFns.doc(db,'hilfuTeamBackups','slot'+(rev%10)),{state:current.data().state,sourceRevision:rev,reason:'개인 보드 반영 전',actorUid:teamUser.uid,createdAt:firestoreFns.serverTimestamp()});
      tx.update(ref,{state:data,revision:rev+1,version:8,updatedAt:firestoreFns.serverTimestamp()});
    });
    setTeamStatus('✅ 개인 보드를 공식 팀 보드에 반영했습니다. 다른 팀원의 화면에도 전달됩니다.');
    await openOfficial();
  }catch(error){setTeamStatus('공식 반영 실패: '+error.message+' · 감독/편집자 권한과 네트워크 상태를 확인하세요.');d.showModal();}
  finally{button.disabled=false;setTeamButtons();}
}
window.HILFU_AUTH={
  isSignedIn:()=>Boolean(currentUser)
};
$('boardEditLogin').onclick=()=>{
  if(!d.open)d.showModal();
};

 
// === v8.4: 과거 경기(공개) 및 자동 백업(감독·편집자 전용) ===
const canEditTeam=()=>Boolean(teamUser)&&['owner','editor'].includes(teamRole);
const safeTitle=(v,fallback='자체전')=>(String(v||'').trim().slice(0,80)||fallback);
const fmtDate=v=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';
function textNode(tag,value,className){
  const el=document.createElement(tag);
  el.textContent=String(value);
  if(className)el.className=className;
  return el;
}
function actionButton(label,action){
  const btn=document.createElement('button');btn.type='button';btn.className='btn small';btn.textContent=label;
  btn.addEventListener('click',action);return btn;
}
function makeRow(title,description){
  const el=document.createElement('div');el.className='match-history-entry';
  el.append(textNode('b',title),textNode('span',description,'detail'));return el;
}
const matchesRef=()=>firestoreFns.collection(db,'hilfuMatchArchive');
const backupsRef=()=>firestoreFns.collection(db,'hilfuTeamBackups');
async function returnCurrentMatch(){
  if(!historyView||!teamActive)return;
  try{
    setTeamStatus('현재 공식 경기 데이터를 서버에서 다시 확인하는 중…');
    const snap=await firestoreFns.getDocFromServer(teamRef);
    if(!snap.exists()||!validTeamData(snap.data().state))throw Error('공식 경기 데이터가 없습니다.');
    historyView=null;const data=snap.data();
    teamKnown=data;teamRevision=Number(data.revision)||0;teamLastSig=fingerprint(data.state);
    window.HILFU_APP.enterTeamData(data.state,canEditTeam());
    setTeamButtons();
    setTeamStatus('현재 공식 팀 보드 연결됨 · '+(canEditTeam()?'편집 가능':'열람 전용')+' · 실시간 갱신');
  }catch(error){
    setTeamStatus('현재 경기로 돌아가기 실패: '+error.message);
  }
}
async function viewArchivedMatch(docId){
  if(!teamActive){setTeamStatus('공식 팀 보드를 먼저 여세요.');return;}
  if(teamDirty||teamWriting||teamConflict){setTeamStatus('변경사항 저장 완료 또는 충돌 해결 후 과거 경기를 여세요.');return;}
  try{
    const docRef=firestoreFns.doc(db,'hilfuMatchArchive',docId);
    const snap=await firestoreFns.getDocFromServer(docRef);
    if(!snap.exists()||!validTeamData(snap.data().state))throw Error('이전 경기 데이터를 찾을 수 없습니다.');
    const data=snap.data(),label=(data.date?data.date+' · ':'')+safeTitle(data.title);
    historyView={id:docId,label};
    window.HILFU_APP.enterTeamData(data.state,false);
    setTeamButtons();
    window.HILFU_APP.refreshBoardHeader();
    setTeamStatus('지난 경기 '+label+' · 열람 전용 · 공식 데이터 변경 없음');
    if(historyDialog.open)historyDialog.close();
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(error){setTeamStatus('이전 경기 열기 실패: '+error.message);}
}
async function restoreOfficialState(docPath,description){
  if(!teamActive||!canEditTeam())return;
  if(teamDirty||teamWriting||teamConflict){setTeamStatus('현재 저장 대기 또는 충돌이 있습니다. 먼저 저장 상태를 확인하세요.');return;}
  if(!confirm(description+'을(를) 현재 공식 보드로 복원할까요?\n\n현재 공식 보드는 복원 전에 자동 백업됩니다. 팀원들에게 복원 내용이 즉시 공유됩니다.'))return;
  try{
    const restoreRef=firestoreFns.doc(db,...docPath);
    const saved=await firestoreFns.getDocFromServer(restoreRef);
    if(!saved.exists()||!validTeamData(saved.data().state))throw Error('복원할 자료가 더 이상 존재하지 않습니다.');
    const target=JSON.parse(JSON.stringify(saved.data().state));
    const snap=await firestoreFns.getDocFromServer(teamRef);
    if(!snap.exists())throw Error('현재 공식 보드가 없습니다.');
    const rev=Number(snap.data().revision)||0;
    if(rev!==teamRevision)throw Error('다른 편집자가 공식 보드를 변경했습니다. 최신 자료를 확인한 뒤 다시 시도하세요.');
    if(!confirm('최종 확인: 공식 보드 전체를 교체합니다. 기존 공식 자료는 최근 10개 자동 백업 중 하나로 보관됩니다. 진행할까요?'))return;
    setTeamStatus('복원 중 · 현재 공식 데이터를 먼저 보관합니다…');
    await firestoreFns.runTransaction(db,async tx=>{
      const current=await tx.get(teamRef);
      if(!current.exists()||Number(current.data().revision)!==rev)throw Error('다른 코치가 수정했습니다. 복원을 중단합니다.');
      tx.set(firestoreFns.doc(db,'hilfuTeamBackups','slot'+(rev%10)),
        {state:current.data().state,sourceRevision:rev,reason:'복원 작업 이전',actorUid:teamUser.uid,createdAt:firestoreFns.serverTimestamp()});
      tx.update(teamRef,{state:target,revision:rev+1,version:8,updatedAt:firestoreFns.serverTimestamp()});
    });
    historyView=null;teamRevision=rev+1;teamLastSig=fingerprint(target);
    window.HILFU_APP.enterTeamData(target,true);
    setTeamButtons();
    if(historyDialog.open)historyDialog.close();
    setTeamStatus('공식 팀 보드 복원 완료 · 팀원에게 실시간 반영됨');
  }catch(error){setTeamStatus('공식 보드 복원 실패: '+error.message);}
}
async function loadMatchHistory(){
  const list=$('matchHistoryList'),backupPanel=$('matchBackupPanel'),backupList=$('matchBackupList');
  list.replaceChildren(textNode('p','경기 이력을 읽어오는 중…'));
  backupList.replaceChildren();
  backupPanel.hidden=!canEditTeam();
  if(!db||!firestoreFns){list.replaceChildren(textNode('p','Firebase 연결을 먼저 확인하세요.'));return;}
  try{
    const q=firestoreFns.query(matchesRef(),firestoreFns.orderBy('createdAt','desc'),firestoreFns.limit(40));
    const snapshot=await firestoreFns.getDocs(q);
    list.replaceChildren();
    if(snapshot.empty)list.append(textNode('p','아직 보관된 이전 경기가 없습니다. 새 경기를 시작할 때 현재 경기가 자동 보관됩니다.'));
    for(const docSnap of snapshot.docs){
      const v=docSnap.data();if(!validTeamData(v.state))continue;
      const date=fmtDate(v.date);
      const row=makeRow((date?date+' · ':'')+safeTitle(v.title), '공식 보드 수정번호 '+(Number(v.sourceRevision)||0)+'에서 보관 · 읽기 전용');
      const actions=document.createElement('div');actions.className='sync-actions';
      actions.append(actionButton('경기 보기',()=>viewArchivedMatch(docSnap.id)));
      if(canEditTeam())actions.append(actionButton('이 경기로 복원',()=>restoreOfficialState(['hilfuMatchArchive',docSnap.id],safeTitle(v.title))));
      row.append(actions);list.append(row);
    }
  }catch(error){list.replaceChildren(textNode('p','지난 경기 목록 불러오기 실패: '+error.message+' · Firestore 규칙 게시 여부를 확인하세요.'));}
  if(!canEditTeam())return;
  try{
    const snapshot=await firestoreFns.getDocs(backupsRef());
    const docs=snapshot.docs.filter(x=>validTeamData(x.data()?.state)).sort((a,b)=>(b.data().sourceRevision||0)-(a.data().sourceRevision||0));
    backupList.replaceChildren();
    if(!docs.length)backupList.append(textNode('p','아직 자동 백업이 없습니다. 공식 보드를 수정하면 저장 직전 버전이 자동 보관됩니다.'));
    for(const snap of docs){
      const data=snap.data(),row=makeRow('공식 보드 수정번호 '+data.sourceRevision,'백업 사유: '+(data.reason||'자동 백업'));
      const actions=document.createElement('div');actions.className='sync-actions';
      actions.append(actionButton('이 버전 복원',()=>restoreOfficialState(['hilfuTeamBackups',snap.id],'수정번호 '+data.sourceRevision)));
      row.append(actions);backupList.append(row);
    }
  }catch(error){backupList.replaceChildren(textNode('p','자동 백업 목록 불러오기 실패: '+error.message+' · Firestore 보안 규칙을 확인하세요.'));}
}
async function createNewMatch(){
  const status=$('matchNewStatus'),btn=$('matchCreateBtn');
  if(!teamActive||historyView||!canEditTeam()){status.textContent='현재 공식 보드의 감독·승인 코치만 새 경기를 시작할 수 있습니다.';return;}
  if(teamDirty||teamWriting||teamConflict){status.textContent='현재 수정사항을 모두 서버에 저장하고 다시 시도하세요.';return;}
  const archiveTitle=safeTitle($('matchArchiveTitle').value,'이전 자체전');
  const date=fmtDate($('matchNewDate').value);
  const title=safeTitle($('matchNewTitle').value);
  if(!date){status.textContent='새 경기 날짜를 선택하세요.';return;}
  if(!confirm('현재 공식 경기를 "'+archiveTitle+'" 이름으로 보관하고 새 경기 "'+date+' '+title+'"를 시작할까요?\n\n선수 포지션은 유지하지만 참석·라인업·전술 정보는 초기화됩니다.'))return;
  btn.disabled=true;
  try{
    status.textContent='현재 공식 데이터 확인 및 경기 보관 중…';
    const previous=await firestoreFns.getDocFromServer(teamRef);
    if(!previous.exists()||!validTeamData(previous.data().state))throw Error('현재 공식 보드가 없습니다.');
    const rev=Number(previous.data().revision)||0;
    if(rev!==teamRevision)throw Error('다른 편집자가 방금 수정했습니다. 새로고침 후 다시 시도하세요.');
    const next=window.HILFU_APP.createNewMatchData(date,title);
    const archivedId=firestoreFns.doc(matchesRef());
    await firestoreFns.runTransaction(db,async tx=>{
      const current=await tx.get(teamRef);
      if(!current.exists()||Number(current.data().revision)!==rev)throw Error('동시 수정 감지 · 새 경기 시작을 중단합니다.');
      const original=current.data().state;
      tx.set(archivedId,{state:original,title:archiveTitle,date:fmtDate(original.match?.date),sourceRevision:rev,createdAt:firestoreFns.serverTimestamp(),actorUid:teamUser.uid});
      tx.set(firestoreFns.doc(db,'hilfuTeamBackups','slot'+(rev%10)),{state:original,sourceRevision:rev,reason:'새 경기 시작 전',actorUid:teamUser.uid,createdAt:firestoreFns.serverTimestamp()});
      tx.update(teamRef,{state:next,revision:rev+1,version:8,updatedAt:firestoreFns.serverTimestamp()});
    });
    teamRevision=rev+1;teamLastSig=fingerprint(next);teamKnown={...teamKnown,state:next,revision:rev+1};
    window.HILFU_APP.enterTeamData(next,true);
    setTeamButtons();
    setTeamStatus('새 경기 '+date+' '+title+' 시작 완료 · 이전 경기는 보관됨');
    if(newMatchDialog.open)newMatchDialog.close();
  }catch(error){status.textContent='새 경기 시작 실패: '+error.message;setTeamStatus('새 경기 시작 실패: '+error.message);}
  finally{btn.disabled=false;}
}
$('boardHistoryBtn').onclick=()=>{historyDialog.showModal();loadMatchHistory();};
$('closeMatchHistory').onclick=()=>historyDialog.close();
$('boardNewMatchBtn').onclick=()=>{
  if(!canEditTeam()||historyView)return;
  const old=teamKnown?.state?.match;
  $('matchArchiveTitle').value=old?.title?(old.date?old.date+' ':'')+old.title:'현재 자체전';
  const dt=new Date();const local=new Date(dt.getTime()-dt.getTimezoneOffset()*60000);
  $('matchNewDate').value=local.toISOString().slice(0,10);
  $('matchNewTitle').value='자체전';
  $('matchNewStatus').textContent='';
  newMatchDialog.showModal();
};
$('boardReturnOfficialBtn').onclick=returnCurrentMatch;
$('closeMatchNew').onclick=()=>newMatchDialog.close();
$('matchCreateBtn').onclick=createNewMatch;

$('teamCopyToPersonal').onclick=copyOfficialToPersonal;
$('teamCopyToOfficial').onclick=copyPersonalToOfficial;
window.HILFU_TEAM={isActive:()=>teamActive,isHistoryMode:()=>Boolean(historyView),historyLabel:()=>historyView?.label||'',localChanged:triggerTeamSave,toggleMode:()=>teamActive?(historyView?returnCurrentMatch():leaveOfficial()):openOfficial()};
$('teamOpenBtn').onclick=openOfficial;
$('teamPersonalBtn').onclick=()=>{leaveOfficial();d.close();};
$('teamPublishBtn').onclick=firstPublish;
$('teamInviteBtn').onclick=inviteEditor;
$('teamInviteEmail').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();inviteEditor();}};
$('teamCopyUid').onclick=()=>{if(!teamUser)return;if(!navigator.clipboard?.writeText){setTeamStatus('위에 표시된 UID를 직접 선택해 복사하세요.');return;}navigator.clipboard.writeText(teamUser.uid).then(()=>setTeamStatus('UID를 복사했습니다. Firestore 규칙의 PASTE_OWNER_UID_HERE 자리에 입력하세요.')).catch(()=>setTeamStatus('위의 UID를 직접 복사하세요.'));};
setTeamButtons();
