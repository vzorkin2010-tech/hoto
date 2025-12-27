const firebaseConfig = {
    apiKey: "AIzaSyD5uS50WpC2KRXDYY0XNV8II23kbHR_da0",
    authDomain: "hoto-d9e96.firebaseapp.com",
    projectId: "hoto-d9e96",
    storageBucket: "hoto-d9e96.firebasestorage.app",
    messagingSenderId: "1024787203382",
    appId: "1:1024787203382:web:5eb5e82a3337a53ec75f97"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// API KEYS
const IMGBB_API_KEY = "bf02b08a3e2439c1b663ef266e15fe2b"; 
const GOFILE_API_TOKEN = "BppkhLswk2sxwwcaCqthzQLw87BWcUu1";

let currentUser = null, currentChat = null, currentChatData = null, chatsListener = null, messagesListener = null;
let editMsgId = null, tempActionMsgId = null, tempActionMsgText = null;
let userCache = {};

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    const input = document.getElementById('message-input');
    input.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });
    input.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
    document.getElementById('search-input').addEventListener('input', e => { setTimeout(() => searchUsers(e.target.value), 500); });
    document.getElementById('file-input').addEventListener('change', e => { if(e.target.files.length) uploadFiles(e.target.files); });
});

auth.onAuthStateChanged(async user => {
    const loader = document.getElementById('loading-screen');
    if (user) {
        const doc = await db.collection('users').doc(user.uid).get();
        if(doc.exists && !doc.data().banned) {
            currentUser = { uid: user.uid, ...doc.data() };
            loader.classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');
            document.getElementById('auth-section').classList.add('hidden');
            updateMyProfileUI(); loadChats(); initGlobalNotifications();
        } else { 
            auth.signOut(); 
            loader.classList.add('hidden');
            document.getElementById('auth-section').classList.remove('hidden');
        }
    } else { 
        loader.classList.add('hidden');
        document.getElementById('auth-section').classList.remove('hidden'); 
        document.getElementById('app').classList.add('hidden');
    }
});

// --- FILE UPLOAD ---
async function uploadToImgBB(file) {
    const formData = new FormData();
    formData.append("image", file);
    try {
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
        const data = await response.json();
        return data.success ? data.data.url : null;
    } catch (e) { return null; }
}

async function uploadToGofile(file) {
    try {
        const serverData = await fetch('https://api.gofile.io/getServer').then(r => r.json());
        const formData = new FormData();
        formData.append("file", file);
        formData.append("token", GOFILE_API_TOKEN);
        const upload = await fetch(`https://${serverData.data.server}.gofile.io/uploadFile`, { method: "POST", body: formData }).then(r => r.json());
        return upload.status === 'ok' ? upload.data.downloadPage : null;
    } catch (e) { return null; }
}

// --- AUTH ---
function login() { auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value).catch(err => showToast(err.message)); }
async function register() { 
    const e = document.getElementById('register-email').value, p = document.getElementById('register-password').value;
    if(p !== document.getElementById('register-confirm').value) return showToast('Пароли не совпадают');
    try {
        const cred = await auth.createUserWithEmailAndPassword(e, p);
        await db.collection('users').doc(cred.user.uid).set({ email: e, nickname: e.split('@')[0], username: 'user_'+Math.floor(Math.random()*10000), bio: '', createdAt: firebase.firestore.FieldValue.serverTimestamp(), banned: false });
    } catch(err) { showToast(err.message); }
}
function logout() { if(chatsListener) chatsListener(); if(messagesListener) messagesListener(); auth.signOut(); window.location.reload(); }
function toggleAuth(type) { document.getElementById('login-form').classList.toggle('hidden', type !== 'login'); document.getElementById('register-form').classList.toggle('hidden', type !== 'register'); }

// --- CHATS ---
function loadChats() {
    if(chatsListener) chatsListener();
    const list = document.getElementById('chats-list');
    chatsListener = db.collection('chats').where('participants', 'array-contains', currentUser.uid).onSnapshot(async snapshot => {
        const chats = [];
        snapshot.forEach(doc => { const d = doc.data(); if(d.type !== 'group' && d.lastMessage) chats.push({ id: doc.id, ...d }); });
        chats.sort((a,b) => (b.lastMessageTime?.toMillis() || 0) - (a.lastMessageTime?.toMillis() || 0));
        list.innerHTML = chats.length ? '' : '<div style="text-align:center; padding:20px; color:var(--text-muted)">Нет чатов</div>';
        for(const chat of chats) {
            const otherId = chat.participants.find(id => id !== currentUser.uid);
            const uSnap = await db.collection('users').doc(otherId).get();
            const u = uSnap.data() || { nickname: 'User' };
            const div = document.createElement('div'); div.className = 'chat-item'; div.onclick = () => openChat(chat);
            div.innerHTML = `<div class="avatar">${u.avatarURL?`<img src="${u.avatarURL}">`:u.nickname[0]}</div><div style="flex:1;overflow:hidden;"><div style="display:flex;justify-content:space-between;"><div class="chat-name">${u.nickname}</div></div><div class="chat-last">${chat.lastMessage}</div></div>`;
            list.appendChild(div);
        }
    });
}

