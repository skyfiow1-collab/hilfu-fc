// HILFU FC v7 - Firebase Authentication + Cloud Firestore, GitHub Pages 호환 ESM
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
let auth=null,db=null,currentUser=null,docRef=null;
let active=false,firstSnapshot=true,knownCloud=null,knownSignature=null,lastServerSignature=null;
let localDirty=false,writeRunning=false,pendingTimer=null,unsub=null;
let firestoreFns=null, authFns=null;
function setStatus(message,kind=''){
  statusLine.textContent=message;
  badge.textContent=kind==='online'?'연결됨':kind==='warn'?'확인 필요':'미연결';
  badge.className='syncbadge'+(kind==='online'?' online':kind==='warn'?' warn':'');
  if(currentUser) $('cloudSyncState').textContent=message;
}
const setVisible = (element,visible) => {element.hidden=!visible;};
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
  }finally{writeRunning=false;if(localDirty&&syncReady())pendingTimer=setTimeout(flush,3000);}
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
  if(!currentUser)return;
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
    setStatus('Firebase 준비 완료 · Google 로그인 필요');
    authSDK.onAuthStateChanged(auth,user=>{
      resetSession();currentUser=user;
      setVisible(signedInPanel,Boolean(user));setVisible(signedOutPanel,!user);
      if(!user){setStatus('Google 로그인하면 같은 계정의 기기끼리 동기화할 수 있습니다.');return;}
      guard();
      $('cloudAccount').textContent=(user.email||user.displayName||'Google 계정')+' · 로그인됨';
      setStatus('로그인됨 · 클라우드 데이터 확인 중…','warn');
      docRef=dbSDK.doc(db,'hilfuStates',user.uid);
      unsub=dbSDK.onSnapshot(docRef,processSnapshot,error=>{setStatus('실시간 연결 실패: '+error.message+' · Firestore 보안 규칙을 확인하세요.','warn');});
    },error=>setStatus('로그인 확인 실패: '+error.message,'warn'));
  }catch(e){setStatus('Firebase SDK 불러오기 실패: '+e.message+' · 인터넷 연결을 확인하세요.','warn');}
}
$('cloudBtn').onclick=()=>d.showModal();
$('closeSyncDialog').onclick=()=>d.close();
$('cloudLoginBtn').onclick=async()=>{
  if(!authFns||!auth)return;
  try{await authFns.signInWithPopup(auth,new authFns.GoogleAuthProvider());}
  catch(e){setStatus('Google 로그인 실패: '+e.message+' · GitHub Pages 도메인을 인증 허용 도메인에 추가했는지 확인하세요.','warn');}
};
$('cloudLogoutBtn').onclick=async()=>{if(auth)await authFns.signOut(auth);};
$('cloudUseRemote').onclick=()=>{
  if(!knownCloud)return;
  if(!confirm('클라우드 데이터를 이 기기로 불러옵니다. 현재 이 기기 데이터는 덮어써집니다. 백업하셨나요?'))return;
  active=true;acceptCloud(knownCloud);setVisible(choosePanel,false);
};
$('cloudUploadLocal').onclick=async()=>{
  if(!currentUser||!docRef)return;
  if(knownCloud&&!confirm('이 기기 데이터를 클라우드에 올리면 다른 기기의 공유 데이터도 바뀝니다. 계속할까요?'))return;
  if(!knownCloud&&!confirm('이 기기 데이터를 첫 클라우드 원본으로 올릴까요?'))return;
  active=true;setVisible(choosePanel,false);localDirty=true;
  await flush();
};
configure();
