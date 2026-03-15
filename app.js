// ═══════════════════════════════════════════════════════
//  JUSWELL NEXUS — app.js
//  Firebase Firestore + Auth + Storage
//  Repository GitHub : juswell nexus
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, setDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes,
  getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ── CONFIGURATION FIREBASE ─────────────────────────────
// ⚠️ Remplacez ces valeurs par celles de votre projet Firebase "juswell nexus"
const firebaseConfig = {
  apiKey:            "VOTRE_API_KEY",
  authDomain:        "VOTRE_PROJECT_ID.firebaseapp.com",
  projectId:         "VOTRE_PROJECT_ID",
  storageBucket:     "VOTRE_PROJECT_ID.appspot.com",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId:             "VOTRE_APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);

// ── ÉTAT GLOBAL ────────────────────────────────────────
let currentUser     = null;   // { uid, id, name, role, phone }
let currentGroupId  = null;
let messagesUnsubscribe = null;
let groupsUnsubscribe   = null;
let mediaRecorder   = null;
let audioChunks     = [];
let recordingTimer  = null;
let recordingSeconds= 0;

// ── INIT ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Vérifier si un lien d'invitation est présent
  const params  = new URLSearchParams(window.location.search);
  const invite  = params.get('invite');
  if (invite) {
    localStorage.setItem('jn_invite', invite);
  }

  // Vérifier session sauvegardée
  const saved = loadSession();
  if (saved) {
    currentUser = saved;
    hideSplash();
    showApp();
  } else {
    hideSplash();
    // Si lien d'invitation → formulaire d'inscription
    if (invite || localStorage.getItem('jn_invite')) {
      checkInviteAndShowRegister(localStorage.getItem('jn_invite') || invite);
    } else {
      showScreen('auth-screen');
      showForm('login-form');
    }
  }
});

function hideSplash() {
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    splash.classList.add('fade-out');
    setTimeout(() => { splash.style.display = 'none'; }, 650);
  }, 2200);
}

// ── SESSION ────────────────────────────────────────────
function saveSession(user) {
  localStorage.setItem('jn_session', JSON.stringify(user));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('jn_session')); } catch { return null; }
}
function clearSession() {
  localStorage.removeItem('jn_session');
  localStorage.removeItem('jn_invite');
}

// ── NAVIGATION ÉCRANS ──────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}
function showForm(id) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}
window.showLoginForm   = () => showForm('login-form');
window.showForgotForm  = () => showForm('forgot-form');

function showApp() {
  showScreen('app-screen');
  initApp();
}

// ── CONNEXION ──────────────────────────────────────────
window.handleLogin = async function() {
  const id  = document.getElementById('login-id').value.trim();
  const pwd = document.getElementById('login-password').value.trim();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');

  if (!id || !pwd) { showError(err, 'Identifiant et mot de passe requis.'); return; }

  try {
    // Recherche dans Firestore par identifiant (champ "username")
    const q = query(collection(db, 'users'), where('username', '==', id));
    const snap = await getDocs(q);
    if (snap.empty) { showError(err, 'Identifiant introuvable.'); return; }

    const userDoc = snap.docs[0];
    const data    = userDoc.data();

    // Connexion Firebase Auth avec l'email stocké
    await signInWithEmailAndPassword(auth, data.email, pwd);

    currentUser = { uid: data.uid, id: data.username, name: data.name, role: data.role, phone: data.phone, docId: userDoc.id };
    saveSession(currentUser);
    showApp();
  } catch(e) {
    console.error(e);
    showError(err, 'Identifiant ou mot de passe incorrect.');
  }
};