async function searchUsers(q) {
    if(!q) return; const res = document.getElementById('search-results');
    const snap = await db.collection('users').where('username', '>=', q).where('username', '<=', q+'\uf8ff').limit(5).get();
    res.innerHTML = '';
    snap.forEach(doc => { if(doc.id !== currentUser.uid) { const u = doc.data(); const div = document.createElement('div'); div.className = 'chat-item'; div.onclick = () => createDirectChat(doc.id); div.innerHTML = `<div class="avatar">${u.avatarURL?`<img src="${u.avatarURL}">`:u.nickname[0]}</div><div><div class="chat-name">${u.nickname}</div><div>@${u.username}</div></div>`; res.appendChild(div); } });
}

async function createDirectChat(uid) {
    const snap = await db.collection('chats').where('participants', 'array-contains', currentUser.uid).get();
    let found = null; snap.forEach(d => { if(d.data().type !== 'group' && d.data().participants.includes(uid)) found = {id: d.id, ...d.data()}; });
    if(found) openChat(found); else { const ref = await db.collection('chats').add({ participants: [currentUser.uid, uid], createdAt: firebase.firestore.FieldValue.serverTimestamp(), lastMessage: '' }); openChat({ id: ref.id, participants: [currentUser.uid, uid] }); }
    switchTab('chats');
}

async function openChat(chat) {
    currentChatData = chat; currentChat = { id: chat.id, type: chat.type };
    const hName = document.getElementById('header-name'), hSub = document.getElementById('header-sub'), hAv = document.getElementById('header-avatar');
    const otherId = chat.participants.find(id => id !== currentUser.uid);
    const uSnap = await db.collection('users').doc(otherId).get();
    const u = uSnap.data(); currentChat.otherUser = u;
    hName.textContent = u.nickname; hSub.textContent = '@'+u.username; hAv.innerHTML = u.avatarURL ? `<img src="${u.avatarURL}">` : u.nickname[0];
    document.getElementById('empty-state').classList.add('hidden'); document.getElementById('chat-view').classList.remove('hidden');
    if(window.innerWidth <= 768) document.getElementById('sidebar').classList.add('hidden-mobile');
    loadMessages(chat.id);
}

function loadMessages(chatId) {
    if(messagesListener) messagesListener();
    const cont = document.getElementById('messages-container'); cont.innerHTML = '';
    messagesListener = db.collection('chats').doc(chatId).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => {
        snap.docChanges().forEach(change => { if(change.type === 'added') renderMessage(change.doc.data(), change.doc.id); });
        cont.scrollTop = cont.scrollHeight;
    });
}

function renderMessage(d, id) {
    const isMine = d.senderId === currentUser.uid;
    const cont = document.getElementById('messages-container');
    if (isMine) {
        const div = document.createElement('div'); div.className = 'msg out'; div.id = id;
        div.onclick = () => { tempActionMsgId = id; tempActionMsgText = d.text; openModal('msg-options-modal'); };
        div.innerHTML = renderMsgInnerHtml(d); cont.appendChild(div);
    } else {
        const row = document.createElement('div'); row.className = 'msg-row';
        row.innerHTML = `<div class="msg-avatar" id="av-${id}">?</div><div class="msg in" id="${id}">${renderMsgInnerHtml(d)}</div>`;
        cont.appendChild(row); resolveUserAvatar(d.senderId, `av-${id}`);
    }
}

async function resolveUserAvatar(uid, targetId) {
    if (!userCache[uid]) { const snap = await db.collection('users').doc(uid).get(); userCache[uid] = snap.data(); }
    const el = document.getElementById(targetId); if (el) el.innerHTML = userCache[uid].avatarURL ? `<img src="${userCache[uid].avatarURL}">` : userCache[uid].nickname[0];
}

function renderMsgInnerHtml(d) {
    let content = d.text;
    if(d.type === 'file') content = d.fileType?.startsWith('image/') ? `<img src="${d.fileURL}" style="max-width:100%;border-radius:10px;">` : `<a href="${d.fileURL}" target="_blank" class="file-card">📁 ${d.fileName}</a>`;
    return `${content}<div class="msg-time">${d.timestamp ? new Date(d.timestamp.toDate()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '...'}</div>`;
}

