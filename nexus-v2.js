/* =========================================================
   RED NEXUS CLASSROOM — NEXUS V2
   Capa P2P + transferencia de archivos
   Correcciones:
   - conserva el objeto File durante toda la transferencia
   - acepta network_ready/ready/presence del backend
   - evita reconexiones duplicadas
   - refresca miembros al entrar otro nodo
   - ICE candidates pendientes
   - verifica SHA-256 antes de descargar
   - interfaz añadida sin reemplazar la interfaz original
   ========================================================= */
(() => {
  "use strict";
  if (window.__NEXUS_V2__) return;
  window.__NEXUS_V2__ = true;

  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let token = localStorage.getItem("nexusToken") || null;
  let user = null;
  let activeClass = null;
  let socket = null;
  let socketGeneration = 0;
  let reconnectTimer = null;
  let manualClose = false;

  const peers = new Map();
  const transfers = new Map();
  const incoming = new Map();

  function status(text, ok = false) {
    const el = $("nx2Status");
    if (!el) return;
    el.innerHTML = `<span class="nx2dot ${ok ? "ok" : ""}"></span>${esc(text)}`;
  }

  function toast2(text) {
    if (typeof window.toast === "function") {
      window.toast(text);
      return;
    }
    const e = $("toast");
    if (e) {
      e.textContent = text;
      e.classList.add("show");
      setTimeout(() => e.classList.remove("show"), 2800);
      return;
    }
    console.log("[NEXUS V2]", text);
  }

  function addStyle() {
    if ($("nexusV2Style")) return;
    const s = document.createElement("style");
    s.id = "nexusV2Style";
    s.textContent = `
      .nx2bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;padding:10px;border:1px solid var(--line,#29445b);border-radius:12px;background:#091523}
      .nx2status{font-size:10px;color:var(--muted,#8da2b5);margin-left:auto}
      .nx2dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e05252;margin-right:5px}
      .nx2dot.ok{background:#58e38b;box-shadow:0 0 12px #58e38b88}
      .nx2peer{border:1px solid var(--line,#29445b);border-radius:10px;padding:9px;background:#0a1220;display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:7px}
      .nx2peer small{display:block;color:var(--muted,#8da2b5);font-size:9px;margin-top:2px}
      .nx2peer button{padding:6px 8px;font-size:10px}
      .nx2drop{border:1px dashed #4b678f;border-radius:12px;padding:13px;text-align:center;color:var(--muted,#8da2b5);font-size:11px;margin-top:10px}
      .nx2drop.drag{border-color:#58d6ff;color:#fff;background:#102238}
      .nx2mini{font-size:9px;color:var(--muted,#8da2b5);margin-top:8px}
      .nx2progress{height:5px;border-radius:99px;background:#16283a;overflow:hidden;margin-top:6px}
      .nx2progress>i{display:block;height:100%;width:0;background:#58d6ff;transition:width .15s}
    `;
    document.head.appendChild(s);
  }

  async function api(path, options = {}) {
    token = localStorage.getItem("nexusToken") || token;
    const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: "Bearer " + token } : {})
    };
    const response = await fetch("/api" + path, {...options, headers});
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function refresh() {
    token = localStorage.getItem("nexusToken") || null;
    if (!token) {
      user = null;
      activeClass = null;
      renderPresence([]);
      return;
    }

    try {
      const me = await api("/me");
      user = me.user || me;
    } catch {
      user = null;
      return;
    }

    try {
      const result = await api("/classes");
      const classes = Array.isArray(result.classes) ? result.classes : [];
      if (!classes.length) {
        activeClass = null;
        renderPresence([]);
        return;
      }
      const wanted = localStorage.getItem("nexusV2ClassId");
      activeClass =
        classes.find(c => String(c.id) === String(wanted)) ||
        activeClass && classes.find(c => String(c.id) === String(activeClass.id)) ||
        classes[0];
      localStorage.setItem("nexusV2ClassId", activeClass.id);
    } catch {}
  }

  function ensureUI() {
    addStyle();
    const section = $("network");
    if (!section || $("nx2bar")) return;

    const panel =
      section.querySelector(".panel") ||
      section.querySelector("[class*='panel']") ||
      section;

    const bar = document.createElement("div");
    bar.id = "nx2bar";
    bar.className = "nx2bar";
    bar.innerHTML = `
      <button id="nx2Connect" class="primary" type="button">⚡ CONECTAR RED V2</button>
      <button id="nx2File" type="button">📦 ENVIAR ARCHIVO</button>
      <span id="nx2Status" class="nx2status"><span class="nx2dot"></span>desconectado</span>
    `;
    panel.insertBefore(bar, panel.firstChild);

    const peersBox = document.createElement("div");
    peersBox.id = "nx2Peers";
    panel.insertBefore(peersBox, bar.nextSibling);

    const drop = document.createElement("div");
    drop.id = "nx2Drop";
    drop.className = "nx2drop";
    drop.textContent = "Arrastrá un archivo aquí para enviarlo a un nodo conectado";
    panel.appendChild(drop);

    $("nx2Connect").addEventListener("click", connect);
    $("nx2File").addEventListener("click", () => pickFile());

    drop.addEventListener("dragover", e => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", e => {
      e.preventDefault();
      drop.classList.remove("drag");
      const file = e.dataTransfer?.files?.[0];
      if (file) sendToFirst(file);
    });

    renderPresence(activeClass?.members || []);
  }

  function renderPresence(list) {
    const box = $("nx2Peers");
    if (!box) return;

    let members = Array.isArray(list) ? list.slice() : [];
    if (!members.length && activeClass?.members) {
      members = activeClass.members.slice();
    }

    members = members.filter(m => m && m.id);
    box.innerHTML =
      `<div class="nx2mini">NODOS DEL AULA · ${members.length}</div>` +
      (members.length
        ? members.map(m => {
            const state = peers.get(m.id)?.pc?.connectionState || "offline";
            const canConnect = m.id !== user?.id;
            return `
              <div class="nx2peer">
                <div>
                  <b>${esc(m.name || m.username || "Nodo")}</b>
                  <small>${m.role === "teacher" ? "DOCENTE" : "ALUMNO"} · ${esc(state)}</small>
                </div>
                ${canConnect ? `<button type="button" data-nx2-peer="${esc(m.id)}">CONECTAR</button>` : `<small>ESTE DISPOSITIVO</small>`}
              </div>`;
          }).join("")
        : `<div class="nx2mini">No hay otros nodos disponibles todavía.</div>`);

    box.querySelectorAll("[data-nx2-peer]").forEach(btn => {
      btn.addEventListener("click", () => connectPeer(btn.dataset.nx2Peer));
    });
  }

  async function connect() {
    token = localStorage.getItem("nexusToken") || token;
    if (!token) {
      status("iniciá sesión");
      toast2("Necesitás iniciar sesión para conectar Red Nexus.");
      return;
    }

    if (socket?.readyState === WebSocket.OPEN) {
      status("Red V2 conectada", true);
      await joinClass();
      return;
    }

    if (socket?.readyState === WebSocket.CONNECTING) {
      status("conectando…");
      return;
    }

    manualClose = false;
    clearTimeout(reconnectTimer);
    const generation = ++socketGeneration;
    const protocol = location.protocol === "https:" ? "wss://" : "ws://";
    socket = new WebSocket(protocol + location.host);

    socket.onopen = async () => {
      if (generation !== socketGeneration) return;
      status("autenticando…");
      socket.send(JSON.stringify({type:"auth", token}));
    };

    socket.onmessage = async event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      await onSocketMessage(message);
    };

    socket.onerror = () => {
      if (generation === socketGeneration) status("error de red");
    };

    socket.onclose = () => {
      if (generation !== socketGeneration) return;
      socket = null;
      for (const p of peers.values()) {
        try { p.pc.close(); } catch {}
      }
      peers.clear();
      renderPresence();
      if (!manualClose && localStorage.getItem("nexusToken")) {
        status("reconexión pendiente");
        reconnectTimer = setTimeout(() => connect(), 2500);
      } else {
        status("red desconectada");
      }
    };
  }

  async function onSocketMessage(m) {
    switch (m.type) {
      case "ready":
      case "auth_ok":
      case "authenticated":
      case "network_ready":
        status("Red V2 conectada", true);
        await joinClass();
        break;

      case "presence":
        if (Array.isArray(m.members)) {
          if (activeClass) activeClass.members = m.members;
          renderPresence(m.members);
        }
        break;

      case "join_class":
      case "class_joined":
        if (Array.isArray(m.members)) {
          if (activeClass) activeClass.members = m.members;
          renderPresence(m.members);
        }
        break;

      case "member_joined":
        await refresh();
        renderPresence(activeClass?.members || []);
        break;

      case "signal":
        await rtcSignal(m.from || m.peerId, m.data || m.signal);
        break;

      case "chat":
        break;
    }
  }

  async function joinClass() {
    await refresh();
    if (!activeClass || socket?.readyState !== WebSocket.OPEN) return;
    localStorage.setItem("nexusV2ClassId", activeClass.id);
    socket.send(JSON.stringify({type:"join_class", classId:activeClass.id}));
    status("aula conectada", true);
  }

  function sendSignal(to, data) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({type:"signal", to, data}));
    return true;
  }

  function connectPeer(id) {
    if (!id || id === user?.id) return;
    if (socket?.readyState !== WebSocket.OPEN) {
      connect();
      setTimeout(() => connectPeer(id), 900);
      return;
    }

    const peer = makePeer(id, true);
    if (peer) status("negociando P2P…");
  }

  function makePeer(id, initiator) {
    if (!id || id === user?.id) return null;
    if (peers.has(id)) return peers.get(id);

    if (typeof RTCPeerConnection !== "function") {
      status("WebRTC no disponible");
      toast2("Este navegador no dispone de WebRTC.");
      return null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        {urls:"stun:stun.l.google.com:19302"},
        {urls:"stun:stun1.l.google.com:19302"}
      ]
    });

    const peer = {pc, dc:null, candidates:[]};
    peers.set(id, peer);

    pc.onicecandidate = event => {
      if (event.candidate) sendSignal(id, {candidate:event.candidate});
    };

    pc.ondatachannel = event => setupChannel(id, event.channel);

    pc.onconnectionstatechange = () => {
      renderPresence();
      const state = pc.connectionState;
      if (state === "connected") {
        status("P2P directo · " + peerName(id), true);
      } else if (state === "failed") {
        toast2("No se pudo establecer P2P con " + peerName(id));
      } else if (state === "closed") {
        peers.delete(id);
        renderPresence();
      }
    };

    if (initiator) {
      const dc = pc.createDataChannel("nexus-v2", {ordered:true});
      setupChannel(id, dc);
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => sendSignal(id, {description:pc.localDescription}))
        .catch(err => console.error("[NEXUS V2] offer", err));
    }

    return peer;
  }

  async function rtcSignal(from, data) {
    if (!from || !data) return;
    const peer = makePeer(from, false);
    if (!peer) return;

    try {
      if (data.description) {
        await peer.pc.setRemoteDescription(data.description);

        if (data.description.type === "offer") {
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          sendSignal(from, {description:peer.pc.localDescription});
        }

        for (const candidate of peer.candidates.splice(0)) {
          try { await peer.pc.addIceCandidate(candidate); } catch {}
        }
      } else if (data.candidate) {
        if (peer.pc.remoteDescription) {
          await peer.pc.addIceCandidate(data.candidate);
        } else {
          peer.candidates.push(data.candidate);
        }
      }
    } catch (error) {
      console.error("[NEXUS V2] señalización", error);
      status("falló la negociación P2P");
    }
  }

  function setupChannel(id, dc) {
    const peer = peers.get(id);
    if (!peer) return;

    peer.dc = dc;
    dc.binaryType = "arraybuffer";

    dc.onopen = () => {
      status("P2P directo · " + peerName(id), true);
      renderPresence();
    };

    dc.onclose = () => renderPresence();
    dc.onerror = () => status("error en canal P2P");
    dc.onmessage = event => receive(id, event.data);
  }

  function peerName(id) {
    return activeClass?.members?.find(m => String(m.id) === String(id))?.name ||
           activeClass?.members?.find(m => String(m.id) === String(id))?.username ||
           "dispositivo";
  }

  function firstPeer() {
    for (const [id, peer] of peers) {
      if (peer.dc?.readyState === "open") return id;
    }
    return null;
  }

  function pickFile(targetId = null) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        const id = targetId || firstPeer();
        if (id) sendFile(id, file);
        else sendToFirst(file);
      }
    };
    input.click();
  }

  function sendToFirst(file) {
    const id = firstPeer();
    if (!id) {
      toast2("Conectá primero un nodo del aula.");
      status("sin canal P2P");
      return;
    }
    sendFile(id, file);
  }

  async function sha256(blob) {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map(x => x.toString(16).padStart(2,"0"))
      .join("");
  }

  async function sendFile(id, file) {
    if (!(file instanceof File)) {
      toast2("Archivo inválido.");
      return false;
    }

    const dc = peers.get(id)?.dc;
    if (!dc || dc.readyState !== "open") {
      toast2("El canal P2P todavía no está abierto.");
      return false;
    }

    try {
      status("calculando integridad…");
      const hash = await sha256(file);
      const transferId = crypto.randomUUID();

      /* CORRECCIÓN CLAVE:
         se guarda `file` dentro del estado.
         La versión anterior lo omitía y luego intentaba usar j.file. */
      const job = {
        id: transferId,
        file,                         // <- necesario para streamFile()
        fileName: file.name,
        size: file.size,
        sent: 0,
        peerId: id,
        sha256: hash,
        status: "esperando aceptación",
        createdAt: Date.now()
      };

      transfers.set(transferId, job);

      dc.send(JSON.stringify({
        type:"nx2-offer",
        transferId,
        fileName:file.name,
        size:file.size,
        mime:file.type || "application/octet-stream",
        sha256:hash
      }));

      toast2("Solicitud enviada a " + peerName(id));
      status("esperando aceptación…");
      return true;
    } catch (error) {
      console.error(error);
      status("error preparando archivo");
      toast2("No se pudo preparar el archivo.");
      return false;
    }
  }

  function receive(id, data) {
    if (typeof data === "string") {
      let message;
      try { message = JSON.parse(data); } catch { return; }

      if (message.type === "nx2-offer") {
        incoming.set(message.transferId, {
          ...message,
          peerId:id,
          chunks:[],
          received:0,
          accepted:false,
          done:false
        });

        const accept = confirm(
          `Red Nexus\n\n¿Aceptar "${message.fileName}" (${formatBytes(message.size)}) de ${peerName(id)}?`
        );

        const job = incoming.get(message.transferId);
        if (!job) return;

        job.accepted = accept;
        peers.get(id)?.dc?.send(JSON.stringify({
          type:accept ? "nx2-accept" : "nx2-reject",
          transferId:message.transferId
        }));

        status(accept ? "recibiendo…" : "transferencia rechazada");
        return;
      }

      if (message.type === "nx2-accept") {
        const job = transfers.get(message.transferId);
        if (job) streamFile(id, job);
        return;
      }

      if (message.type === "nx2-reject") {
        transfers.delete(message.transferId);
        status("transferencia rechazada");
        toast2("El destinatario rechazó el archivo.");
        return;
      }

      if (message.type === "nx2-end") {
        finishIncoming(message.transferId);
        return;
      }

      return;
    }

    if (data instanceof ArrayBuffer) {
      appendIncoming(id, data);
      return;
    }

    if (data instanceof Blob) {
      data.arrayBuffer().then(buffer => appendIncoming(id, buffer));
    }
  }

  function appendIncoming(id, chunk) {
    const job = [...incoming.values()].find(
      x => x.peerId === id && x.accepted && !x.done
    );
    if (!job) return;

    job.chunks.push(chunk);
    job.received += chunk.byteLength;
    const pct = job.size ? Math.min(100, job.received / job.size * 100) : 0;
    status(`recibiendo ${pct.toFixed(0)}%…`);
  }

  async function streamFile(id, job) {
    const dc = peers.get(id)?.dc;

    if (!dc || dc.readyState !== "open") {
      status("canal P2P no disponible");
      transfers.delete(job.id);
      return;
    }

    /* CORRECCIÓN CLAVE:
       ahora job.file existe porque sendFile() lo guardó. */
    const file = job.file;
    if (!(file instanceof File)) {
      status("error interno: archivo no disponible");
      toast2("La transferencia fue cancelada: archivo no disponible.");
      transfers.delete(job.id);
      return;
    }

    try {
      job.status = "enviando";
      const chunkSize = 64 * 1024;
      let offset = 0;

      while (offset < file.size) {
        while (dc.bufferedAmount > 4 * 1024 * 1024) {
          await sleep(25);
        }

        const end = Math.min(offset + chunkSize, file.size);
        const buffer = await file.slice(offset, end).arrayBuffer();
        dc.send(buffer);
        offset = end;
        job.sent = offset;

        const pct = file.size ? offset / file.size * 100 : 100;
        status(`enviando ${pct.toFixed(0)}%…`);
        await sleep(0);
      }

      dc.send(JSON.stringify({
        type:"nx2-end",
        transferId:job.id,
        size:file.size,
        sha256:job.sha256
      }));

      job.status = "enviado";
      toast2("✓ Archivo enviado · " + file.name);
      status("P2P directo", true);
    } catch (error) {
      console.error("[NEXUS V2] transferencia", error);
      job.status = "error";
      toast2("Error durante la transferencia.");
      status("error de transferencia");
    } finally {
      setTimeout(() => transfers.delete(job.id), 30000);
    }
  }

  async function finishIncoming(transferId) {
    const job = incoming.get(transferId);
    if (!job || job.done) return;

    try {
      const blob = new Blob(job.chunks, {
        type:job.mime || "application/octet-stream"
      });

      if (blob.size !== job.size) {
        throw new Error(`Tamaño recibido ${blob.size} ≠ esperado ${job.size}`);
      }

      status("verificando SHA-256…");
      const hash = await sha256(blob);

      if (hash.toLowerCase() !== String(job.sha256 || "").toLowerCase()) {
        throw new Error("SHA-256 no coincide");
      }

      job.done = true;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.fileName || "archivo-nexus";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 30000);

      toast2("✓ Archivo recibido y verificado");
      status("archivo verificado", true);
    } catch (error) {
      console.error("[NEXUS V2] recepción", error);
      toast2("ERROR: archivo recibido no superó la verificación.");
      status("error de integridad");
    } finally {
      incoming.delete(transferId);
    }
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return "0 B";
    const units = ["B","KB","MB","GB","TB"];
    let i = 0, value = n;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  window.NexusV2 = {
    connect,
    connectPeer,
    sendFile,
    refresh,
    disconnect() {
      manualClose = true;
      clearTimeout(reconnectTimer);
      socketGeneration++;
      try { socket?.close(); } catch {}
      socket = null;
      for (const p of peers.values()) {
        try { p.pc.close(); } catch {}
      }
      peers.clear();
      renderPresence();
      status("red desconectada");
    }
  };

  window.addEventListener("storage", () => {
    const next = localStorage.getItem("nexusToken") || null;
    if (next !== token) {
      token = next;
      refresh();
    }
  });

  async function boot() {
    await refresh();
    ensureUI();
    renderPresence(activeClass?.members || []);
  }

  setTimeout(boot, 700);

  setInterval(() => {
    ensureUI();
    if ($("network")?.classList.contains("active")) {
      renderPresence(activeClass?.members || []);
    }
  }, 2500);
})();