// ── IDENTIFIANT OUBLIÉ ─────────────────────────────────
window.handleForgotId = async function() {
  const phone  = document.getElementById('forgot-phone').value.trim();
  const result = document.getElementById('forgot-result');
  const err    = document.getElementById('forgot-error');
  result.classList.add('hidden'); err.classList.add('hidden');

  if (!phone) { showError(err, 'Numéro de téléphone requis.'); return; }

  try {
    const q    = query(collection(db, 'users'), where('phone', '==', phone));
    const snap = await getDocs(q);
    if (snap.empty) { showError(err, 'Aucun compte trouvé avec ce numéro.'); return; }

    const username = snap.docs[0].data().username;
    result.textContent = `Votre identifiant : ${username}`;
    result.classList.remove('hidden');
  } catch(e) {
    showError(err, 'Erreur. Réessayez.');
  }
};

// ── INVITATION ─────────────────────────────────────────
async function checkInviteAndShowRegister(token) {
  try {
    const inviteRef = doc(db, 'invites', token);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists() || inviteSnap.data().used) {
      showScreen('auth-screen');
      showForm('login-form');
      showToast('Lien d\'invitation invalide ou déjà utilisé.', 'error');
      return;
    }
    const inviteData = inviteSnap.data();
    const badge = document.getElementById('invite-role-badge');
    badge.textContent = inviteData.role === 'agent' ? '👤 Rôle : Agent' : '🎨 Rôle : Designer / Client';
    document.getElementById('register-form').dataset.inviteToken  = token;
    document.getElementById('register-form').dataset.inviteRole   = inviteData.role;
    document.getElementById('register-form').dataset.inviteGroup  = inviteData.groupId;
    showScreen('auth-screen');
    showForm('register-form');
  } catch(e) {
    showScreen('auth-screen'); showForm('login-form');
  }
}

// ── INSCRIPTION ────────────────────────────────────────
window.handleRegister = async function() {
  const form  = document.getElementById('register-form');
  const token = form.dataset.inviteToken;
  const role  = form.dataset.inviteRole;
  const groupId = form.dataset.inviteGroup;

  const name  = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const pwd   = document.getElementById('reg-password').value.trim();
  const err   = document.getElementById('register-error');
  err.classList.add('hidden');

  if (!name || !phone || !pwd) { showError(err, 'Tous les champs sont requis.'); return; }
  if (pwd.length < 6) { showError(err, 'Mot de passe minimum 6 caractères.'); return; }

  try {
    // Générer identifiant unique : initiales + 4 chiffres
    const username = generateUsername(name);
    const email    = `${username.toLowerCase()}@juswellnexus.internal`;

    // Créer compte Firebase Auth
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    const uid  = cred.user.uid;

    // Enregistrer dans Firestore
    await setDoc(doc(db, 'users', uid), {
      uid, username, name, phone, role, email,
      createdAt: serverTimestamp()
    });

    // Ajouter au groupe Équipe Permanente si Agent
    if (role === 'agent') {
      const permGroupQuery = query(collection(db, 'groups'), where('type', '==', 'permanent'));
      const permSnap = await getDocs(permGroupQuery);
      if (!permSnap.empty) {
        const permGroupId = permSnap.docs[0].id;
        await addDoc(collection(db, 'groups', permGroupId, 'members'), { userId: uid, joinedAt: serverTimestamp() });
      }
    }
    // Ajouter au groupe du lien d'invitation
    if (groupId) {
      await addDoc(collection(db, 'groups', groupId, 'members'), { userId: uid, joinedAt: serverTimestamp() });
    }

    // Invalider le lien d'invitation
    await updateDoc(doc(db, 'invites', token), { used: true, usedBy: uid, usedAt: serverTimestamp() });
    localStorage.removeItem('jn_invite');

    // Nettoyer l'URL
    window.history.replaceState({}, '', window.location.pathname);

    // Afficher confirmation
    document.getElementById('cred-id').textContent  = username;
    document.getElementById('cred-pwd').textContent = pwd;
    showForm('confirm-form');
    currentUser = { uid, id: username, name, role, phone, docId: uid };
    saveSession(currentUser);
  } catch(e) {
    console.error(e);
    showError(err, 'Erreur lors de l\'inscription : ' + e.message);
  }
};