async function handleSend() {
    const inp = document.getElementById('message-input'), txt = inp.value.trim();
    if(!txt || !currentChat) return;
    inp.value = ''; inp.style.height='auto';
    await db.collection('chats').doc(currentChat.id).collection('messages').add({ text: txt, senderId: currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection('chats').doc(currentChat.id).update({ lastMessage: txt, lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(), lastMessageSender: currentUser.uid });
}

async function uploadFiles(files) {
    const loader = document.getElementById('upload-indicator'); loader.classList.remove('hidden');
    for(let file of files) {
        let url = file.type.startsWith('image/') ? await uploadToImgBB(file) : await uploadToGofile(file);
        if(url) {
            await db.collection('chats').doc(currentChat.id).collection('messages').add({ type: 'file', fileName: file.name, fileType: file.type, fileURL: url, senderId: currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
            await db.collection('chats').doc(currentChat.id).update({ lastMessage: 'Файл', lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(), lastMessageSender: currentUser.uid });
        }
    }
    loader.classList.add('hidden');
}

// --- UI ---
function openChatInfo() { if(currentChat.otherUser) showUserProfile(currentChat.otherUser); }
function showUserProfile(u) {
    document.getElementById('view-nickname').innerText = u.nickname;
    document.getElementById('view-username').innerText = '@'+u.username;
    document.getElementById('view-bio').innerText = u.bio || '...';
    document.getElementById('view-avatar').innerHTML = u.avatarURL?`<img src="${u.avatarURL}">`:u.nickname[0];
    document.getElementById('view-banner').style.backgroundImage = u.bannerURL ? `url(${u.bannerURL})` : 'none';
    openModal('user-profile-modal');
}
function openMyProfile() {
    document.getElementById('profile-nickname').value = currentUser.nickname;
    document.getElementById('profile-username').value = currentUser.username;
    document.getElementById('profile-bio').value = currentUser.bio || '';
    document.getElementById('my-profile-avatar-content').innerHTML = currentUser.avatarURL ? `<img src="${currentUser.avatarURL}">` : currentUser.nickname[0];
    document.getElementById('my-banner-preview').style.backgroundImage = currentUser.bannerURL ? `url(${currentUser.bannerURL})` : 'none';
    openModal('my-profile-modal');
}
async function saveProfile() {
    await db.collection('users').doc(currentUser.uid).update({ nickname: document.getElementById('profile-nickname').value, username: document.getElementById('profile-username').value, bio: document.getElementById('profile-bio').value });
    location.reload();
}
async function uploadAvatar(f) { const u = await uploadToImgBB(f); if(u) { await db.collection('users').doc(currentUser.uid).update({ avatarURL: u }); location.reload(); } }
async function uploadBanner(f) { const u = await uploadToImgBB(f); if(u) { await db.collection('users').doc(currentUser.uid).update({ bannerURL: u }); location.reload(); } }

function switchTab(t) { document.querySelectorAll('.nav-tab').forEach(e=>e.classList.remove('active')); document.querySelector(`.nav-tab[onclick*="${t}"]`).classList.add('active'); document.getElementById('chats-list').classList.toggle('hidden', t!=='chats'); document.getElementById('search-list').classList.toggle('hidden', t!=='search'); }
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function closeChatMobile() { document.getElementById('sidebar').classList.remove('hidden-mobile'); }
function updateMyProfileUI() { document.getElementById('my-nickname-mini').innerText = currentUser.nickname; document.getElementById('my-avatar-mini').innerHTML = currentUser.avatarURL ? `<img src="${currentUser.avatarURL}">` : currentUser.nickname[0]; }
function initGlobalNotifications() { db.collection('chats').where('participants','array-contains',currentUser.uid).onSnapshot(snap => { snap.docChanges().forEach(c => { if(c.type==='modified' && c.doc.data().lastMessageSender !== currentUser.uid) showToast('Новое сообщение'); }); }); }
function showToast(txt) { const t = document.createElement('div'); t.className = 'toast'; t.innerText = txt; document.getElementById('toast-container').appendChild(t); setTimeout(()=>t.classList.add('show'),10); setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},3000); }
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem('theme', t); document.querySelectorAll('.theme-circle').forEach(c => c.classList.toggle('active', c.classList.contains('t-'+t))); }
function initTheme() { setTheme(localStorage.getItem('theme') || 'orange'); }
async function triggerDeleteFromModal() { if(confirm('Удалить сообщение?')) { await db.collection('chats').doc(currentChat.id).collection('messages').doc(tempActionMsgId).delete(); closeModal('msg-options-modal'); } }
