// ═══════════════════════════════════════════════════════════
// JUSWELL NEXUS — app.js
// Firebase : Auth + Firestore + Storage
// Repository GitHub : "juswell nexus"
// Firestore project  : "juswell nexus"
// ═══════════════════════════════════════════════════════════

import { initializeApp }           from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth,
         signInWithEmailAndPassword,
         createUserWithEmailAndPassword,
         signOut,
         onAuthStateChanged }      from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore,
         collection, doc, addDoc, setDoc, getDoc, getDocs,
         updateDoc, deleteDoc, query, where, orderBy,
         onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
         Timestamp }               from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getStorage,
         ref as storageRef,
         uploadBytesResumable,
         getDownloadURL,
         deleteObject }            from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

// ── ① CONFIGURATION FIREBASE ──────────────────────────────
// Remplacez les valeurs ci-dessous par vos vraies clés Firebase
// (Firebase console → Paramètres projet → Vos applications web)
const firebaseConfig = {
  apiKey:            "VOTRE_API_KEY",
  authDomain:        "juswell-nexus.firebaseapp.com",
  projectId:         "juswell-nexus",
  storageBucket:     "juswell-nexus.appspot.com",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId:             "VOTRE_APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);

// ── ② ÉTAT GLOBAL ──────────────────────────────────────────
let currentUser     = null;   // objet utilisateur Firestore { uid, id, name, role, phone }
let currentGroupId  = null;
let currentGroupData= null;
let msgUnsubscribe  = null;   // listener messages temps réel
let grpUnsubscribe  = null;   // listener groupes
let mediaRecorder   = null;
let audioChunks     = [];
let recInterval     = null;
let recSeconds      = 0;
let waveCtx         = null;
let waveAnimId      = null;

// ── ③ UTILITAIRES ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const showScreen = id => {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
};
const showModal = id => $(id).classList.remove("hidden");
const hideModal = id => $(id).classList.add("hidden");