function generateUsername(name) {
  const parts   = name.trim().split(' ');
  const initials = parts.map(p => p[0]?.toUpperCase() || '').join('');
  const num     = Math.floor(1000 + Math.random() * 9000);
  return `JN-${initials}${num}`;
}

window.goToApp = function() { showApp(); };

// ── DÉCONNEXION ────────────────────────────────────────
window.handleLogout = async function() {
  if (messagesUnsubscribe) messagesUnsubscribe();
  if (groupsUnsubscribe)   groupsUnsubscribe();
  clearSession();
  await signOut(auth);
  currentUser = null; currentGroupId = null;
  showScreen('auth-screen');
  showForm('login-form');
};

// ── INITIALISATION APPLICATION ─────────────────────────
function initApp() {
  // Afficher infos utilisateur
  document.getElementById('sidebar-name').textContent = currentUser.name;
  document.getElementById('sidebar-role').textContent = roleFr(currentUser.role);
  document.getElementById('sidebar-avatar').textContent = initials(currentUser.name);

  // DG only : bouton nouveau groupe
  const ngBtn = document.getElementById('new-group-btn');
  if (currentUser.role === 'DG') { ngBtn.style.display = 'flex'; }
  else { ngBtn.style.display = 'none'; }

  // Charger les groupes
  loadGroups();

  // Notifications push
  requestNotificationPermission();
}

function roleFr(role) {
  const map = { DG: 'Direction Générale', agent: 'Agent', designer: 'Designer / Client' };
  return map[role] || role;
}
function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}

// ── GROUPES ────────────────────────────────────────────
async function loadGroups() {
  const container = document.getElementById('groups-container');
  container.innerHTML = '<p style="padding:12px 16px;color:var(--text-light);font-size:.85rem">Chargement...</p>';

  try {
    let groupIds = [];

    if (currentUser.role === 'DG') {
      // DG voit tous les groupes
      const snap = await getDocs(collection(db, 'groups'));
      groupIds = snap.docs.map(d => d.id);
      renderGroupsList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      subscribeGroups(null);
    } else {
      // Chercher dans tous les sous-collections members
      // Firestore ne supporte pas collectionGroup queries sans index, on utilise un champ membersIds sur le groupe
      const q = query(collection(db, 'groups'), where('memberIds', 'array-contains', currentUser.uid));
      const snap = await getDocs(q);
      renderGroupsList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      subscribeGroups(currentUser.uid);
    }
  } catch(e) {
    console.error('loadGroups error:', e);
    container.innerHTML = '<p style="padding:12px 16px;color:var(--danger);font-size:.85rem">Erreur de chargement</p>';
  }
}

function subscribeGroups(userId) {
  let q;
  if (!userId) {
    q = collection(db, 'groups');
  } else {
    q = query(collection(db, 'groups'), where('memberIds', 'array-contains', userId));
  }
  if (groupsUnsubscribe) groupsUnsubscribe();
  groupsUnsubscribe = onSnapshot(q, snap => {
    renderGroupsList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderGroupsList(groups) {
  const container = document.getElementById('groups-container');
  container.innerHTML = '';
  if (!groups.length) {
    container.innerHTML = '<p style="padding:12px 16px;color:var(--text-light);font-size:.85rem">Aucune discussion</p>';
    return;
  }
  // Groupe Équipe Permanente en premier
  groups.sort((a, b) => {
    if (a.type === 'permanent') return -1;
    if (b.type === 'permanent') return 1;
    return 0;
  });
  groups.forEach(g => {
    const div = document.createElement('div');
    div.className = 'group-item' + (g.id === currentGroupId ? ' active' : '');
    div.dataset.groupId = g.id;
    div.innerHTML = `
      <div class="group-avatar">${initials(g.name || 'G')}</div>
      <div class="group-info">
        <p class="group-name">${escHtml(g.name)}</p>
        <p class="group-preview">${g.ref ? escHtml(g.ref) : (g.type === 'permanent' ? 'Équipe interne' : 'Projet')}</p>
      </div>
      <div class="group-meta">
        <span class="group-time" id="gtime-${g.id}"></span>
        <span class="group-badge hidden" id="gbadge-${g.id}"></span>
      </div>`;
    div.addEventListener('click', () => openGroup(g.id, g.name));
    container.appendChild(div);
  });
}

window.openGroup = async function(groupId, groupName) {
  currentGroupId = groupId;

  // Mettre à jour l'UI
  document.querySelectorAll('.group-item').forEach(el => {
    el.classList.toggle('active', el.dataset.groupId === groupId);
  });
  document.getElementById('topbar-group-name').textContent = groupName || 'Groupe';
  document.getElementById('topbar-avatar').textContent = initials(groupName || 'G');

  // Compter membres
  const groupDoc = await getDoc(doc(db, 'groups', groupId));
  const memberIds = groupDoc.data()?.memberIds || [];
  document.getElementById('topbar-members').textContent = `${memberIds.length} membre${memberIds.length>1?'s':''}`;

  // Afficher zone chat
  document.getElementById('welcome-view').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  // Fermer sidebar sur mobile
  if (window.innerWidth < 900) closeSidebar();

  // Écouter messages
  subscribeMessages(groupId);
};

// ── MESSAGES ───────────────────────────────────────────
function subscribeMessages(groupId) {
  if (messagesUnsubscribe) messagesUnsubscribe();
  const q = query(
    collection(db, 'groups', groupId, 'messages'),
    orderBy('createdAt', 'asc')
  );
  messagesUnsubscribe = onSnapshot(q, snap => {
    renderMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderMessages(messages) {
  const container = document.getElementById('messages-container');
  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  container.innerHTML = '';
  let lastDate = '';

  messages.forEach(msg => {
    const isMe = msg.senderId === currentUser.uid;
    const date = msg.createdAt?.toDate ? formatDate(msg.createdAt.toDate()) : '';

    if (date && date !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.textContent = date;
      container.appendChild(sep);
      lastDate = date;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${isMe ? 'me' : 'other'}`;
    wrapper.dataset.msgId = msg.id;

    let contentHtml = '';
    if (msg.type === 'text') {
      contentHtml = `<div class="msg-bubble">
        ${escHtml(msg.content)}
        ${msg.edited ? '<span class="msg-edited"> · modifié</span>' : ''}
      </div>`;
    } else if (msg.type === 'image') {
      contentHtml = `<div class="msg-bubble" style="padding:4px">
        <img class="msg-image" src="${msg.url}" alt="image" onclick="openImageModal('${msg.url}')" loading="lazy" />
      </div>`;
    } else if (msg.type === 'video') {
      contentHtml = `<div class="msg-bubble" style="padding:4px">
        <video class="msg-video" controls src="${msg.url}"></video>
      </div>`;
    } else if (msg.type === 'audio') {
      contentHtml = `<div class="msg-bubble">
        <audio class="msg-audio" controls src="${msg.url}"></audio>
      </div>`;
    } else if (msg.type === 'file') {
      contentHtml = `<div class="msg-bubble">
        <div class="msg-file">
          <span class="msg-file-icon">${fileIcon(msg.fileName)}</span>
          <span class="msg-file-name">${escHtml(msg.fileName || 'Fichier')}</span>
          <a class="msg-file-dl" href="${msg.url}" download target="_blank">⬇</a>
        </div>
      </div>`;
    }

    // Boutons d'action
    const canEdit   = isMe && msg.type === 'text';
    const canDelete = isMe || currentUser.role === 'DG';
    let actionsHtml = `<div class="msg-actions">`;
    if (canEdit)   actionsHtml += `<button class="msg-action-btn" onclick="editMessage('${msg.id}','${escAttr(msg.content)}')">✏️</button>`;
    if (canDelete) actionsHtml += `<button class="msg-action-btn delete" onclick="deleteMessage('${msg.id}','${msg.storageRef || ''}')">🗑️</button>`;
    actionsHtml += `</div>`;

    const timeStr = msg.createdAt?.toDate ? formatTime(msg.createdAt.toDate()) : '';

    wrapper.innerHTML = `
      ${!isMe ? `<p class="msg-sender-name">${escHtml(msg.senderName || '')}</p>` : ''}
      <div style="position:relative">
        ${actionsHtml}
        ${contentHtml}
      </div>
      <span class="msg-time">${timeStr}</span>`;

    // Tap mobile pour afficher actions
    wrapper.addEventListener('click', () => {
      document.querySelectorAll('.msg-wrapper.show-actions').forEach(el => el.classList.remove('show-actions'));
      wrapper.classList.toggle('show-actions');
    });

    container.appendChild(wrapper);
  });

  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

// ── ENVOYER MESSAGE TEXTE ──────────────────────────────
window.sendTextMessage = async function() {
  const input = document.getElementById('message-input');
  const text  = input.value.trim();
  if (!text || !currentGroupId) return;
  input.value = '';
  input.style.height = 'auto';
  await addMessage({ type: 'text', content: text });
};

window.handleEnter = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage();
  }
};

window.autoResize = function(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

async function addMessage(data) {
  if (!currentGroupId) return;
  try {
    await addDoc(collection(db, 'groups', currentGroupId, 'messages'), {
      ...data,
      senderId:   currentUser.uid,
      senderName: currentUser.name,
      createdAt:  serverTimestamp(),
      edited:     false
    });
    // Mettre à jour lastMessage du groupe
    await updateDoc(doc(db, 'groups', currentGroupId), {
      lastMessage: data.content || `[${data.type}]`,
      lastMessageAt: serverTimestamp()
    });
  } catch(e) {
    console.error('addMessage error:', e);
    showToast('Erreur d\'envoi', 'error');
  }
}

// ── MODIFIER MESSAGE ───────────────────────────────────
window.editMessage = async function(msgId, currentContent) {
  const newText = prompt('Modifier le message :', currentContent);
  if (newText === null || newText.trim() === currentContent) return;
  try {
    await updateDoc(doc(db, 'groups', currentGroupId, 'messages', msgId), {
      content: newText.trim(), edited: true
    });
  } catch(e) { showToast('Erreur modification', 'error'); }
};

// ── SUPPRIMER MESSAGE ──────────────────────────────────
window.deleteMessage = async function(msgId, storageRefPath) {
  if (!confirm('Supprimer ce message ?')) return;
  try {
    if (storageRefPath) {
      const fileRef = storageRef(storage, storageRefPath);
      await deleteObject(fileRef).catch(() => {});
    }
    await deleteDoc(doc(db, 'groups', currentGroupId, 'messages', msgId));
  } catch(e) { showToast('Erreur suppression', 'error'); }
};

// ── ENVOI FICHIER ──────────────────────────────────────
window.sendFile = async function(input, type) {
  closeAttachMenu();
  const file = input.files[0];
  if (!file || !currentGroupId) return;
  if (file.size > 20 * 1024 * 1024) { showToast('Fichier trop volumineux (max 20 Mo)', 'error'); return; }

  showToast('Envoi en cours...', 'info');
  try {
    const path = `uploads/${currentGroupId}/${Date.now()}_${file.name}`;
    const ref  = storageRef(storage, path);
    await uploadBytes(ref, file);
    const url  = await getDownloadURL(ref);
    await addMessage({ type, url, fileName: file.name, storageRef: path });
    showToast('Fichier envoyé ✓', 'success');
  } catch(e) {
    console.error(e);
    showToast('Erreur d\'envoi du fichier', 'error');
  }
  input.value = '';
};

// ── AUDIO ──────────────────────────────────────────────
window.startVoiceRecording = async function() {
  closeAttachMenu();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder  = new MediaRecorder(stream);
    audioChunks    = [];
    recordingSeconds = 0;
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();

    document.getElementById('recording-bar').classList.remove('hidden');
    document.getElementById('message-input').closest('.input-bar').style.display = 'none';

    recordingTimer = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds/60);
      const s = recordingSeconds % 60;
      document.getElementById('recording-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);
  } catch(e) { showToast('Microphone non autorisé', 'error'); }
};

window.stopVoiceRecording = async function() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  clearInterval(recordingTimer);
  document.getElementById('recording-bar').classList.add('hidden');
  document.getElementById('message-input').closest('.input-bar').style.display = 'flex';

  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const path = `uploads/${currentGroupId}/audio_${Date.now()}.webm`;
    const ref  = storageRef(storage, path);
    showToast('Envoi audio...', 'info');
    try {
      await uploadBytes(ref, blob);
      const url = await getDownloadURL(ref);
      await addMessage({ type: 'audio', url, storageRef: path });
    } catch(e) { showToast('Erreur audio', 'error'); }
  };
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
};

window.cancelVoiceRecording = function() {
  if (mediaRecorder) { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
  clearInterval(recordingTimer);
  document.getElementById('recording-bar').classList.add('hidden');
  document.getElementById('message-input').closest('.input-bar').style.display = 'flex';
};

// ── CRÉER GROUPE (DG) ──────────────────────────────────
window.openNewGroupModal = function() { openModal('modal-new-group'); };

window.createGroup = async function() {
  const name = document.getElementById('new-group-name').value.trim();
  const ref  = document.getElementById('new-group-ref').value.trim();
  if (!name) { showToast('Nom du groupe requis', 'error'); return; }
  try {
    const groupRef = await addDoc(collection(db, 'groups'), {
      name, ref: ref || '', type: 'project',
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      memberIds: [currentUser.uid],
      lastMessage: '', lastMessageAt: serverTimestamp()
    });
    closeModal('modal-new-group');
    document.getElementById('new-group-name').value = '';
    document.getElementById('new-group-ref').value  = '';
    showToast(`Groupe "${name}" créé`, 'success');
    openGroup(groupRef.id, name);
  } catch(e) { showToast('Erreur création groupe', 'error'); }
};

// ── GÉRER GROUPE (options) ─────────────────────────────
window.openGroupMenu = async function() {
  if (!currentGroupId) return;
  const groupDoc = await getDoc(doc(db, 'groups', currentGroupId));
  const groupData = groupDoc.data();

  // Masquer suppression pour groupe permanent ou si non-DG
  const delSection = document.getElementById('delete-group-section');
  delSection.style.display = (currentUser.role === 'DG' && groupData.type !== 'permanent') ? 'block' : 'none';

  // Charger membres
  const membersList = document.getElementById('members-list');
  membersList.innerHTML = '<p style="color:var(--text-sub);font-size:.85rem">Chargement...</p>';

  openModal('modal-manage-group');

  const memberIds = groupData.memberIds || [];
  membersList.innerHTML = '';
  for (const uid of memberIds) {
    const uDoc = await getDoc(doc(db, 'users', uid));
    if (!uDoc.exists()) continue;
    const u = uDoc.data();
    const div = document.createElement('div');
    div.className = 'member-item';
    div.innerHTML = `
      <div>
        <p class="member-name">${escHtml(u.name)}</p>
        <p class="member-role">${roleFr(u.role)} · ${escHtml(u.username)}</p>
      </div>
      ${currentUser.role === 'DG' && uid !== currentUser.uid
        ? `<button class="btn-remove-member" onclick="removeMember('${uid}')">Retirer</button>`
        : ''}`;
    membersList.appendChild(div);
  }
};

window.removeMember = async function(uid) {
  if (!confirm('Retirer ce membre du groupe ?')) return;
  try {
    const groupRef = doc(db, 'groups', currentGroupId);
    const groupDoc = await getDoc(groupRef);
    const memberIds = (groupDoc.data().memberIds || []).filter(id => id !== uid);
    await updateDoc(groupRef, { memberIds });
    showToast('Membre retiré', 'success');
    openGroupMenu();
  } catch(e) { showToast('Erreur', 'error'); }
};

window.confirmDeleteGroup = async function() {
  if (!confirm('Supprimer définitivement ce groupe et tous ses messages ?')) return;
  try {
    // Supprimer tous les messages
    const msgsSnap = await getDocs(collection(db, 'groups', currentGroupId, 'messages'));
    for (const msgDoc of msgsSnap.docs) {
      const d = msgDoc.data();
      if (d.storageRef) await deleteObject(storageRef(storage, d.storageRef)).catch(()=>{});
      await deleteDoc(msgDoc.ref);
    }
    await deleteDoc(doc(db, 'groups', currentGroupId));
    closeModal('modal-manage-group');
    currentGroupId = null;
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('welcome-view').classList.remove('hidden');
    showToast('Groupe supprimé', 'success');
  } catch(e) { showToast('Erreur suppression groupe', 'error'); }
};

// ── GÉNÉRER LIEN D'INVITATION ──────────────────────────
window.generateInviteLink = async function() {
  if (!currentGroupId) return;
  const role = document.querySelector('input[name="invite-role"]:checked').value;
  const token = 'JN-' + Math.random().toString(36).substr(2,8).toUpperCase();

  try {
    await setDoc(doc(db, 'invites', token), {
      token, role, groupId: currentGroupId,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      used: false
    });
    const link = `${window.location.origin}${window.location.pathname}?invite=${token}`;
    document.getElementById('invite-link-value').value = link;
    document.getElementById('invite-link-result').classList.remove('hidden');
  } catch(e) { showToast('Erreur génération lien', 'error'); }
};

window.copyInviteLink = function() {
  const val = document.getElementById('invite-link-value').value;
  navigator.clipboard.writeText(val).then(() => showToast('Lien copié !', 'success'));
};

// ── NOTIFICATIONS ──────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotif(title, body, groupId) {
  if (Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: 'icons/icon-192.png' });
    n.onclick = () => { window.focus(); openGroup(groupId, title); };
  }
}

// ── MODAL IMAGE PLEIN ÉCRAN ────────────────────────────
window.openImageModal = function(url) {
  document.getElementById('modal-image-src').src = url;
  openModal('modal-image');
};

// ── SIDEBAR MOBILE ────────────────────────────────────
window.openSidebar  = function() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
};
window.closeSidebar = function() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
};

// ── ATTACH MENU ────────────────────────────────────────
window.openAttachMenu = function() {
  const menu = document.getElementById('attach-menu');
  menu.classList.toggle('hidden');
};
function closeAttachMenu() {
  document.getElementById('attach-menu').classList.add('hidden');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.btn-attach') && !e.target.closest('.attach-menu')) closeAttachMenu();
});

// ── MODALS GÉNÉRIQUES ─────────────────────────────────
window.openModal  = function(id) { document.getElementById(id)?.classList.remove('hidden'); };
window.closeModal = function(id) { document.getElementById(id)?.classList.add('hidden'); };

// Fermer modal au clic extérieur
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m && !m.classList.contains('modal-fullscreen')) closeModal(m.id); });
});

// ── TOAST ──────────────────────────────────────────────
window.showToast = function(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
};

// ── TOGGLE MOT DE PASSE ────────────────────────────────
window.togglePassword = function(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
};

// ── HELPERS ────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return String(str || '').replace(/'/g, '&#39;');
}
function showError(el, msg) {
  el.textContent = msg; el.classList.remove('hidden');
}
function formatDate(date) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d     = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff  = (today - d) / 86400000;
  if (diff === 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatTime(date) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function fileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = { pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📋', pptx:'📋', zip:'🗜️', txt:'📃' };
  return map[ext] || '📁';
}