function initials(name = "") {
  return name.trim().split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "JN-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateUserId(name = "") {
  const prefix = name.replace(/\s+/g, "").substring(0, 4).toUpperCase();
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${num}`;
}

// ── ④ SPLASH ───────────────────────────────────────────────
// Masquer le splash après 3.2s et garantir l'affichage login
window.addEventListener("load", () => {
  setTimeout(() => {
    const splash = $("splash-screen");
    if (splash) splash.style.display = "none";
    // Sécurité : si aucun écran visible → afficher login
    const anyVisible = [...document.querySelectorAll(".screen")]
      .some(s => !s.classList.contains("hidden"));
    if (!anyVisible) showScreen("login-screen");
  }, 3200);
});

// ── ⑤ AUTH STATE ───────────────────────────────────────────
onAuthStateChanged(auth, async (fireUser) => {
  if (!fireUser) {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("invite");
    if (inviteCode) {
      await handleInviteLink(inviteCode);
    } else {
      showScreen("login-screen");
    }
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", fireUser.uid));
    if (!snap.exists()) { await signOut(auth); showScreen("login-screen"); return; }
    currentUser = { uid: fireUser.uid, ...snap.data() };
    initApp();
  } catch(e) {
    console.error(e);
    showScreen("login-screen");
  }
});

// ── ⑥ CONNEXION ────────────────────────────────────────────
$("btn-login").addEventListener("click", async () => {
  const id  = $("login-id").value.trim();
  const pwd = $("login-password").value;
  if (!id || !pwd) return showError("login-error", "Veuillez remplir tous les champs.");
  $("login-error").classList.add("hidden");

  // ── Compte DG hardcodé (pas dans Firebase Auth) ──────────
  if (id === "DG" && pwd === "Juswell123") {
    currentUser = {
      uid:    "dg-admin",
      userId: "DG",
      name:   "Direction Générale",
      role:   "DG",
      phone:  ""
    };
    initApp();
    return;
  }

  try {
    const q = query(collection(db, "users"), where("userId", "==", id));
    const snap = await getDocs(q);
    if (snap.empty) return showError("login-error", "Identifiant introuvable.");
    const userData = snap.docs[0].data();
    await signInWithEmailAndPassword(auth, userData.email, pwd);
  } catch (e) {
    showError("login-error", "Identifiant ou mot de passe incorrect.");
  }
});

// Touche Entrée
["login-id", "login-password"].forEach(id => {
  $(id).addEventListener("keydown", e => {
    if (e.key === "Enter") $("btn-login").click();
  });
});

// Afficher/cacher mot de passe
$("btn-eye").addEventListener("click", () => {
  const inp = $("login-password");
  inp.type = inp.type === "password" ? "text" : "password";
});

// ── ⑦ IDENTIFIANT OUBLIÉ ────────────────────────────────────
$("forgot-link").addEventListener("click", e => {
  e.preventDefault(); showScreen("forgot-screen");
});
$("btn-back-forgot").addEventListener("click", () => showScreen("login-screen"));

$("btn-forgot-submit").addEventListener("click", async () => {
  const phone = $("forgot-phone").value.trim();
  if (!phone) return;
  const q = query(collection(db, "users"), where("phone", "==", phone));
  const snap = await getDocs(q);
  if (snap.empty) {
    showError("forgot-error", "Aucun compte avec ce numéro.");
  } else {
    const userId = snap.docs[0].data().userId;
    $("forgot-result").className = "alert alert-success";
    $("forgot-result").textContent = `Votre identifiant : ${userId}`;
    $("forgot-result").classList.remove("hidden");
    $("forgot-error").classList.add("hidden");
  }
});

// ── ⑧ INSCRIPTION VIA INVITATION ────────────────────────────
async function handleInviteLink(code) {
  const invSnap = await getDoc(doc(db, "invitations", code));
  if (!invSnap.exists() || invSnap.data().used) {
    showScreen("login-screen");
    showError("login-error", "Ce lien d'invitation est invalide ou déjà utilisé.");
    return;
  }
  const inv = invSnap.data();
  $("invite-role-badge").textContent = inv.role === "agent" ? "👤 Agent" : "🎨 Designer / Client";
  const grpSnap = await getDoc(doc(db, "groups", inv.groupId));
  $("invite-group-info").textContent = grpSnap.exists()
    ? `Invitation pour le groupe : ${grpSnap.data().name}`
    : "";

  $("btn-register").dataset.inviteCode = code;
  $("btn-register").dataset.role       = inv.role;
  $("btn-register").dataset.groupId    = inv.groupId;
  showScreen("register-screen");
}

$("btn-register").addEventListener("click", async () => {
  const name    = $("reg-name").value.trim();
  const phone   = $("reg-phone").value.trim();
  const pwd     = $("reg-password").value;
  const btn     = $("btn-register");
  const code    = btn.dataset.inviteCode;
  const role    = btn.dataset.role;
  const groupId = btn.dataset.groupId;

  if (!name || !phone || !pwd) return showError("register-error", "Veuillez remplir tous les champs.");
  if (pwd.length < 6) return showError("register-error", "Mot de passe minimum 6 caractères.");

  const userId = generateUserId(name);
  const email  = `${userId.toLowerCase()}@juswell.app`;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    const uid  = cred.user.uid;

    await setDoc(doc(db, "users", uid), {
      userId, name, phone, role, email,
      createdAt: serverTimestamp()
    });

    // Marquer l'invitation comme utilisée
    await updateDoc(doc(db, "invitations", code), { used: true, usedBy: uid });

    // Ajouter au groupe invité
    await updateDoc(doc(db, "groups", groupId), {
      members: arrayUnion(uid)
    });

    // Si agent → ajouter au groupe Équipe Permanente aussi
    if (role === "agent") {
      const epSnap = await getDocs(query(collection(db, "groups"), where("type", "==", "permanent")));
      if (!epSnap.empty) {
        await updateDoc(doc(db, "groups", epSnap.docs[0].id), {
          members: arrayUnion(uid)
        });
      }
    }

    // Afficher identifiants
    $("cred-id-display").textContent  = userId;
    $("cred-pwd-display").textContent = pwd;
    showScreen("credentials-screen");
  } catch (e) {
    showError("register-error", "Erreur lors de la création : " + e.message);
  }
});

$("btn-go-app").addEventListener("click", () => {
  window.history.replaceState({}, "", "/");
});

// ── ⑨ APPLICATION PRINCIPALE ────────────────────────────────
async function initApp() {
  showScreen("app-screen");
  updateSidebarProfile();

  // DG uniquement : afficher bouton créer groupe
  if (currentUser.role === "DG") {
    $("dg-footer").style.display = "block";
    await ensurePermanentGroup();
  }

  loadGroups();
}

// Crée le groupe "Équipe Permanente" s'il n'existe pas encore
async function ensurePermanentGroup() {
  try {
    const q = query(collection(db, "groups"), where("type", "==", "permanent"));
    const snap = await getDocs(q);
    if (snap.empty) {
      await addDoc(collection(db, "groups"), {
        name: "Équipe Permanente",
        ref: "",
        type: "permanent",
        members: ["dg-admin"],
        createdBy: "dg-admin",
        createdAt: serverTimestamp()
      });
      console.log("[JN] Groupe Équipe Permanente créé.");
    }
  } catch(e) {
    console.warn("[JN] ensurePermanentGroup:", e.message);
  }
}

function updateSidebarProfile() {
  const av = initials(currentUser.name);
  $("sidebar-avatar").textContent = av;
  $("topbar-avatar").textContent  = av;
  $("sidebar-username").textContent = currentUser.name;
  $("sidebar-role").textContent = roleLabel(currentUser.role);
}

function roleLabel(role) {
  if (role === "DG" || role === "admin") return "Direction Générale";
  if (role === "agent")   return "Agent";
  if (role === "designer") return "Designer / Client";
  return role;
}

// ── ⑩ DÉCONNEXION ───────────────────────────────────────────
$("btn-logout").addEventListener("click", async () => {
  if (grpUnsubscribe) grpUnsubscribe();
  if (msgUnsubscribe) msgUnsubscribe();
  try { await signOut(auth); } catch(e) { /* DG hardcodé : pas de session Firebase */ }
  currentUser    = null;
  currentGroupId = null;
  currentGroupData = null;
  showScreen("login-screen");
});

// ── ⑪ GROUPES ────────────────────────────────────────────────
function loadGroups() {
  const uid = currentUser.uid;
  let q;
  if (currentUser.role === "DG" || currentUser.role === "admin") {
    q = query(collection(db, "groups"), orderBy("createdAt", "asc"));
  } else {
    q = query(collection(db, "groups"), where("members", "array-contains", uid), orderBy("createdAt", "asc"));
  }

  if (grpUnsubscribe) grpUnsubscribe();
  grpUnsubscribe = onSnapshot(q, snap => {
    const list = $("groups-list");
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = '<p class="loading-text">Aucun groupe disponible.</p>';
      return;
    }
    snap.docs.forEach(d => renderGroupItem(d.id, d.data()));
  });
}

function renderGroupItem(id, data) {
  const item = document.createElement("div");
  item.className = "group-item" + (id === currentGroupId ? " active" : "");
  item.dataset.id = id;

  const av = document.createElement("div");
  av.className = "group-avatar";
  av.textContent = initials(data.name);

  const info = document.createElement("div");
  info.className = "group-info";
  info.innerHTML = `<div class="group-name">${data.name}</div>
                    <div class="group-preview">${data.ref || (data.type === "permanent" ? "Équipe interne" : "Projet / Contrat")}</div>`;

  item.appendChild(av);
  item.appendChild(info);
  item.addEventListener("click", () => openGroup(id, data));
  $("groups-list").appendChild(item);
}

async function openGroup(id, data) {
  currentGroupId   = id;
  currentGroupData = data;

  // Marquer actif
  document.querySelectorAll(".group-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });

  // Header
  $("chat-group-name").textContent = data.name;
  const memberCount = data.members ? data.members.length : 0;
  $("chat-group-members").textContent = `${memberCount} membre${memberCount > 1 ? "s" : ""}`;

  // Options DG
  const isDG = currentUser.role === "DG" || currentUser.role === "admin";
  $("btn-group-options").style.display = isDG ? "" : "none";

  // Afficher chat
  $("no-group-selected").classList.add("hidden");
  $("chat-area").classList.remove("hidden");

  // Mobile : masquer sidebar
  if (window.innerWidth < 900) closeSidebar();

  // Messages en temps réel
  subscribeToMessages(id);
}

// ── ⑫ MESSAGES — TEMPS RÉEL (Firestore listener) ────────────
function subscribeToMessages(groupId) {
  if (msgUnsubscribe) msgUnsubscribe();
  $("messages-container").innerHTML = "";

  const q = query(
    collection(db, "groups", groupId, "messages"),
    orderBy("createdAt", "asc")
  );

  msgUnsubscribe = onSnapshot(q, snap => {
    const container = $("messages-container");
    let lastDate = "";

    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        const msg = { id: change.doc.id, ...change.doc.data() };
        const dateStr = formatDate(msg.createdAt);
        if (dateStr !== lastDate) {
          lastDate = dateStr;
          const sep = document.createElement("div");
          sep.className = "date-separator";
          sep.textContent = dateStr;
          container.appendChild(sep);
        }
        container.appendChild(buildMsgEl(msg));
      }
      if (change.type === "modified") {
        const el = container.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (el) {
          const updated = { id: change.doc.id, ...change.doc.data() };
          el.replaceWith(buildMsgEl(updated));
        }
      }
      if (change.type === "removed") {
        const el = container.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (el) el.remove();
      }
    });

    container.scrollTop = container.scrollHeight;
  });
}

function buildMsgEl(msg) {
  const isMe = msg.senderId === currentUser.uid;
  const isDG = currentUser.role === "DG" || currentUser.role === "admin";

  const wrap = document.createElement("div");
  wrap.className = `msg-wrap ${isMe ? "me" : "other"}`;
  wrap.dataset.msgId = msg.id;

  // Avatar (autres seulement)
  if (!isMe) {
    const av = document.createElement("div");
    av.className = "msg-avatar";
    av.textContent = initials(msg.senderName || "?");
    wrap.appendChild(av);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // Nom expéditeur (groupes)
  if (!isMe) {
    const sn = document.createElement("div");
    sn.className = "msg-sender";
    sn.textContent = msg.senderName;
    bubble.appendChild(sn);
  }

  // Contenu
  const content = buildMsgContent(msg, isMe);
  bubble.appendChild(content);

  // Heure + modifié
  const foot = document.createElement("div");
  foot.className = "msg-time";
  foot.innerHTML = `${msg.edited ? '<span class="msg-edited">modifié · </span>' : ""}${formatTime(msg.createdAt)}`;
  bubble.appendChild(foot);

  // Actions (modifier / supprimer)
  const actions = buildMsgActions(msg, isMe, isDG, bubble, wrap);
  bubble.appendChild(actions);

  // Mobile : tap pour afficher actions
  bubble.addEventListener("click", e => {
    if (e.target.closest(".msg-actions")) return;
    bubble.classList.toggle("tapped");
  });

  wrap.appendChild(bubble);
  return wrap;
}

function buildMsgContent(msg, isMe) {
  const div = document.createElement("div");
  if (msg.type === "text") {
    div.textContent = msg.text;
  } else if (msg.type === "image") {
    const img = document.createElement("img");
    img.src = msg.url; img.className = "msg-image"; img.alt = "Image";
    img.addEventListener("click", e => { e.stopPropagation(); openMedia("image", msg.url); });
    div.appendChild(img);
  } else if (msg.type === "video") {
    const vid = document.createElement("video");
    vid.src = msg.url; vid.className = "msg-video";
    vid.controls = true; vid.preload = "metadata";
    div.appendChild(vid);
  } else if (msg.type === "audio") {
    const audio = document.createElement("audio");
    audio.src = msg.url; audio.controls = true; audio.className = "msg-audio";
    div.appendChild(audio);
  } else if (msg.type === "file") {
    const a = document.createElement("a");
    a.href = msg.url; a.download = msg.fileName || "fichier";
    a.className = "msg-file-dl"; a.target = "_blank";
    a.innerHTML = `📄 <span>${msg.fileName || "Fichier"}</span>`;
    div.appendChild(a);
  }
  return div;
}

function buildMsgActions(msg, isMe, isDG, bubble, wrap) {
  const div = document.createElement("div");
  div.className = "msg-actions";

  if (msg.type === "text" && isMe) {
    const btnEdit = document.createElement("button");
    btnEdit.textContent = "✏️ Modifier";
    btnEdit.addEventListener("click", e => {
      e.stopPropagation();
      const newText = prompt("Modifier le message :", msg.text);
      if (newText !== null && newText.trim()) {
        updateDoc(doc(db, "groups", currentGroupId, "messages", msg.id), {
          text: newText.trim(), edited: true
        });
      }
      bubble.classList.remove("tapped");
    });
    div.appendChild(btnEdit);
  }

  if (isMe || isDG) {
    const btnDel = document.createElement("button");
    btnDel.className = "danger";
    btnDel.textContent = "🗑 Supprimer";
    btnDel.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm("Supprimer ce message ?")) return;
      // Supprimer fichier Storage si applicable
      if (msg.storagePath) {
        try { await deleteObject(storageRef(storage, msg.storagePath)); } catch (_) {}
      }
      await deleteDoc(doc(db, "groups", currentGroupId, "messages", msg.id));
      bubble.classList.remove("tapped");
    });
    div.appendChild(btnDel);
  }

  return div;
}

// ── ⑬ ENVOYER UN MESSAGE ────────────────────────────────────
$("btn-send").addEventListener("click", sendTextMessage);
$("message-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage();
  }
});
$("message-input").addEventListener("input", () => {
  const ta = $("message-input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
});

async function sendTextMessage() {
  const text = $("message-input").value.trim();
  if (!text || !currentGroupId) return;
  $("message-input").value = "";
  $("message-input").style.height = "auto";

  await addDoc(collection(db, "groups", currentGroupId, "messages"), {
    type: "text", text,
    senderId:   currentUser.uid,
    senderName: currentUser.name,
    createdAt:  serverTimestamp(),
    edited: false
  });
  pushInAppNotif(currentGroupId);
}

// ── ⑭ FICHIERS / MÉDIAS ─────────────────────────────────────
$("btn-attach").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file || !currentGroupId) return;
  e.target.value = "";

  const MAX = 20 * 1024 * 1024; // 20 Mo
  if (file.size > MAX) return alert("Fichier trop volumineux (max 20 Mo).");

  const path = `groups/${currentGroupId}/${Date.now()}_${file.name}`;
  const sRef = storageRef(storage, path);
  const task = uploadBytesResumable(sRef, file);

  task.on("state_changed", null, err => alert("Erreur upload : " + err.message),
    async () => {
      const url = await getDownloadURL(task.snapshot.ref);
      const type = detectFileType(file.type);
      await addDoc(collection(db, "groups", currentGroupId, "messages"), {
        type, url, storagePath: path,
        fileName:   file.name,
        senderId:   currentUser.uid,
        senderName: currentUser.name,
        createdAt:  serverTimestamp(),
        edited: false
      });
    }
  );
});

function detectFileType(mime) {
  if (mime.startsWith("image/"))  return "image";
  if (mime.startsWith("video/"))  return "video";
  if (mime.startsWith("audio/"))  return "audio";
  return "file";
}

// ── ⑮ ENREGISTREMENT AUDIO ──────────────────────────────────
$("btn-mic").addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder  = new MediaRecorder(stream);
    audioChunks    = [];
    recSeconds     = 0;

    $("audio-recorder").classList.remove("hidden");
    waveCtx = $("wave-canvas").getContext("2d");
    animateWave(stream);

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      clearInterval(recInterval);
      cancelAnimationFrame(waveAnimId);
      stream.getTracks().forEach(t => t.stop());
      $("audio-recorder").classList.add("hidden");

      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const path = `groups/${currentGroupId}/${Date.now()}_voice.webm`;
      const sRef = storageRef(storage, path);
      const task = uploadBytesResumable(sRef, blob);
      task.on("state_changed", null, null, async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        await addDoc(collection(db, "groups", currentGroupId, "messages"), {
          type: "audio", url, storagePath: path,
          fileName: "Message vocal",
          senderId:   currentUser.uid,
          senderName: currentUser.name,
          createdAt:  serverTimestamp(),
          edited: false
        });
      });
    };

    mediaRecorder.start();
    recInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60);
      const s = String(recSeconds % 60).padStart(2, "0");
      $("rec-timer").textContent = `${m}:${s}`;
    }, 1000);

  } catch (err) { alert("Microphone inaccessible : " + err.message); }
});

$("btn-stop-rec").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
});
$("btn-cancel-rec").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    audioChunks = []; // vider pour ne pas envoyer
    $("audio-recorder").classList.add("hidden");
  }
});

function animateWave(stream) {
  const ctx2    = waveCtx;
  const canvas  = $("wave-canvas");
  const analyser = new (window.AudioContext || window.webkitAudioContext)().createAnalyser();
  new (window.AudioContext || window.webkitAudioContext)().createMediaStreamSource(stream).connect(analyser);
  analyser.fftSize = 64;
  const data = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    waveAnimId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    const barW = canvas.width / data.length;
    data.forEach((v, i) => {
      const h = (v / 255) * canvas.height;
      ctx2.fillStyle = "#1d6fdb";
      ctx2.fillRect(i * barW, canvas.height - h, barW - 1, h);
    });
  }
  draw();
}

// ── ⑯ VISIONNEUSE MÉDIA ─────────────────────────────────────
function openMedia(type, url) {
  const viewer = $("media-viewer");
  viewer.innerHTML = type === "image"
    ? `<img src="${url}" alt="Image"/>`
    : `<video src="${url}" controls autoplay></video>`;
  showModal("modal-media");
}
$("btn-close-media").addEventListener("click", () => {
  hideModal("modal-media");
  $("media-viewer").innerHTML = "";
});

// ── ⑰ NOTIFICATION IN-APP ───────────────────────────────────
function pushInAppNotif(groupId) {
  // Notifier les autres groupes (via onSnapshot déjà actif)
  // Déclenchement navigateur si permission
  if (Notification.permission === "granted") {
    new Notification("Juswell Nexus", {
      body: `Nouveau message dans ${currentGroupData?.name || "un groupe"}`,
      icon: "icons/icon-192.png"
    });
  }
}

// Demander permission notifications au démarrage
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}

// ── ⑱ CRÉER UN GROUPE (DG) ──────────────────────────────────
$("btn-create-group").addEventListener("click", () => showModal("modal-create-group"));

$("btn-confirm-create").addEventListener("click", async () => {
  const name = $("new-group-name").value.trim();
  if (!name) { showError("login-error", "Nom du groupe requis."); return; }
  const ref  = $("new-group-ref").value.trim();
  const btn  = $("btn-confirm-create");
  btn.disabled = true;
  btn.textContent = "Création…";

  try {
    const newGroupRef = await addDoc(collection(db, "groups"), {
      name, ref,
      type: "project",
      members: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $("new-group-name").value = "";
    $("new-group-ref").value  = "";
    hideModal("modal-create-group");
    // Ouvrir directement le groupe créé
    await openGroup(newGroupRef.id, { name, ref, type: "project", members: [currentUser.uid] });
  } catch(e) {
    console.error("[JN] createGroup:", e);
    alert("Erreur création groupe : " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Créer";
  }
});

// ── ⑲ GÉRER UN GROUPE (DG) ──────────────────────────────────
$("btn-group-options").addEventListener("click", async () => {
  if (!currentGroupId || !currentGroupData) return;
  $("manage-group-title").textContent = currentGroupData.name;

  // Membres
  const list = $("manage-members-list");
  list.innerHTML = "";
  const memberIds = currentGroupData.members || [];
  for (const uid of memberIds) {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) continue;
    const u = snap.data();
    const item = document.createElement("div");
    item.className = "member-item";
    item.innerHTML = `
      <div class="avatar sm">${initials(u.name)}</div>
      <span class="member-name">${u.name}</span>
      <span class="member-role">${roleLabel(u.role)}</span>
      ${uid !== currentUser.uid
        ? `<button class="btn btn-ghost btn-sm" data-uid="${uid}">Retirer</button>`
        : ""}`;
    list.appendChild(item);
  }

  // Boutons "Retirer"
  list.querySelectorAll("[data-uid]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "groups", currentGroupId), {
        members: arrayRemove(btn.dataset.uid)
      });
      btn.closest(".member-item").remove();
    });
  });

  // Cacher lien précédent
  $("invite-link-wrap").classList.add("hidden");
  showModal("modal-manage-group");
});

$("btn-gen-invite").addEventListener("click", async () => {
  const role = document.querySelector('input[name="inv-role"]:checked').value;
  const code = generateInviteCode();
  const link = `${location.origin}/?invite=${code}`;

  await setDoc(doc(db, "invitations", code), {
    code, role,
    groupId:   currentGroupId,
    createdBy: currentUser.uid,
    used:      false,
    createdAt: serverTimestamp()
  });

  $("invite-link-text").textContent = link;
  $("invite-link-wrap").classList.remove("hidden");
});

$("btn-copy-invite").addEventListener("click", () => {
  navigator.clipboard.writeText($("invite-link-text").textContent);
  $("btn-copy-invite").textContent = "✓ Copié";
  setTimeout(() => { $("btn-copy-invite").textContent = "Copier"; }, 2000);
});

$("btn-delete-group").addEventListener("click", async () => {
  if (!confirm(`Supprimer définitivement le groupe "${currentGroupData.name}" ?`)) return;
  await deleteDoc(doc(db, "groups", currentGroupId));
  hideModal("modal-manage-group");
  currentGroupId   = null;
  currentGroupData = null;
  $("chat-area").classList.add("hidden");
  $("no-group-selected").classList.remove("hidden");
});

// ── ⑳ FERMER LES MODALS ─────────────────────────────────────
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => hideModal(btn.dataset.close));
});
document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", e => {
    if (e.target === modal) hideModal(modal.id);
  });
});

// ── ㉑ SIDEBAR MOBILE ────────────────────────────────────────
$("btn-menu").addEventListener("click", openSidebar);
$("sidebar-overlay").addEventListener("click", closeSidebar);
$("btn-back-chat").addEventListener("click", () => {
  $("chat-area").classList.add("hidden");
  $("no-group-selected").classList.remove("hidden");
});

function openSidebar() {
  $("sidebar").classList.add("open");
  $("sidebar-overlay").classList.remove("hidden");
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebar-overlay").classList.add("hidden");
}

// ── ㉒ ERREURS ────────────────────────────────────────────────
function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ── ㉓ SERVICE WORKER ────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => console.log("SW enregistré :", reg.scope))
      .catch(err => console.warn("SW erreur :", err));
  });
}
