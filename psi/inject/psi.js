/* PSI – vkladá sa do Steam SharedJSContext.
 * Most do Python služby: window.__psiBridge (Runtime.addBinding) → odpoveď cez window.__psiReply.
 * UI: sekcia „PSI“ v Steam → Nastavenia (klon natívnej záložky + vlastný panel). */
(function () {
  "use strict";
  const VERSION = "1.65";
  if (window.__psiLoaded === VERSION) return;
  // staršia verzia (po aktualizácii PSI) – uprac jej UI a časovače
  try { window.__psiCleanup && window.__psiCleanup(); } catch (e) {}
  window.__psiLoaded = VERSION;
  // jazyk: podľa Steamu (služba vráti "sk" / "en"), dá sa zmeniť v Nastaveniach → PSI
  let LANG = "sk";
  const tr = (sk, en) => LANG === "en" ? en : sk;

  /* ---------------- most ---------------- */
  const pending = new Map();
  let seq = 0;
  window.__psiReply = (id, r) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    r && r.ok ? p.res(r.result) : p.rej(new Error((r && r.error) || "PSI error"));
  };
  function call(method, params = {}) {
    return new Promise((res, rej) => {
      if (typeof window.__psiBridge !== "function") return rej(new Error(tr("PSI služba nie je pripojená", "PSI service not connected")));
      const id = ++seq;
      pending.set(id, {res, rej});
      window.__psiBridge(JSON.stringify({id, method, params}));
      setTimeout(() => pending.delete(id) && rej(new Error("timeout")), 60000);
    });
  }

  /* ---------------- ProtonDB medaila (zdieľaná s Companion) ---------------- */
  const TIERS = {
    native: {c1: "#4ade80", c2: "#15803d", label: "Native"},
    platinum: {c1: "#e5edf7", c2: "#8fa3bf", label: "Platinum"},
    gold: {c1: "#fde68a", c2: "#c99a1c", label: "Gold"},
    silver: {c1: "#e5e7eb", c2: "#9ca3af", label: "Silver"},
    bronze: {c1: "#f4b27a", c2: "#a0522d", label: "Bronze"},
    borked: {c1: "#fca5a5", c2: "#b91c1c", label: "Borked"},
    pending: {c1: "#6b7280", c2: "#374151", label: "Pending"},
  };
  let medalSeq = 0;
  function medal(tier, size = 34) {
    const t = TIERS[tier] || TIERS.pending, id = "psim" + (++medalSeq);
    const glyph = tier === "borked" ? '<path d="M15 19l6 6M21 19l-6 6" stroke="#5b0d0d" stroke-width="2.4" stroke-linecap="round"/>'
      : tier === "pending" ? '<text x="18" y="26.5" text-anchor="middle" font-size="11" font-weight="700" fill="#d1d5db" font-family="sans-serif">?</text>'
      : '<path d="M18 15.6l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="rgba(255,255,255,.85)"/>';
    return `<svg width="${size}" height="${size * 1.22}" viewBox="0 0 36 44"><title>ProtonDB: ${t.label}</title>
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient></defs>
      <path d="M9 0h7l3 9-6 4zM27 0h-7l-3 9 6 4z" fill="#22d3ee" opacity=".9"/><path d="M16 0h4l-2 8z" fill="#8b5cf6"/>
      <circle cx="18" cy="23" r="13" fill="url(#${id})" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/>
      <circle cx="18" cy="23" r="9.6" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1"/>${glyph}</svg>`;
  }
  window.PSI = {call, medal, TIERS};

  /* ---------------- pomocné ---------------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const fmtH = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h} h ${mm} min` : `${mm} min`; };
  function openUrl(url) {
    try { if (window.SteamClient && SteamClient.System && SteamClient.System.OpenInSystemBrowser) return SteamClient.System.OpenInSystemBrowser(url); } catch (e) {}
    window.open(url, "_blank");
  }
  function qrSvg(matrix, px = 4) {
    if (!matrix || !matrix.length) return "";
    const n = matrix.length, q = 4, size = (n + 2 * q) * px;
    let d = "";
    matrix.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === "1") d += `M${(x + q) * px} ${(y + q) * px}h${px}v${px}h-${px}z`; });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" rx="10" fill="#fff"/><path d="${d}" fill="#0b1226"/></svg>`;
  }

  const PSI_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none"><path d="M18 5v26M10.5 8v7.5a7.5 7.5 0 0 0 15 0V8M13 31h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

  const CSS = `
  #psi-settings{--c:var(--psi-accent,#1a9fff);--v:var(--psi-accent,#1a9fff)}
  #psi-settings .DialogBody{overflow:visible}
  #psi-settings .psi-card{position:relative;flex:none;margin:0 0 16px;padding:16px 18px;border-radius:8px;
    background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
  #psi-settings .psi-h{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--psi-mut,#8f98a0);margin-bottom:8px}
  #psi-settings .psi-big{font-size:40px;font-weight:600;line-height:1;color:var(--psi-text,#fff)}
  #psi-settings .psi-mut{color:var(--psi-mut,#8f98a0);font-size:13px}
  #psi-settings .psi-row{display:flex;gap:18px;align-items:flex-end}
  #psi-settings .psi-chart{flex:1;display:flex;gap:6px;align-items:flex-end;height:72px}
  #psi-settings .psi-bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end}
  #psi-settings .psi-bar i{display:block;width:100%;max-width:26px;border-radius:5px 5px 3px 3px;background:var(--c)}
  #psi-settings .psi-bar i.z{background:rgba(255,255,255,.08);box-shadow:none}
  #psi-settings .psi-bar span{font-size:11px;color:var(--psi-mut,#8f98a0)}
  #psi-settings .psi-gow{display:flex;gap:12px;align-items:center;margin-top:14px}
  #psi-settings .psi-gow img{width:150px;border-radius:8px}
  #psi-settings .psi-comp{display:flex;gap:20px;align-items:center}
  #psi-settings .psi-url{font-family:monospace;font-size:14px;color:var(--c);user-select:text}
  #psi-settings .psi-pin{font-size:30px;font-weight:700;letter-spacing:.14em;color:var(--psi-text,#fff);font-family:monospace}
  #psi-settings .psi-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;margin-bottom:12px}
  #psi-settings .psi-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  #psi-settings .psi-btns .DialogButton{width:auto;min-width:150px;padding:0 16px}
  #psi-settings .psi-feat{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)}
  #psi-settings .psi-feat:last-child{border-bottom:0}
  #psi-settings .psi-feat b{display:block;color:var(--psi-text,#fff);font-weight:500}
  #psi-settings .psi-sw{flex:none;position:relative;width:46px;height:24px;border-radius:99px;background:#3a4157;cursor:pointer;transition:background .2s}
  #psi-settings .psi-sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#dfe3f0;transition:transform .2s}
  #psi-settings .psi-sw.on{background:var(--c)}
  #psi-settings .psi-sw.on::after{transform:translateX(22px);background:#fff}
  #psi-settings .psi-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  #psi-settings .psi-badges span{padding:4px 10px;border-radius:99px;background:color-mix(in srgb,var(--psi-accent,#1a9fff) 16%,transparent);border:0;font-size:12px}
  #psi-settings .psi-err{color:#f87171}
  #psi-settings .psi-trow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0}
  #psi-settings .psi-trow input[type=color]{width:38px;height:28px;border:0;border-radius:8px;background:none;padding:0;cursor:pointer}
  #psi-settings .psi-trow input[type=range]{width:150px;accent-color:var(--psi-accent,#1a9fff)}
  #psi-settings .psi-trow b{min-width:48px;text-align:right;color:var(--psi-text,#fff);font-weight:500}
  #psi-settings .psi-hex{width:78px;height:28px;border-radius:8px;border:0;background:#32353c;color:var(--psi-text,#fff);padding:0 8px;font-family:monospace}
  #psi-settings .psi-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:99px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.05);color:var(--psi-text2,#dcdedf);cursor:pointer;font-size:12.5px}
  #psi-settings .psi-chip:hover{background:rgba(255,255,255,.1)}
  #psi-settings .psi-chip i{width:12px;height:12px;border-radius:50%}
  #psi-settings .psi-prev{--a:#1a9fff;--p:rgba(18,28,44,.62);--b:10px;--r:12px;position:relative;width:330px;height:236px;overflow:hidden;border-radius:14px;background:#14202e}
  #psi-settings .pv-blob{position:absolute;width:150px;height:150px;border-radius:50%;filter:blur(8px);opacity:.85}
  #psi-settings .pv-bar{position:absolute;left:10px;right:10px;top:10px;height:26px;display:flex;gap:14px;align-items:center;padding:0 12px;font-size:10px;letter-spacing:.06em;color:#c7d5e0;
    background:var(--p);backdrop-filter:blur(var(--b));border-radius:var(--r)}
  #psi-settings .pv-bar .pv-on{color:var(--a)}
  #psi-settings .pv-side{position:absolute;left:10px;top:44px;bottom:10px;width:84px;padding:6px;background:var(--p);backdrop-filter:blur(var(--b));border-radius:var(--r)}
  #psi-settings .pv-item{font-size:10px;color:#c7d5e0;padding:5px 6px;border-radius:calc(var(--r) / 2)}
  #psi-settings .pv-sel{background:rgba(255,255,255,.12);color:var(--psi-text,#fff)}
  #psi-settings .pv-win{position:absolute;left:102px;right:10px;top:44px;bottom:10px;padding:8px;background:var(--p);backdrop-filter:blur(var(--b));border-radius:var(--r);overflow:hidden}
  #psi-settings .pv-hero{height:52px;border-radius:calc(var(--r) * .7);background:linear-gradient(120deg,#3b5b7a,#b0613d);-webkit-mask-image:linear-gradient(#000 50%,transparent)}
  #psi-settings .pv-row{display:flex;gap:10px;align-items:center;margin:6px 0;font-size:8.5px;color:var(--psi-mut,#8f98a0)}
  #psi-settings .pv-row b{color:var(--psi-text,#fff);font-size:10px}
  #psi-settings .pv-play{border:0;background:var(--a);color:var(--psi-text,#fff);font-size:10px;padding:5px 10px;border-radius:calc(var(--r) * .6)}
  #psi-settings .pv-card{display:flex;flex-direction:column;gap:3px;padding:7px 8px;font-size:9px;color:var(--psi-text2,#c6d4df);background:rgba(255,255,255,.05);border-radius:calc(var(--r) * .7)}
  #psi-settings .pv-card b{font-size:9px;letter-spacing:.06em;color:var(--psi-text,#fff)}
  #psi-settings .pv-card em{font-style:normal;color:var(--a);font-size:12px}`;

  const PRESETS = [
    {name: "Steam", accent: "#1a9fff", panel: "#121c2c", opacity: 0.62, blur: 10, radius: 12},
    {name: "Fialová noc", en: "Violet night", accent: "#8b5cf6", panel: "#1a1430", opacity: 0.55, blur: 14, radius: 16},
    {name: "Cyan sklo", en: "Cyan glass", accent: "#22d3ee", panel: "#0b1a26", opacity: 0.42, blur: 18, radius: 18},
    {name: "Ružová", en: "Pink", accent: "#ec4899", panel: "#1f1020", opacity: 0.55, blur: 12, radius: 14},
    {name: "Zelená", en: "Green", accent: "#22c55e", panel: "#0f1d16", opacity: 0.6, blur: 10, radius: 12},
    {name: "OLED čierna", en: "OLED black", accent: "#3b82f6", panel: "#000000", opacity: 0.88, blur: 0, radius: 10},
  ];

  /* ---------------- sekcia v Nastaveniach ---------------- */
  const FEATURES = () => [
    ["auto_update", tr("Automatické aktualizácie", "Automatic updates"), tr("Raz za 6 hodín skontroluje GitHub a novú verziu PSI nainštaluje sama (dostaneš notifikáciu).", "Checks GitHub every 6 hours and installs a new PSI version by itself (you get a notification).")],
    ["rounded", tr("Vzhľad PSI", "PSI look"), tr("Zaoblené rohy v celom Steame, karta v obchode a plynulo miznúci obrázok hry v knižnici.", "Rounded corners across Steam, a card on store pages and game art that fades out in the library.")],
    ["collections", tr("Kolekcie v knižnici", "Library collections"), tr("Kolekcie Gold, Natívne Linux, Online nepôjde (anti-cheat)… Aktualizujú sa samy. Vypnutím sa odstránia.", "Collections like Gold, Native Linux, Online blocked (anti-cheat)… They update by themselves and are removed when you turn this off.")],
    ["notify", tr("Upozornenia na zľavy", "Sale alerts"), tr("Notifikácia v KDE, keď hra z wishlistu zľavní alebo je na historickom minime.", "A KDE notification when a wishlisted game goes on sale or hits its all-time low.")],
    ["buy_warning", tr("Varovanie pred kúpou", "Buy warning"), tr("Ak hra na Linuxe nepôjde (Borked alebo zablokovaný anti-cheat), obchod ťa upozorní pred pridaním do košíka.", "If a game won't run on Linux (Borked or a blocking anti-cheat), the store warns you before you add it to the cart.")],
    ["library", tr("ProtonDB v knižnici", "ProtonDB in the library"), tr("Pri každej hre v knižnici: medaila ProtonDB (Platinum, Gold…) alebo „Natívne“, ak má hra Linux verziu.", "Next to every game: its ProtonDB medal (Platinum, Gold…) or “Native” if it has a Linux build.")],
    ["store", tr("ProtonDB a zľavy v obchode", "ProtonDB and prices in the store"), tr("Na stránke hry: medaila, odpočet konca zľavy, odhad zľavy a odporúčanie kúp/počkaj.", "On game pages: the medal, sale countdown, expected discount and a buy / wait hint.")],
    ["community", tr("Vitrína „Môj týždeň“", "“My week” showcase"), tr("Na tvojom Steam profile: hodiny, hra týždňa a odznaky. Vidíš ju len ty.", "On your Steam profile: hours played, game of the week and badges. Only you can see it.")],
    ["dock_icons", tr("Ikony hier v doku", "Game icons in the dock"), tr("Spustená hra má v doku a paneli úloh svoju ikonu namiesto prázdnej. Pre všetky nainštalované hry, v menu aplikácií sa neukážu.", "A running game shows its own icon in the dock and taskbar instead of a blank one. For every installed game; they don't appear in the app menu.")],
    ["companion_lan", tr("Companion pre mobil", "Companion for your phone"), tr("Prístup z telefónu v domácej Wi-Fi. Na tomto PC beží Companion vždy.", "Access from your phone on home Wi-Fi. On this PC the Companion always runs.")],
  ];

  function attachSettings(doc) {
    const list = doc.querySelector('.PageListColumn [role="tablist"]');
    if (!list || list.querySelector("#psi-tab")) return;
    const tabs = [...list.querySelectorAll(':scope > [role="tab"]')];
    if (tabs.length < 2) return;
    const sel = tabs.find(t => t.getAttribute("aria-selected") === "true");
    const plain = tabs.find(t => t !== sel) || tabs[0];
    // trieda „vybraná záložka“ = rozdiel medzi vybranou a ostatnými (zisťuje sa pri otvorení)
    let selCls = [];
    const learnSel = () => {
      if (selCls.length) return;
      const native = [...list.querySelectorAll(':scope > [role="tab"]:not(#psi-tab)')];
      const cur = native.find(t => t.getAttribute("aria-selected") === "true");
      const other = native.find(t => t !== cur);
      if (cur && other) selCls = [...cur.classList].filter(c => !other.classList.contains(c));
    };

    if (!doc.getElementById("psi-style")) {
      const st = doc.createElement("style"); st.id = "psi-style"; st.textContent = CSS; doc.head.appendChild(st);
    }
    const sepSrc = list.querySelector('[role="separator"]');
    if (sepSrc) { const sep = sepSrc.cloneNode(true); sep.id = "psi-sep"; list.appendChild(sep); }
    const tab = plain.cloneNode(true);
    tab.id = "psi-tab";
    tab.setAttribute("aria-selected", "false");
    tab.removeAttribute("aria-controls");
    tab.querySelectorAll("[id]").forEach(e => { e.removeAttribute("id"); e.removeAttribute("aria-controls"); e.removeAttribute("aria-selected"); e.removeAttribute("role"); });
    const [icon, label] = tab.children;
    if (icon) icon.innerHTML = PSI_ICON;
    if (label) label.textContent = "PSI";
    list.appendChild(tab);

    const state = {open: false, hidden: [], observer: null};
    const content = () => doc.querySelector(".DialogContentTransition");

    function open() {
      const box = content();
      if (!box) return;
      learnSel();
      state.open = true;
      list.querySelectorAll('[role="tab"]').forEach(t => selCls.forEach(c => t.classList.remove(c)));
      selCls.forEach(c => tab.classList.add(c));
      tab.setAttribute("aria-selected", "true");
      const hideOthers = () => [...box.children].forEach(ch => {
        if (ch.id !== "psi-settings" && ch.style.display !== "none") { ch.style.display = "none"; state.hidden.push(ch); }
      });
      hideOthers();
      let panel = doc.getElementById("psi-settings");
      if (!panel) {
        panel = doc.createElement("div");
        panel.id = "psi-settings";
        panel.className = "DialogContent _DialogLayout";
        panel.setAttribute("role", "tabpanel");
        panel.innerHTML = `<div class="DialogContent_InnerWidth"><div class="DialogHeader">PSI</div><div class="DialogBody" id="psi-body"><div class="psi-mut">${tr("Načítavam…", "Loading…")}</div></div></div>`;
        box.appendChild(panel);
      }
      state.observer = new MutationObserver(() => state.open && hideOthers());
      state.observer.observe(box, {childList: true});
      render(doc);
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      state.observer && state.observer.disconnect();
      const panel = doc.getElementById("psi-settings");
      panel && panel.remove();
      state.hidden.forEach(ch => { ch.style.display = ""; });
      state.hidden = [];
      selCls.forEach(c => tab.classList.remove(c));
      tab.setAttribute("aria-selected", "false");
      const cur = list.querySelector('[role="tab"][aria-selected="true"]:not(#psi-tab)');
      cur && selCls.forEach(c => cur.classList.add(c));
    }

    tab.addEventListener("click", e => { e.stopPropagation(); open(); });
    list.addEventListener("click", e => {
      const t = e.target.closest('[role="tab"]');
      if (t && t !== tab && !tab.contains(t)) close();
    }, true);
  }

  async function render(doc) {
    try { await renderInner(doc); }
    catch (e) {
      const body = doc.getElementById("psi-body");
      if (body) body.innerHTML = `<div class="psi-card psi-err">${tr("Chyba PSI", "PSI error")}: ${esc(e && e.message)}</div>`;
      console.error("PSI render", e);
    }
  }
  window.__psiRenderSettings = render;
  async function renderInner(doc) {
    const body = doc.getElementById("psi-body");
    if (!body) return;
    let c, q, f, fonts, theme, mill, custom;
    try {
      [c, q, f, fonts, theme, mill, custom] = await Promise.all([call("companion_info"), call("companion_qr"), call("features"), call("fonts"), call("theme"),
        call("millennium").catch(() => ({themes: [], current: ""})), call("custom_css").catch(() => ({css: ""}))]);
    } catch (e) {
      body.innerHTML = `<div class="psi-card psi-err">${tr("PSI služba neodpovedá", "The PSI service isn't responding")}: ${esc(e.message)}<br><span class="psi-mut">${tr("Skontroluj", "Check")}: systemctl --user status psi</span></div>`;
      return;
    }
    body.innerHTML = `
      <div class="psi-card">
        <div class="psi-h">${tr("Funkcie", "Features")}</div>
        <div class="psi-feat"><div><b>${tr("Jazyk PSI", "PSI language")}</b><span class="psi-mut">${tr("Podľa Steamu = rovnaký jazyk ako zvyšok klienta (Steam nemá slovenčinu, takže angličtina).", "Match Steam = the same language as the rest of the client.")}</span></div>
          <select id="psi-lang" style="height:32px;padding:0 10px;background:var(--psi-ctl,#32353c);color:var(--psi-text,#fff);border:0;border-radius:8px;font-size:14px">
            ${[["auto", tr("Podľa Steamu", "Match Steam")], ["sk", "Slovenčina"], ["en", "English"]].map(([v, l]) => `<option value="${v}" ${(f.lang_setting || "auto") === v ? "selected" : ""}>${l}</option>`).join("")}
          </select></div>
        ${FEATURES().map(([k, name, desc]) => `<div class="psi-feat"><div><b>${esc(name)}</b><span class="psi-mut">${esc(desc)}</span></div><div class="psi-sw ${f[k] ? "on" : ""}" data-f="${k}" role="switch" aria-checked="${!!f[k]}"></div></div>`).join("")}
      </div>


      <div class="psi-card">
        <div class="psi-h">${tr("Vzhľad · vlastná téma", "Look · custom theme")}</div>
        <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:250px" id="psi-tform">
            ${[["accent", tr("Akcentová farba", "Accent colour")], ["panel", tr("Farba panelov", "Panel colour")]].map(([k, l]) => `
              <div class="psi-trow"><span>${l}</span>
                <span style="display:flex;gap:8px;align-items:center"><input type="color" data-t="${k}" value="${esc(theme[k])}">
                <input type="text" data-hex="${k}" value="${esc(theme[k])}" maxlength="7" class="psi-hex"></span></div>`).join("")}
            ${[["opacity", tr("Priehľadnosť panelov", "Panel transparency"), 0.1, 1, 0.02, v => Math.round((1 - v) * 100) + " %"], ["blur", tr("Rozmazanie (sklo)", "Blur (glass)"), 0, 30, 1, v => v + " px"],
               ["radius", tr("Zaoblenie rohov", "Corner radius"), 0, 28, 1, v => v + " px"]].map(([k, l, mn, mx, st, f]) => `
              <div class="psi-trow"><span>${l}</span><span style="display:flex;gap:10px;align-items:center">
                <input type="range" data-t="${k}" min="${mn}" max="${mx}" step="${st}" value="${theme[k]}"><b data-v="${k}">${f(+theme[k])}</b></span></div>`).join("")}
            <div class="psi-h" style="margin-top:12px">${tr("Predvoľby", "Presets")}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap" id="psi-presets">
              ${PRESETS.map((p, i) => `<button type="button" class="psi-chip" data-p="${i}"><i style="background:${p.accent}"></i>${esc(tr(p.name, p.en || p.name))}</button>`).join("")}
            </div>
            <div class="psi-btns">
              <button type="button" class="DialogButton _DialogLayout Primary Focusable" id="psi-t-save">${tr("Použiť", "Apply")}</button>
              <button type="button" class="DialogButton _DialogLayout Secondary Focusable" id="psi-t-reset">${tr("Predvolené", "Default")}</button>
            </div>
            <div class="psi-mut" id="psi-t-msg" style="margin-top:6px">${tr("Náhľad sa mení hneď, do Steamu sa uloží tlačidlom Použiť.", "The preview updates live; Apply saves it to Steam.")}</div>
          </div>
          <div>
            <div class="psi-mut" style="margin-bottom:6px">${tr("Náhľad okien", "Preview")}</div>
            <div id="psi-prev" class="psi-prev">
              <i class="pv-blob" style="left:-30px;top:-20px;background:#ff7a59"></i><i class="pv-blob" style="right:-40px;top:40px;background:#7c3aed"></i>
              <i class="pv-blob" style="left:90px;bottom:-60px;background:#22d3ee"></i>
              <div class="pv-bar"><span>STORE</span><span class="pv-on">LIBRARY</span><span>COMMUNITY</span></div>
              <div class="pv-win">
                <div class="pv-hero"></div>
                <div class="pv-row"><button class="pv-play">▶ ${tr("Hrať", "Play")}</button><span>PROTONDB<br><b>Gold</b></span><span>${tr("ČAS HRANIA", "PLAY TIME")}<br><b>35 h</b></span></div>
                <div class="pv-card"><b>${tr("O HRE", "ABOUT")}</b><span>${tr("Beží perfektne po menšej úprave…", "Runs perfectly after a small tweak…")}</span><em>70–90 FPS</em></div>
              </div>
              <div class="pv-side"><div class="pv-item pv-sel">Elden Ring</div><div class="pv-item">Rust</div><div class="pv-item">Terraria</div></div>
            </div>
          </div>
        </div>
      </div>



      <div class="psi-card">
        <div class="psi-h">${tr("Vlastné CSS", "Custom CSS")}</div>
        <textarea id="psi-css" spellcheck="false" placeholder="/* ${tr("napr.", "e.g.")} */&#10;.DialogButton { border-radius: 20px !important; }&#10;body { letter-spacing: .2px; }"
          style="width:100%;min-height:150px;box-sizing:border-box;border:0;border-radius:10px;background:#0f141c;color:var(--psi-text2,#d6e2ff);padding:10px 12px;font:13px/1.5 monospace;resize:vertical">${esc(custom.css || "")}</textarea>
        <div class="psi-btns">
          <button type="button" class="DialogButton _DialogLayout Primary Focusable" id="psi-css-save">${tr("Použiť", "Apply")}</button>
          <button type="button" class="DialogButton _DialogLayout Secondary Focusable" id="psi-css-clear">${tr("Vymazať", "Clear")}</button>
        </div>
        <div class="psi-mut" id="psi-css-msg" style="margin-top:6px">${tr("Platí v celom Steame (klient aj obchod) a má prednosť pred PSI aj Millennium témou.", "Applies to all of Steam (client and store) and wins over PSI and Millennium styles.")}</div>
      </div>

      <div class="psi-card">
        <div class="psi-h">${tr("Millennium témy", "Millennium themes")} (steambrew.app)</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select id="psi-mill-sel" style="min-width:260px;height:34px;padding:0 10px;background:#32353c;color:var(--psi-text,#fff);border:0;border-radius:8px;font-size:14px">
            <option value="">${tr("Žiadna (len PSI vzhľad)", "None (PSI look only)")}</option>
            ${mill.themes.map(t => `<option value="${esc(t.id)}" ${t.id === mill.current ? "selected" : ""}>${esc(t.name)}${t.author ? " · " + esc(t.author) : ""}</option>`).join("")}
          </select>
          <button type="button" class="DialogButton _DialogLayout Secondary Focusable" id="psi-mill-open" style="width:auto;padding:0 16px">${tr("Otvoriť priečinok", "Open folder")}</button>
          <button type="button" class="DialogButton _DialogLayout Secondary Focusable" id="psi-mill-web" style="width:auto;padding:0 16px">${tr("Prehliadať témy", "Browse themes")}</button>
        </div>
        ${mill.current && mill.options && Object.keys(mill.options).length ? `<div class="psi-h" style="margin-top:14px">${tr("Voľby témy", "Theme options")}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px 16px">
          ${Object.entries(mill.options).map(([k, o]) => `<label title="${esc(o.description)}" style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--psi-mut,#8f98a0)">${esc(k)}
            <select data-mopt="${esc(k)}" style="height:30px;padding:0 8px;background:var(--psi-ctl,#32353c);color:var(--psi-text,#fff);border:0;border-radius:8px;font-size:13px">
            ${o.values.map(v => `<option value="${esc(v)}" ${v === o.value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`).join("")}
          </div>` : ""}
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
          <input id="psi-mill-url" type="text" placeholder="https://github.com/${tr("autor/tema", "author/theme")}" style="flex:1;height:34px;border:0;border-radius:8px;background:#32353c;color:var(--psi-text,#fff);padding:0 10px;font-size:14px">
          <button type="button" class="DialogButton _DialogLayout Primary Focusable" id="psi-mill-inst" style="width:auto;padding:0 16px">${tr("Inštalovať", "Install")}</button>
        </div>
        <div class="psi-mut" id="psi-mill-msg" style="margin-top:8px">${tr("Použije sa len CSS z témy – JavaScript z cudzích tém PSI nespúšťa. Ak sa štýly bijú s PSI, vypni „Vzhľad PSI“.", "Only the theme's CSS is used – PSI never runs JavaScript from themes. If styles clash, turn off “PSI look”.")}</div>
      </div>

      <div class="psi-card">
        <div class="psi-h">${tr("Písmo", "Font")}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select id="psi-font-sel" class="DialogDropDown" style="min-width:260px;height:34px;padding:0 10px;background:#32353c;color:var(--psi-text,#fff);border:0;border-radius:8px;font-size:14px">
            <option value="">${tr("Predvolené", "Default")} (Motiva Sans)</option>
            ${fonts.custom ? `<option value="${esc(fonts.current)}" selected>${esc(fonts.current)} (${tr("nahrané", "uploaded")})</option>` : ""}
            ${fonts.system.map(n => `<option value="${esc(n)}" ${!fonts.custom && n === fonts.current ? "selected" : ""} style="font-family:'${esc(n)}'">${esc(n)}</option>`).join("")}
          </select>
          <button type="button" class="DialogButton _DialogLayout Secondary Focusable" id="psi-font-up" style="width:auto;padding:0 16px">${tr("Nahrať písmo…", "Upload font…")}</button>
          <input type="file" id="psi-font-file" accept=".ttf,.otf,.woff,.woff2" style="display:none">
        </div>
        <div id="psi-font-msg" class="psi-mut" style="margin-top:8px">${tr("Platí pre celý Steam – knižnicu, Nastavenia aj obchod. Podporované .ttf, .otf, .woff, .woff2 (max 8 MB).", "Applies to all of Steam – library, Settings and store. Supports .ttf, .otf, .woff, .woff2 (max 8 MB).")}</div>
        <div style="margin-top:10px;font-size:18px;color:var(--psi-text,#fff)" id="psi-font-prev">${tr("Príliš žltučký kôň úpel ďábelské ódy", "The quick brown fox jumps over the lazy dog")} – 0123456789</div>
      </div>

      <div class="psi-card">
        <div class="psi-h">PSI Companion · ${tr("týždeň a wishlist na telefóne", "your week and wishlist on your phone")}</div>
        <div class="psi-comp">
          ${q.matrix && q.matrix.length && f.companion_lan ? `<div>${qrSvg(q.matrix, 4)}</div>` : ""}
          <div style="flex:1">
            <div class="psi-kv">
              <span class="psi-mut">${tr("Na tomto PC", "This PC")}</span><span class="psi-url">${esc(c.local_url || tr("nebeží", "not running"))}</span>
              <span class="psi-mut">${tr("Mobil", "Phone")}</span><span class="psi-url">${f.companion_lan ? esc(c.url || tr("žiadna sieť", "no network")) : tr("vypnuté", "off")}</span>
            </div>
            <div class="psi-mut">PIN</div>
            <div class="psi-pin" id="psi-pin">${esc(c.pin.slice(0, 3))} ${esc(c.pin.slice(3))}</div>
            <div class="psi-btns">
              <button type="button" class="DialogButton _DialogLayout Primary Focusable" id="psi-open">${tr("Otvoriť na PC", "Open on this PC")}</button>
              <button type="button" class="DialogButton _DialogLayout Secondary Focusable" id="psi-newpin">${tr("Nový PIN", "New PIN")}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="psi-mut">${tr("PSI beží len na tomto PC · dáta sú v", "PSI runs only on this PC · data lives in")} ~/.local/share/psi</div>`;

    /* ---- vlastné CSS ---- */
    const cmsg = body.querySelector("#psi-css-msg"), cta = body.querySelector("#psi-css");
    const saveCss = async css => {
      try { await call("set_custom_css", {css}); CUSTOM_CSS = css; scan(); cmsg.textContent = css ? tr("Vlastné CSS použité v celom Steame.", "Custom CSS applied to all of Steam.") : tr("Vlastné CSS vymazané.", "Custom CSS cleared."); }
      catch (e) { cmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
    };
    body.querySelector("#psi-css-save").addEventListener("click", () => saveCss(cta.value));
    body.querySelector("#psi-css-clear").addEventListener("click", () => { cta.value = ""; saveCss(""); });
    cta.addEventListener("keydown", e => { if (e.key === "Tab") { e.preventDefault(); const p = cta.selectionStart; cta.setRangeText("  ", p, cta.selectionEnd, "end"); } e.stopPropagation(); });

    /* ---- Millennium ---- */
    const mmsg = body.querySelector("#psi-mill-msg");
    body.querySelector("#psi-mill-sel").addEventListener("change", async ev => {
      try { await call("millennium_set", {id: ev.target.value}); await refreshMillennium(); scan(); render(doc); }
      catch (e) { mmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
    });
    body.querySelectorAll("[data-mopt]").forEach(sel => sel.addEventListener("change", async () => {
      try { await call("millennium_option", {name: sel.dataset.mopt, value: sel.value}); await refreshMillennium(); scan(); mmsg.textContent = tr("Voľba uložená.", "Option saved."); }
      catch (e) { mmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
    }));
    body.querySelector("#psi-mill-open").addEventListener("click", () => call("millennium_open").catch(() => {}));
    body.querySelector("#psi-mill-web").addEventListener("click", () => openUrl("https://steambrew.app/themes"));
    body.querySelector("#psi-mill-inst").addEventListener("click", async () => {
      const url = body.querySelector("#psi-mill-url").value.trim();
      if (!url) return;
      mmsg.textContent = tr("Sťahujem tému…", "Downloading theme…");
      try { const r = await call("millennium_install", {url}); mmsg.textContent = tr(`Nainštalované: ${r.installed.name}. Vyber ju v zozname.`, `Installed: ${r.installed.name}. Pick it in the list.`); render(doc); }
      catch (e) { mmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
    });

    /* ---- editor témy ---- */
    const tcur = {...theme};
    const fmt = {opacity: v => Math.round((1 - v) * 100) + " %", blur: v => v + " px", radius: v => v + " px"};
    const prev = body.querySelector("#psi-prev");
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0).join(",");
    const paint = () => {
      const P = `rgba(${rgb(tcur.panel)},${tcur.opacity})`;
      prev.style.setProperty("--a", tcur.accent); prev.style.setProperty("--p", P);
      prev.style.setProperty("--b", tcur.blur + "px"); prev.style.setProperty("--r", tcur.radius + "px");
      body.querySelectorAll("[data-t]").forEach(i => { i.value = tcur[i.dataset.t]; });
      body.querySelectorAll("[data-hex]").forEach(i => { if (doc.activeElement !== i) i.value = tcur[i.dataset.hex]; });
      body.querySelectorAll("[data-v]").forEach(b => { b.textContent = fmt[b.dataset.v](+tcur[b.dataset.v]); });
    };
    body.querySelectorAll("[data-t]").forEach(i => i.addEventListener("input", () => {
      tcur[i.dataset.t] = i.type === "range" ? +i.value : i.value; paint();
    }));
    body.querySelectorAll("[data-hex]").forEach(i => i.addEventListener("input", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(i.value)) { tcur[i.dataset.hex] = i.value.toLowerCase(); paint(); }
    }));
    body.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => { const {name, ...t} = PRESETS[+b.dataset.p]; Object.assign(tcur, t); paint(); }));
    const tmsg = body.querySelector("#psi-t-msg");
    const saveTheme = async t => {
      try {
        const saved = await call("set_theme", {theme: t});
        Object.assign(tcur, saved); setTheme(saved); scan(); paint();
        tmsg.textContent = tr("Téma použitá v celom Steame.", "Theme applied to all of Steam.");
      } catch (e) { tmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
    };
    body.querySelector("#psi-t-save").addEventListener("click", () => saveTheme(tcur));
    body.querySelector("#psi-t-reset").addEventListener("click", () => { const {name, ...t} = PRESETS[0]; Object.assign(tcur, t); saveTheme(tcur); });
    paint();

    const fsel = body.querySelector("#psi-font-sel"), fmsg = body.querySelector("#psi-font-msg"), fprev = body.querySelector("#psi-font-prev");
    fprev.style.fontFamily = fsel.value ? `"${fsel.value}"` : "";
    fsel.addEventListener("change", async () => {
      fprev.style.fontFamily = fsel.value ? `"${fsel.value}"` : "";
      try { await call("set_font", {family: fsel.value}); FONT.key = null; await refreshFont(); scan(); fmsg.textContent = fsel.value ? tr(`Písmo „${fsel.value}“ nastavené.`, `Font “${fsel.value}” set.`) : tr("Vrátené predvolené písmo.", "Default font restored."); }
      catch (e) { fmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
    });
    const ffile = body.querySelector("#psi-font-file");
    body.querySelector("#psi-font-up").addEventListener("click", () => ffile.click());
    ffile.addEventListener("change", () => {
      const file = ffile.files && ffile.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { fmsg.textContent = tr("Súbor je väčší ako 8 MB.", "The file is larger than 8 MB."); return; }
      const rd = new (doc.defaultView.FileReader)();
      rd.onload = async () => {
        try {
          const b64 = String(rd.result).split(",")[1] || "";
          await call("upload_font", {name: file.name, data: b64});
          FONT.key = null; await refreshFont(); scan();
          render(doc);
        } catch (e) { fmsg.textContent = tr("Chyba: ", "Error: ") + e.message; }
      };
      rd.readAsDataURL(file);
    });
    body.querySelector("#psi-open").addEventListener("click", () => c.local_url && openUrl(c.local_url));
    const np = body.querySelector("#psi-newpin");
    np.addEventListener("click", async () => {
      if (np.dataset.confirm !== "1") { np.dataset.confirm = "1"; np.textContent = tr("Naozaj? Odhlási telefóny", "Sure? Signs out phones"); setTimeout(() => { np.dataset.confirm = ""; np.textContent = tr("Nový PIN", "New PIN"); }, 4000); return; }
      np.disabled = true;
      try { await call("new_pin"); } catch (e) {}
      render(doc);
    });
    body.querySelector("#psi-lang").addEventListener("change", async ev => {
      try { const nf = await call("set_language", {value: ev.target.value}); setLang(nf.lang); render(doc); } catch (e) {}
    });
    body.querySelectorAll(".psi-sw").forEach(sw => sw.addEventListener("click", async () => {
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on);
      try { await call("set_feature", {name: sw.dataset.f, value: on}); } catch (e) { sw.classList.toggle("on", !on); }
      if (sw.dataset.f === "collections") { await refreshFeatures(); on ? syncCollections(true) : removeCollections(); }
      if (sw.dataset.f === "companion_lan") setTimeout(() => render(doc), 800);
    }));
  }

  /* ---------------- karta ProtonDB (rovnaká v knižnici aj v obchode) ---------------- */
  const TIER_BAND = {native: ["#008000", "#fff", "NATIVE"], platinum: ["#b4c7dc", "#14161b", "PLATINUM"], gold: ["#cfb53b", "#14161b", "GOLD"],
    silver: ["#a6a6a6", "#14161b", "SILVER"], bronze: ["#cd7f32", "#14161b", "BRONZE"], borked: ["#e02424", "#fff", "BORKED"], pending: ["#444b5e", "#dfe3ee", "PENDING"]};
  const DECK_INFO = () => ({3: ["#59bf40", "M11 18.5l4.5 4.5 9-10", tr("Steam Deck: overené", "Steam Deck: Verified")], 2: ["#ffc82c", "M18 16v8M18 11.5v.5", tr("Steam Deck: hrateľné", "Steam Deck: Playable")],
    1: ["#8b929a", "M11 25L25 11", tr("Steam Deck: nepodporované", "Steam Deck: Unsupported")], 0: ["#8b929a", "M14.5 14a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5M18 24.5v.5", tr("Steam Deck: neznáme", "Steam Deck: Unknown")]});
  function deckIcon(cat, s = 30) {
    const di = DECK_INFO(), [c, path, t] = di[cat] || di[0];
    return `<svg width="${s}" height="${s}" viewBox="0 0 36 36"><title>${t}</title><circle cx="18" cy="18" r="15" fill="none" stroke="${c}" stroke-width="2.6"/><path d="${path}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function tuxIcon(native, s = 30) {
    const c = native ? "#22c55e" : "#5b6170";
    return `<svg width="${s}" height="${s}" viewBox="0 0 36 36"><title>${native ? tr("Natívna Linux verzia", "Native Linux version") : tr("Bez natívnej Linux verzie (beží cez Proton)", "No native Linux version (runs through Proton)")}</title>
      <rect x="1.5" y="1.5" width="33" height="33" rx="7" fill="${native ? "rgba(34,197,94,.15)" : "none"}" stroke="${c}" stroke-width="2.4"/>
      <ellipse cx="18" cy="20" rx="7.5" ry="10" fill="${c}"/><ellipse cx="18" cy="22.5" rx="4.6" ry="6.6" fill="#f3f4f6"/>
      <circle cx="15.6" cy="13.5" r="1.3" fill="#111"/><circle cx="20.4" cy="13.5" r="1.3" fill="#111"/><path d="M16 16.5h4l-2 2.2z" fill="#f59e0b"/></svg>`;
  }
  function protonCard(info) {
    const p = info.protondb || {}, tier = info.native ? "native" : (p.tier || "pending");
    const [bg, fg, label] = TIER_BAND[tier] || TIER_BAND.pending;
    const pt = TIERS[p.tier] || TIERS.pending;
    const meta = [p.reports ? tr(`${p.reports} hlásení`, `${p.reports} reports`) : tr("zatiaľ bez hlásení", "no reports yet"),
      p.trending && p.trending !== p.tier && TIERS[p.trending] ? `trend ${TIERS[p.trending].label}` : ""].filter(Boolean).join(" · ");
    return `<div class="psi-pcard" style="width:270px;flex:none;border-radius:6px;overflow:hidden;background:#1e222b;border:1px solid rgba(255,255,255,.08);font-family:'Motiva Sans',Arial,sans-serif">
      <div style="background:${bg};color:${fg};text-align:center;font-size:19px;font-weight:600;letter-spacing:.08em;padding:9px 6px">${label}</div>
      <div style="display:flex;justify-content:center;align-items:center;gap:18px;padding:12px 10px 8px">
        <span title="ProtonDB: ${pt.label}">${medal(p.tier || "pending", 26)}</span>${deckIcon(info.deck)}${tuxIcon(info.native)}
      </div>
      <div style="text-align:center;color:var(--psi-mut,#8b929a);font-size:12px;padding:0 10px 11px">${esc(meta)} · <span class="psi-pdb" style="color:var(--psi-accent,#1a9fff);cursor:pointer">ProtonDB ↗</span></div>
    </div>`;
  }

  /* ---------------- vysvetlenie: prečo Gold, anti-cheat, Deck ---------------- */
  const TIER_WHY = () => ({
    native: tr("Hra má natívnu Linux verziu – Proton netreba.", "Has a native Linux version – no Proton needed."),
    platinum: tr("Beží perfektne hneď po inštalácii, nič netreba nastavovať.", "Runs perfectly out of the box, nothing to set up."),
    gold: tr("Beží perfektne, ale niekedy po menšej úprave (iná verzia Protonu alebo spúšťací parameter).", "Runs perfectly, sometimes after a small tweak (another Proton version or a launch option)."),
    silver: tr("Hrateľná, ale s menšími chybami (grafika, zvuk, občasný pád).", "Playable, with minor issues (graphics, audio, an occasional crash)."),
    bronze: tr("Spustí sa, ale má vážne problémy – hranie môže byť nepríjemné.", "Starts, but has serious issues – playing may be unpleasant."),
    borked: tr("Nespustí sa alebo je nehrateľná.", "Won't start or isn't playable."),
    pending: tr("Zatiaľ málo hlásení na spoľahlivé hodnotenie.", "Not enough reports for a reliable rating yet."),
  });
  const CONF = () => LANG === "en" ? {strong: "high", good: "good", moderate: "moderate", low: "low", inadequate: "too low"}
    : {strong: "vysoká", good: "dobrá", moderate: "stredná", low: "nízka", inadequate: "nedostatočná"};
  const AC = () => ({
    Supported: ["ok", tr("Anti-cheat na Linuxe funguje – online hranie je v poriadku.", "Anti-cheat works on Linux – online play is fine.")],
    Running: ["warn", tr("Anti-cheat beží, ale vývojár Linux oficiálne nepodporuje – môže sa to kedykoľvek zmeniť.", "Anti-cheat runs, but the developer doesn't officially support Linux – that can change any time.")],
    Planned: ["warn", tr("Podpora Linuxu sa plánuje – online zatiaľ nemusí fungovať.", "Linux support is planned – online may not work yet.")],
    Broken: ["bad", tr("Anti-cheat na Linuxe nefunguje – do online hier ťa nepustí alebo vyhodí.", "Anti-cheat doesn't work on Linux – online modes won't let you in or will kick you.")],
    Denied: ["bad", tr("Vývojár Linux zablokoval – do online hier ťa nepustí (offline režim, ak ho hra má, ide).", "The developer blocks Linux – no online play (offline mode works if the game has one).")],
  });
  const DECK_TXT = () => ({3: ["ok", tr("Steam Deck: overené", "Steam Deck: Verified")], 2: ["warn", tr("Steam Deck: hrateľné (drobné obmedzenia)", "Steam Deck: Playable (minor limits)")],
    1: ["bad", tr("Steam Deck: nepodporované", "Steam Deck: Unsupported")], 0: ["info", tr("Steam Deck: zatiaľ nehodnotené", "Steam Deck: not rated yet")]});
  const ICO = {
    ok: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="#a4d007" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2l6.5 12h-13z" fill="none" stroke="#e5a83a" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 12v.3" stroke="#e5a83a" stroke-width="1.8" stroke-linecap="round"/></svg>',
    bad: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="#d94126" stroke-width="2.2" stroke-linecap="round"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#8f98a0" stroke-width="1.6"/><path d="M8 7.2v4M8 4.8v.3" stroke="#8f98a0" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };
  /* ---------------- výkon na tvojom PC (odhad FPS) ---------------- */
  function perfHtml(p) {
    if (!p) return "";
    const pc = p.pc || {}, req = p.req || {}, mn = req.minimum || {}, rc = req.recommended || {};
    const col = {great: "#59bf40", good: "#a4d007", ok: "#e5a83a", low: "#e5a83a", bad: "#d94126"}[p.level] || "#8f98a0";
    const cmp = (mine, need) => mine == null || need == null ? "info" : mine >= need ? "ok" : "bad";
    const ref = rc.gpu_score ? rc : mn;
    // odhad nie je meranie → ukazujeme rozsah, nie jedno presné číslo
    const r5 = x => Math.max(5, Math.round(x / 5) * 5);
    const fps = n => n == null ? "?" : n >= 144 ? "144+" : `${r5(n * 0.8)}–${r5(n * 1.15)}`;
    const feel = {great: tr("plynulo", "smooth"), good: tr("plynulo", "smooth"), ok: tr("hrateľne", "playable"), low: tr("slabo", "rough"), bad: tr("pod minimom", "below minimum")}[p.level] || "";
    const preset = {great: tr("Ultra / vysoké", "Ultra / high"), good: tr("Vysoké", "High"), ok: tr("Stredné", "Medium"), low: tr("Nízke", "Low"), bad: tr("Nízke", "Low")}[p.level] || "";
    const row = (lvl, label, mine, need) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:4px 0;line-height:1.4">
      <span style="flex:none;margin-top:2px">${ICO[lvl]}</span><span style="min-width:74px;color:var(--psi-mut,#8f98a0)">${label}</span>
      <span><span style="color:var(--psi-text,#fff)">${esc(mine)}</span>${need ? `<span style="color:var(--psi-mut,#8f98a0)"> · ${ref === rc ? tr("odporúčané", "recommended") : "minimum"}: ${esc(need)}</span>` : ""}</span></div>`;
    const head = p.fps_high ? `<div style="display:flex;gap:26px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
        <div><div style="font-size:30px;line-height:1;color:${col};font-weight:300">${fps(p.fps_high)} <span style="font-size:15px">FPS</span></div>
          <div style="font-size:12.5px;color:var(--psi-mut,#8f98a0);margin-top:4px">${esc(preset)} ${tr("detaily", "settings")} · 1080p · ${esc(feel)}</div></div>
        ${p.fps_low ? `<div><div style="font-size:18px;line-height:1;color:var(--psi-text2,#dcdedf)">${fps(p.fps_low)} FPS</div><div style="font-size:12.5px;color:var(--psi-mut,#8f98a0);margin-top:4px">${tr("nízke detaily", "low settings")}</div></div>` : ""}
      </div>` : `<div style="color:var(--psi-mut,#8f98a0);margin-bottom:8px">${tr("Odhad nie je k dispozícii – hra neuvádza porovnateľné požiadavky.", "No estimate – the game doesn't list comparable requirements.")}</div>`;
    return head
      + row(cmp(pc.gpu_score, ref.gpu_score), tr("Grafika", "GPU"), pc.gpu || "?", ref.gpu || "")
      + row(cmp(pc.cpu_score, ref.cpu_score), tr("Procesor", "CPU"), pc.cpu || "?", ref.cpu || "")
      + row(cmp(pc.ram, ref.ram), "RAM", pc.ram ? `${pc.ram} GB` : "?", ref.ram ? `${ref.ram} GB` : "")
      + (p.notes || []).map(n => `<div style="color:var(--psi-mut,#8f98a0);font-size:12px;padding-top:4px">${esc(n)}</div>`).join("")
      + `<div style="color:var(--psi-faint,#56707f);font-size:11px;margin-top:8px">${tr("Hrubý odhad z požiadaviek hry a tvojho hardvéru, nie meranie.", "A rough estimate from the game's requirements and your hardware, not a benchmark.")}</div>`;
  }

  function linuxRows(info) {
    const p = info.protondb || {}, tier = info.native ? "native" : (p.tier || "pending");
    const rows = [];
    const tl = (TIERS[tier] || TIERS.pending).label;
    rows.push([tier === "borked" ? "bad" : ["bronze", "silver", "pending"].includes(tier) ? "warn" : "ok", `<b style="color:var(--psi-text,#fff);font-weight:600">${tl}</b> – ${TIER_WHY()[tier] || ""}`]);
    if (!info.native && p.reports) {
      const conf = CONF()[p.confidence];
      const extra = [tr(`${p.reports} hlásení`, `${p.reports} reports`), conf ? tr(`istota ${conf}`, `confidence ${conf}`) : "",
        p.trending && p.trending !== p.tier && TIERS[p.trending] ? tr(`nové hlásenia: ${TIERS[p.trending].label}`, `recent reports: ${TIERS[p.trending].label}`) : "",
        p.best && p.best !== p.tier && TIERS[p.best] ? tr(`najlepšie: ${TIERS[p.best].label}`, `best: ${TIERS[p.best].label}`) : ""].filter(Boolean).join(" · ");
      rows.push(["info", `ProtonDB: ${esc(extra)}`]);
    }
    const ac = info.anticheat;
    if (ac && ac.anticheats && ac.anticheats.length) {
      const [lvl, txt] = AC()[ac.status] || ["info", `${tr("Stav", "Status")}: ${esc(ac.status)}`];
      rows.push([lvl, `<b style="color:var(--psi-text,#fff);font-weight:600">${esc(ac.anticheats.join(", "))}</b> – ${txt}`]);
      (ac.notes || []).forEach(n => rows.push(["info", `<span style="color:var(--psi-mut,#8f98a0)">${esc(n)}</span>`]));
    } else {
      rows.push(["ok", tr("Bez známeho problémového anti-cheatu – online by malo ísť.", "No known problematic anti-cheat – online should work.")]);
    }
    const dtx = DECK_TXT(), [dl, dt] = dtx[info.deck] || dtx[0];
    rows.push([dl, dt]);
    rows.push([info.native ? "ok" : "info", info.native ? tr("Natívna Linux verzia", "Native Linux version") : tr("Beží cez Proton (Steam Play)", "Runs through Proton (Steam Play)")]);
    return rows.map(([l, h]) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:5px 0;line-height:1.45"><span style="flex:none;margin-top:2px">${ICO[l]}</span><span>${h}</span></div>`).join("");
  }
  /* ---------------- knižnica: ProtonDB pri hre + popis ---------------- */
  const libCache = new Map();
  let libOn = true, libOnT = 0, libBusy = false;
  const DECK = () => ({3: tr("overené", "Verified"), 2: tr("hrateľné", "Playable"), 1: tr("nepodporované", "Unsupported")});
  const STAT_LABEL = /^(Play ?Time|Last Played|Space Required|Achievements|Čas hrania|Naposledy hrané|Potrebné miesto)$/i;

  // Všetky kontajnery štatistík (Steam má aj skryté kópie a lepkavú hlavičku)
  function allStats(doc) {
    const known = [...doc.querySelectorAll("._1mDAVT4sTzFRwJtlKCw2Ws")];   // Steam build 2026-11
    if (known.length) return known;
    const out = new Set();
    for (const el of doc.querySelectorAll(".tool-tip-source div")) {
      if (!el.children.length && STAT_LABEL.test(el.textContent.trim())) {
        const src = el.closest(".tool-tip-source");
        src && src.parentElement && out.add(src.parentElement);
      }
    }
    return [...out];
  }

  function statItem(stats, appid, info) {
    const p = info.protondb || {}, tier = info.native ? "native" : (p.tier || "pending"), t = TIERS[tier] || TIERS.pending;
    const sample = [...stats.querySelectorAll(":scope > .tool-tip-source")].find(e => !e.querySelector("svg") && !e.classList.contains("psi-lib")) || stats.firstElementChild;
    const item = sample.cloneNode(true);
    item.classList.add("psi-lib");
    item.removeAttribute("id");
    item.dataset.app = String(appid);
    const leaves = [...item.querySelectorAll("div")].filter(e => !e.children.length);
    if (leaves[0]) leaves[0].textContent = info.native ? "Linux" : "ProtonDB";
    const value = leaves[leaves.length - 1];
    if (value) value.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">${medal(tier, 14).replace(/<title>.*?<\/title>/, "")}<span style="color:${t.c1};font-weight:600">${info.native ? tr("Natívne", "Native") : t.label}</span></span>`;
    const dk = DECK()[info.deck];
    item.title = [info.native ? tr("Natívna Linux verzia", "Native Linux version") : `ProtonDB: ${t.label}`, p.reports ? tr(`${p.reports} hlásení`, `${p.reports} reports`) : "",
      dk ? `Steam Deck: ${dk}` : ""].filter(Boolean).join(" · ") + tr(" – klikni pre ProtonDB", " – click for ProtonDB");
    item.style.cursor = "pointer";
    item.addEventListener("click", e => { e.stopPropagation(); openUrl(`https://www.protondb.com/app/${appid}`); });
    return item;
  }

  function aboutBlock(doc, appid, info) {
    const box = doc.createElement("div");
    box.className = "psi-libcard";
    box.dataset.app = String(appid);
    box.style.cssText = "margin:4px 0 22px;padding:14px 20px;border-radius:6px;" +
      "background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06)";
    const who = [info.developers && info.developers.length ? `${tr("Vývojár", "Developer")}: ${info.developers.slice(0, 2).join(", ")}` : "",
      info.publishers && info.publishers.length ? `${tr("Vydavateľ", "Publisher")}: ${info.publishers.slice(0, 2).join(", ")}` : ""].filter(Boolean).join(" · ");
    let open = false;
    try { open = doc.defaultView.localStorage.getItem("psi-about-open") === "1"; } catch (e) {}
    box.innerHTML = `
      <div class="psi-about-head" style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
        <div style="font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--psi-text2,#dcdedf);font-weight:500">${tr("O hre", "About")}</div>
        <svg class="psi-chev" width="14" height="14" viewBox="0 0 14 14" style="transition:transform .38s cubic-bezier(.22,1,.36,1);transform:rotate(${open ? 90 : 0}deg)"><path d="M5 3l4 4-4 4" fill="none" stroke="#dcdedf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="psi-about-wrap" style="display:grid;grid-template-rows:${open ? "1fr" : "0fr"};opacity:${open ? 1 : 0};transition:grid-template-rows .38s cubic-bezier(.22,1,.36,1),opacity .3s ease">
      <div style="overflow:hidden;min-height:0">
      <div class="psi-about-body" style="display:flex;gap:24px;align-items:flex-start;padding-top:12px">
      <div style="flex:1;min-width:0">
        <div style="color:var(--psi-text2,#c6d4df);font-size:14px;line-height:1.55">${esc(info.desc || tr("Popis hry nie je k dispozícii.", "No description available."))}</div>
        ${who ? `<div style="color:var(--psi-mut,#8b929a);font-size:12.5px;margin-top:12px">${esc(who)}</div>` : ""}
        <div style="font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--psi-text2,#dcdedf);margin:20px 0 6px;font-weight:500">${tr("Hrať na Linuxe", "Playing on Linux")}</div>
        <div style="color:var(--psi-text2,#c6d4df);font-size:14px">${linuxRows(info)}</div>
        <div style="font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--psi-text2,#dcdedf);margin:20px 0 8px;font-weight:500">${tr("Výkon na tvojom PC", "Performance on your PC")}</div>
        <div style="color:var(--psi-text2,#c6d4df);font-size:14px" class="psi-perf">${info.perf ? perfHtml(info.perf) : `<span style="color:var(--psi-mut,#8f98a0)">${tr("Počítam odhad…", "Estimating…")}</span>`}</div>
        <div style="color:var(--psi-faint,#5b6170);font-size:11px;margin-top:10px">${tr("Údaje", "Data")}: ProtonDB, AreWeAntiCheatYet, Steam · PSI</div>
      </div>
      ${protonCard(info)}
      </div></div></div>`;
    box.querySelector(".psi-about-head").addEventListener("click", e => {
      e.stopPropagation();
      const wrap = box.querySelector(".psi-about-wrap"), now = wrap.style.gridTemplateRows !== "1fr";
      wrap.style.gridTemplateRows = now ? "1fr" : "0fr";
      wrap.style.opacity = now ? "1" : "0";
      box.querySelector(".psi-chev").style.transform = `rotate(${now ? 90 : 0}deg)`;
      try { doc.defaultView.localStorage.setItem("psi-about-open", now ? "1" : "0"); } catch (err) {}
    });
    box.querySelector(".psi-pdb").addEventListener("click", e => { e.stopPropagation(); openUrl(`https://www.protondb.com/app/${appid}`); });
    return box;
  }

  async function libraryTick() {
    if (libBusy) return;
    const loc = window.MainWindowBrowserManager && MainWindowBrowserManager.m_lastLocation;
    const m = loc && /^\/library\/app\/(\d+)/.exec(loc.pathname || "");
    const pop = window.g_PopupManager && g_PopupManager.m_mapPopups.get("SP Desktop_uid0");
    const doc = pop && pop.m_popup && pop.m_popup.document;
    if (!m || !doc) return;
    const appid = +m[1];
    const statsList = allStats(doc).filter(st => st.offsetParent);
    const todo = statsList.filter(st => !st.querySelector(`:scope > .psi-lib[data-app="${appid}"]`));
    const main = statsList[statsList.length - 1];
    if (!todo.length && main && main.closest("[class]") && doc.querySelector(`.psi-libcard[data-app="${appid}"]`)?.offsetParent) return;
    libBusy = true;
    try {
      if (!FEAT.library) { doc.querySelectorAll(".psi-lib, .psi-libcard").forEach(e => e.remove()); return; }
      let info = libCache.get(appid);
      if (!info) { info = await call("linux", {appid}); libCache.set(appid, info); }
      if (!info.perf) { try { info.perf = await call("perf", {appid}); } catch (e) {} }
      const now = /^\/library\/app\/(\d+)/.exec(MainWindowBrowserManager.m_lastLocation.pathname || "");
      if (!now || +now[1] !== appid) return;               // medzitým prepnutá hra
      for (const st of allStats(doc).filter(s => s.offsetParent)) {
        st.querySelectorAll(":scope > .psi-lib").forEach(e => e.remove());
        st.prepend(statItem(st, appid, info));
      }
      // blok „O hre“ – nad stĺpcami Aktivita / Priatelia (posledný súrodenec sekcie s tlačidlom Play)
      const mainStats = allStats(doc).filter(s => s.offsetParent).pop();
      let sec = mainStats;
      while (sec && sec.parentElement && sec.parentElement.children.length < 5) sec = sec.parentElement;
      const host = sec && sec.parentElement;
      if (host) {
        host.querySelectorAll(":scope > .psi-libcard").forEach(e => e.remove());
        const block = aboutBlock(doc, appid, info);
        const columns = host.lastElementChild;
        // zarovnanie s riadkom tlačidla Play
        let row = mainStats; for (let i = 0; i < 3 && row.parentElement; i++) row = row.parentElement;
        const r = row.getBoundingClientRect(), hr = host.getBoundingClientRect();
        if (r.width > 200) { block.style.marginLeft = Math.max(0, r.left - hr.left) + "px"; block.style.marginRight = Math.max(0, hr.right - r.right) + "px"; }
        host.insertBefore(block, columns);
      }
    } catch (e) { /* skúsime pri ďalšom tiku */ }
    finally { libBusy = false; }
  }


  /* ---------------- zaoblené rohy v klientovi ---------------- */
  const ROUND_CSS = `
  .DialogButton,.DialogDropDown,._DialogInputContainer,.DialogInput,.DialogTextInputBase,.DialogInputLabelGroup input{border-radius:8px!important}
  .ModalPosition_Content,.GenericConfirmDialog,.DialogContent_InnerWidth .DialogBody > .Panel{border-radius:12px}
  .ModalPosition_Content{overflow:hidden}
  img.avatar,.avatarHolder,.avatarFrame img{border-radius:8px}
  /* INSTALL/PLAY + šípka = jeden zaoblený celok */
  ._1FnJ6dPuknQFQ2RTpKTI16{border-radius:10px!important;gap:0!important;background:transparent!important}
  ._1FnJ6dPuknQFQ2RTpKTI16 > *{margin:0!important;box-shadow:none!important}
  ._1FnJ6dPuknQFQ2RTpKTI16 > :only-child{border-radius:10px!important}
  ._1FnJ6dPuknQFQ2RTpKTI16 > :first-child:not(:only-child){border-radius:10px 0 0 10px!important}
  ._1FnJ6dPuknQFQ2RTpKTI16 > :last-child:not(:only-child){border-radius:0 10px 10px 0!important;border-left:1px solid rgba(0,0,0,.25)!important;filter:brightness(.9)}
  ._2r4TK4BAuU-J4FuF_O7v_5{border-radius:10px;overflow:hidden}
  ._3qDWQGB0rtwM3qpXTb11Q-{border-radius:8px}
  /* riadok záložiek v knižnici (Store Page / DLC / …): border-image ignoruje zaoblenie → nahradíme */
  ._31ptFGGMZrSQc5BCX1e5lm{border-image:none!important;border-radius:var(--psi-radius,12px)!important;overflow:hidden}
  ._1b6LYWVijW-9E4YV0keDWZ{border-radius:8px!important}
  ._2sNDjgK9EWiPLdNGkjun-w{color:var(--psi-text2,rgba(255,255,255,.66))!important;font-weight:500!important}
  ._1b6LYWVijW-9E4YV0keDWZ:hover ._2sNDjgK9EWiPLdNGkjun-w{color:var(--psi-text,#fff)!important}
  /* dialógy Steamu (napr. Anonymous framerate data) */
  .v66w8s0IBeRURM9hD5nAw{border-image:none!important;border:1px solid color-mix(in srgb,var(--psi-accent,#1a9fff) 30%,transparent)!important;border-radius:var(--psi-radius,12px)!important;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.55)!important}
  ._2T8UwmbZ9jJzntqjQU4czU{color:var(--psi-text,#fff)!important;font-weight:400!important}
  ._2d9pc_ziCjBFV-KGQ-nsCh{color:var(--psi-text2,#bfc6cd)!important}
  /* tlačidlo Scroll to top – pilulka v farbe témy */
  ._1J21tLst5SEhBPkVRT53UV{overflow:visible!important;padding:6px 0 6px var(--psi-lib-left,0px)!important;box-sizing:border-box!important;display:flex!important;justify-content:center!important;align-items:center!important}
  ._1J21tLst5SEhBPkVRT53UV > div{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:26px!important;padding:0 30px!important;line-height:1!important;margin:0!important;box-sizing:border-box!important;background:color-mix(in srgb,var(--psi-accent,#1a9fff) 78%,var(--psi-bg2,#23272e))!important;color:var(--psi-text,#fff)!important;border-radius:99px!important;box-shadow:0 4px 14px rgba(0,0,0,.35)!important;font-weight:600!important;transition:filter .15s}
  /* pripnutá lišta (Play/Download) pri scrollovaní dole – skryť úplne */
  ._2Nq6ov7A1hGcHXVOXNt_OE > ._2L3s2nzh7yCnNESfI5_dN1{display:none!important}
  ._1J21tLst5SEhBPkVRT53UV > div:hover{filter:brightness(1.12)}
  .psi-libcard{border-radius:12px!important}.psi-pcard{border-radius:10px!important}
  /* jednotné farby celého okna odvodené z témy (lišta, spodok, ľavý panel, stránky knižnice) */
  /* svetlejšia modrá: hlavná plocha (bg) a o odtieň tmavší rám – ľavý panel, lišta, spodok (bg2) */
  :root{--psi-bg:color-mix(in srgb,var(--psi-panel-solid,#121c2c) 38%,#2c3139);--psi-bg2:color-mix(in srgb,var(--psi-panel-solid,#121c2c) 42%,#23272e);
    --psi-ctl:color-mix(in srgb,var(--psi-bg2) 72%,#ffffff 11%)}
  ._3Z7VQ1IMk4E3HsHvrkLNgo,._3vCzSrrXZzZjVJFZNg9SGu{background:var(--psi-bg2)!important;box-shadow:none!important}
  /* prechod lišta → obsah bez sivých čiar a pôvodných farieb Steamu */
  ._2TKEazUUS3TlniZfpc8OOe,._2CmrnGY-Amtd83ScJkFvx2{background:var(--psi-bg2)!important;box-shadow:none!important;border:0!important}
  ._2Nq6ov7A1hGcHXVOXNt_OE{border-top-color:transparent!important}
  ._3fLo166MlaNqP8r8tTyRz{background-image:linear-gradient(to top,transparent 0%,var(--psi-bg2) 100%)!important}
  /* ovládacie prvky v ľavom paneli: Home, Games and Software, vyhľadávanie – viditeľne oddelené */
  ._3pSPluBgf0NeR1kkCLWMhR,._2WgQEFvIzJw_SHNGbjtRFU,._20QAC4WMXm8qFE8waUT5oo{
    background:var(--psi-ctl)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)!important;border-radius:8px!important}
  ._12vo5L1hsNGdao6_ssuirS,._3x1HklzyDs4TEjACrRO2tB .DialogInput_Wrapper{background-color:transparent!important;box-shadow:none!important}
  ._3pSPluBgf0NeR1kkCLWMhR:hover,._2WgQEFvIzJw_SHNGbjtRFU:hover{background:color-mix(in srgb,var(--psi-ctl) 80%,#ffffff 12%)!important}
  ._3x1HklzyDs4TEjACrRO2tB .DialogInput,._3x1HklzyDs4TEjACrRO2tB input{background-color:transparent!important}
  ._3x1HklzyDs4TEjACrRO2tB{background:var(--psi-bg2)!important}
  /* hlavičky kategórií v ľavom zozname: bez vlastného pozadia, len jemná deliaca čiara */
  ._2sYIghGVXJr6tsQVvcryy8{background:transparent!important;border-radius:0!important;box-shadow:inset 0 -1px 0 rgba(255,255,255,.05)!important}
  ._3lDczhulqraStjCitLYJ1K,._2Dd4T78PcCTUVgOtDGFY5j{background:var(--psi-bg)!important}
  /* menu: okno nezaobľujeme (je nepriehľadné → čierne rohy); tón panelov, zvýraznenie vo farbe akcentu */
  .ContextMenuPopupBody #popup_target > div,.ContextMenuPopupBody #popup_target > div > div{background:color-mix(in srgb,var(--psi-panel-solid,#121c2c) 82%,#ffffff 8%)!important}
  /* položky cez celú šírku bez zaoblenia – okno menu je hranaté, inak okolo presvitá tmavý štvorec */
  .ContextMenuPopupBody .contextMenuItem{border-radius:0!important;margin:0!important;background:transparent!important}
  .ContextMenuPopupBody .contextMenuItem:hover,.ContextMenuPopupBody .contextMenuItem:focus,.ContextMenuPopupBody .contextMenuItem.active{
    background:color-mix(in srgb,var(--psi-accent,#1a9fff) 38%,transparent)!important;color:var(--psi-text,#fff)!important}
  .PageListColumn [role="tab"]{border-radius:8px}
  ._3pSPluBgf0NeR1kkCLWMhR,._2WgQEFvIzJw_SHNGbjtRFU,._12vo5L1hsNGdao6_ssuirS,.DialogInput_Wrapper{border-radius:8px;overflow:hidden}
  ._2-O4ZG0KrnSrzISHBKctFQ{border-radius:6px}
  ._2Szzh5sKyGgnLUR870zbDE{border-radius:8px!important}
  ._3yD46y5pd3zOGR7CzKs0mC{border-radius:8px!important;overflow:hidden}
  /* obrázok hry: vyšší, pokračuje za lištou s tlačidlom a dlho, plynulo mizne */
  /* obrázok hry: dlho celý, potom mäkko (ease-out) zmizne – bez fade do strán */
  img.HNbe3eZf6H7dtJ042x1vM[src*="library_hero."]:not([src*="blur"]){
    -webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.3) 0%,rgba(0,0,0,.75) 3%,#000 7%,#000 46%,rgba(0,0,0,.9) 55%,rgba(0,0,0,.72) 64%,rgba(0,0,0,.5) 73%,rgba(0,0,0,.3) 82%,rgba(0,0,0,.13) 91%,transparent 100%)!important;
    mask-image:linear-gradient(to bottom,rgba(0,0,0,.3) 0%,rgba(0,0,0,.75) 3%,#000 7%,#000 46%,rgba(0,0,0,.9) 55%,rgba(0,0,0,.72) 64%,rgba(0,0,0,.5) 73%,rgba(0,0,0,.3) 82%,rgba(0,0,0,.13) 91%,transparent 100%)!important}
  /* rozmazaná kópia za obrázkom: tlmenejšia, aby nefarbila stránku */
  img[src*="library_hero_blur"]:not([class*="_3_IUV"]){opacity:.5!important}
  /* bez sivého pásu a čiary pod obrázkom (len hlavná lišta, nie lepkavá hlavička pri posúvaní) */
  ._3VQUewWB8g6Z5qB4C7dGFr ._3fLo166MlaNqP8r8tTyRz,._3VQUewWB8g6Z5qB4C7dGFr .Jbe--NUNw7sxbxGsMSjVa{background:transparent!important;border:0!important;box-shadow:none!important}
  img[src*="library_hero_blur"]:not([class*="_3_IUV"]){-webkit-mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,.55) 8%,rgba(0,0,0,.35) 40%,rgba(0,0,0,.12) 70%,transparent 95%)!important;mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,.55) 8%,rgba(0,0,0,.35) 40%,rgba(0,0,0,.12) 70%,transparent 95%)!important}
  /* bodka vo farbe témy pri vybranej / označenej hre v zozname */
  ._2-O4ZG0KrnSrzISHBKctFQ{position:relative}
  ._2-O4ZG0KrnSrzISHBKctFQ._1UBpAXP408Ez_L_mXhW5Q9::before,._2-O4ZG0KrnSrzISHBKctFQ:hover::before{content:"";position:absolute;left:8px;top:50%;width:6px;height:6px;margin-top:-3px;
    border-radius:50%;background:var(--psi-accent,#1a9fff);box-shadow:0 0 8px var(--psi-accent,#1a9fff);z-index:2;pointer-events:none}
  ._2-O4ZG0KrnSrzISHBKctFQ:hover:not(._1UBpAXP408Ez_L_mXhW5Q9)::before{opacity:.55}
  #psi-settings .psi-card{border-radius:12px}
  `;
  /* ---------------- vlastná téma (Nastavenia → PSI → Vzhľad) ---------------- */
  function psiThemeCss(t, where) {
    const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0).join(",");
    const P = `rgba(${rgb(t.panel)},${t.opacity})`, A = t.accent, B = `${t.blur}px`, R = `${t.radius}px`;
    // sklo (rozmazanie) len na pár miestach – karta O hre, hlavná karta v obchode, lišta obchodu; inde plná plocha
    const glass = `background:${P}!important;backdrop-filter:blur(${B})!important;-webkit-backdrop-filter:blur(${B})!important;border-radius:${R}!important`;
    const solid = `background:${P}!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;border-radius:${R}!important`;
    const vars = `:root{--psi-accent:${A};--psi-panel:${P};--psi-panel-solid:${t.panel};--psi-blur:${B};--psi-radius:${R};--psi-text:color-mix(in srgb,#ffffff 94%,${A});--psi-text2:color-mix(in srgb,#d6dbe0 88%,${A});--psi-mut:color-mix(in srgb,#8f98a0 85%,${A});--psi-faint:color-mix(in srgb,#5b6170 80%,${A})}`;
    if (where === "web") return vars + `
  .game_area_purchase_game,.rightcol .block,.leftcol .block,.queue_ctn,.review_box,.user_reviews_summary_bar,.game_area_dlc_section,
  .dlc_page_purchase_dlc_list_block,.game_meta_data .block,.franchise_notice,.DRM_notice,.game_area_already_owned,.early_access_banner,
  .profile_customization{${solid}}
  #game_highlights::before{background:${P}!important;backdrop-filter:blur(${B})!important;border-radius:calc(${R} + 8px)!important}
  :has(> [role="navigation"][aria-label="Store menu"]){background:rgba(${rgb(t.panel)},${Math.max(0.12, t.opacity - 0.2)})!important;
    backdrop-filter:blur(calc(${B} + 4px))!important;border-radius:calc(${R} + 2px)!important}
  form[role="search"]{border-radius:${R}!important}
  form[role="search"] button,[role="navigation"][aria-label="Store menu"] a[href*="/cart"],.btn_blue_steamui,.btnv6_blue_blue_innerfade{background:${A}!important}`;
    return vars + `
  .psi-libcard{${glass};border:1px solid rgba(255,255,255,.04)!important}
  .psi-pcard{border-radius:calc(${R} - 2px)!important}
  #psi-settings .psi-card{${solid}}
  #psi-settings .psi-sw.on{background:${A}!important;box-shadow:none!important}
  .DialogButton.Primary,._3ydigb6zZAjJ0JCDgHwSYA,._2Szzh5sKyGgnLUR870zbDE._5wILZhsLODVwGfcJ0hKmJ{background:${A}!important}
  ._1FnJ6dPuknQFQ2RTpKTI16,._2r4TK4BAuU-J4FuF_O7v_5{border-radius:${R}!important}`;
  }

  const FEAT = {rounded: true, library: true};
  const THEME = {accent: "#1a9fff", panel: "#121c2c", opacity: 0.62, blur: 10, radius: 12};
  let THEME_CSS = psiThemeCss(THEME, "client");
  function setTheme(t) { Object.assign(THEME, t || {}); THEME_CSS = psiThemeCss(THEME, "client"); }
  function setLang(l) {
    const v = l === "en" ? "en" : "sk";
    if (v === LANG) return;
    LANG = v;
    libCache.clear();                                     // texty z odhadu výkonu sú v jazyku služby
    const pop = window.g_PopupManager && g_PopupManager.m_mapPopups.get("SP Desktop_uid0");
    const d = pop && pop.m_popup && pop.m_popup.document;
    if (d) d.querySelectorAll(".psi-lib, .psi-libcard").forEach(e => e.remove());
    if (FEAT.collections) setTimeout(() => syncCollections(true), 1500);
  }
  async function refreshFeatures() {
    try { Object.assign(FEAT, await call("features")); setLang(FEAT.lang); } catch (e) {}
    try { setTheme(await call("theme")); } catch (e) {}
    if (!MILL.length || Date.now() - (window.__psiMillT || 0) > 15000) { window.__psiMillT = Date.now(); await refreshMillennium(); await refreshCustom(); }
    try { await refreshFont(); } catch (e) {}
  }
  function applyRounded(doc) {
    const put = (id, css) => {
      let st = doc.getElementById(id);
      if (!css) { st && st.remove(); return; }
      if (!st) { st = doc.createElement("style"); st.id = id; (doc.head || doc.documentElement).appendChild(st); }
      if (st.textContent !== css) st.textContent = css;
    };
    put("psi-round", FEAT.rounded ? ROUND_CSS : "");
    put("psi-theme", FEAT.rounded ? THEME_CSS : "");
  }


  /* ---------------- auto-kolekcie v knižnici ---------------- */
  // PSI mení LEN kolekcie s predponou „PSI · “ – tvoje vlastné kolekcie nechá tak.
  // [slovensky, anglicky, podmienka] – pri zmene jazyka sa kolekcia v druhom jazyku odstráni
  const COLS = [
    ["PSI · Natívne Linux", "PSI · Native Linux", d => d.native],
    ["PSI · Platinum", "PSI · Platinum", d => !d.native && d.tier === "platinum"],
    ["PSI · Gold", "PSI · Gold", d => !d.native && d.tier === "gold"],
    ["PSI · Silver", "PSI · Silver", d => !d.native && d.tier === "silver"],
    ["PSI · Bronze", "PSI · Bronze", d => !d.native && d.tier === "bronze"],
    ["PSI · Nefunguje (Borked)", "PSI · Borked", d => !d.native && d.tier === "borked"],
    ["PSI · Online nepôjde (anti-cheat)", "PSI · Online blocked (anti-cheat)", d => d.ac === "Denied" || d.ac === "Broken"],
    ["PSI · Steam Deck overené", "PSI · Steam Deck Verified", d => d.deck === 3],
  ];
  let colBusy = false, colLast = 0;
  function findCol(name) {
    return collectionStore.userCollections.find(c => c.displayName === name) || null;
  }
  async function syncCollections(force = false) {
    if (colBusy || !window.collectionStore || !window.appStore) return;
    if (!FEAT.collections) return;
    if (!force && Date.now() - colLast < 6 * 3600e3) return;
    colBusy = true;
    try {
      const games = (collectionStore.GetCollection("type-games") || {}).allApps || [];
      if (!games.length) return;
      const data = await call("tiers", {appids: games.map(a => a.appid)});
      for (const [sk, en, test] of COLS) {
        const name = tr(sk, en), other = findCol(LANG === "en" ? sk : en);
        if (other && other.displayName !== name && other.bIsDeletable) { try { await other.Delete(); } catch (e) {} }
        const want = games.filter(a => data[a.appid] && test(data[a.appid]));
        let c = findCol(name);
        if (!want.length) { if (c && c.bIsDeletable) await c.Delete(); continue; }
        if (!c) { c = collectionStore.NewUnsavedCollection(name, undefined, want); await c.Save(); continue; }
        const wantIds = new Set(want.map(a => a.appid)), have = new Set(c.allApps.map(a => a.appid));
        const add = want.filter(a => !have.has(a.appid)), rem = c.allApps.filter(a => !wantIds.has(a.appid));
        const dd = c.AsDragDropCollection ? c.AsDragDropCollection() : c;
        if (add.length) dd.AddApps(add);
        if (rem.length) dd.RemoveApps(rem);
        if (add.length || rem.length) await c.Save();
      }
      colLast = Date.now();
    } catch (e) { console.warn("PSI kolekcie:", e); }
    finally { colBusy = false; }
  }
  async function removeCollections() {
    for (const [sk, en] of COLS) for (const name of new Set([sk, en])) { const c = findCol(name); if (c && c.bIsDeletable) { try { await c.Delete(); } catch (e) {} } }
  }
  window.__psiSyncCollections = syncCollections;

  /* knižnica pre PSI launcher (funguje aj bez zapnutého Steamu) */
  async function exportLibrary() {
    try {
      const games = (window.collectionStore && collectionStore.GetCollection("type-games") || {}).allApps || [];
      if (!games.length) return;
      await call("save_library", {apps: games.map(a => ({appid: a.appid, name: a.display_name,
        playtime: a.minutes_playtime_forever || 0, last_played: a.rt_last_time_played || 0}))});
    } catch (e) {}
  }


  /* ---------------- automatické zaoblenie všetkého viditeľného ---------------- */
  // Každý prvok s pozadím, rámikom, tieňom alebo obrázok/tlačidlo dostane zaoblené rohy.
  // Preskočí: SVG, prvky cez celú šírku okna, malé ikonky a prvky, ktoré už zaoblené sú.
  function psiAutoRound(doc, isOn) {
    const win = doc.defaultView;
    const AR_KEY = VERSION;
    if (!win || win.__psiAutoRound === AR_KEY) return;
    try { win.__psiAutoRoundStop && win.__psiAutoRoundStop(); } catch (e) {}   // zastav staršiu verziu
    win.__psiAutoRound = AR_KEY;
    const done = new WeakSet();
    const MEDIA = /^(IMG|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA|CANVAS)$/;
    let timer = null;
    const pass = () => {
      timer = null;
      if (!isOn()) return;
      const vw = win.innerWidth || 1;
      const SEL = "div,a,button,img,video,input,select,textarea,section,li,form,canvas,span,label,ul,table,h1,h2,h3";
      let list;
      if (full) { list = doc.querySelectorAll(SEL); full = false; roots.clear(); }
      else { list = []; for (const r of roots) { if (r.isConnected) { if (r.matches(SEL)) list.push(r); list.push(...r.querySelectorAll(SEL)); } } roots.clear(); }
      for (const e of list) {
        if (done.has(e)) continue;
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;              // skryté – skúsime neskôr
        done.add(e);
        if (/border-radius/.test(e.getAttribute("style") || "") && !e.dataset.psiAr) {
          e.style.removeProperty("border-radius");          // zvyšok zo staršej verzie – prepočíta sa nižšie
        }
        if (r.width < 14 || r.height < 12 || r.width > vw * 0.97 || e.closest("svg")) continue;
        // veľké panely rozloženia (ľavý zoznam, oblasť obrázka hry…) nezaobľovať – robili „zuby“ pri hornej lište
        const vh = win.innerHeight || 1;
        if (r.height > vh * 0.45 || (r.width > vw * 0.6 && r.top < 140) || (r.top < 92 && r.height > 30)) {
          if (e.dataset.psiAr || /border-radius/.test(e.getAttribute("style") || "")) { e.style.removeProperty("border-radius"); delete e.dataset.psiAr; }
          continue;
        }
        if (e.closest(".ContextMenuPopupBody") && r.width > vw * 0.9) continue;
        const cs = win.getComputedStyle(e);
        // vnútorný diel karty (cez celú šírku zaobleného rodiča) – rohy oreže rodič, sám nezaobľovať
        let docked = false;
        for (let p = e.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) {
          const pr = p.getBoundingClientRect();
          if (win.getComputedStyle(p).borderTopLeftRadius !== "0px" && Math.abs(pr.left - r.left) < 2 && Math.abs(pr.right - r.right) < 2) { docked = true; break; }
        }
        if (docked) {
          if (e.dataset.psiAr) { e.style.removeProperty("border-radius"); delete e.dataset.psiAr; }
          continue;
        }
        if (cs.borderTopLeftRadius !== "0px" || (cs.display === "inline" && e.tagName === "SPAN")) continue;
        const bg = cs.backgroundColor;
        const visible = MEDIA.test(e.tagName) || (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") ||
          cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || cs.boxShadow !== "none";
        if (!visible) continue;
        const rad = Math.min(+THEME.radius || 12, Math.max(4, Math.round(Math.min(r.width, r.height) / 4)));
        e.style.setProperty("border-radius", rad + "px");
        e.dataset.psiAr = "1";
      }
    };
    const roots = new Set();
    let full = true;
    const schedule = () => { if (!timer) timer = win.setTimeout(pass, 450); };
    const mo = new win.MutationObserver(recs => {
      for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) roots.add(n);
      if (roots.size > 400) { roots.clear(); full = true; }
      schedule();
    });
    mo.observe(doc.documentElement, {childList: true, subtree: true});
    const onScroll = () => { full = true; schedule(); };      // pri posúvaní sa môžu objaviť skryté prvky
    win.addEventListener("scroll", onScroll, {passive: true, capture: true});
    win.__psiAutoRoundStop = () => { mo.disconnect(); win.removeEventListener("scroll", onScroll, {capture: true}); if (timer) win.clearTimeout(timer); };
    schedule();
  }


  /* ---------------- knižnica: NEW!! pri čerstvých novinkách, dúhový pruh achievementov ---------------- */
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const NEW_DAYS = 7, FADE_DAYS = 21, NEW_SINCE_PLAY_MAX = 30;
  function feedAge(text) {
    const t = text.trim().toLowerCase();
    if (/^(today|dnes)/.test(t)) return 0;
    if (/^(yesterday|včera)/.test(t)) return 1;
    const m = /^([a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(t);
    if (!m || MONTHS.indexOf(m[1]) < 0) return null;
    const now = new Date();
    let d = new Date(m[3] ? +m[3] : now.getFullYear(), MONTHS.indexOf(m[1]), +m[2]);
    if (!m[3] && d > now) d.setFullYear(d.getFullYear() - 1);
    return Math.floor((now - d) / 864e5);
  }
  const EXTRA_CSS = `
  @keyframes psiRainbow{0%{background-position:0% 50%}100%{background-position:200% 50%}}
  @keyframes psiPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
  .psi-rainbow{background:var(--psi-accent,#1a9fff)!important;animation:none!important;border-radius:99px!important;
    box-shadow:none!important}
  .psi-rainbow-track{border-radius:99px!important;overflow:hidden;background:rgba(0,0,0,.45)!important}
  /* pruh achievementov: 1. diel = výplň vo farbe témy, 2. diel = dráha */
  ._2YzOLNBx6TonKU0Zmp20l4:first-child:not(:only-child){background:var(--psi-accent,#1a9fff)!important;border-radius:99px 0 0 99px!important}
  ._2YzOLNBx6TonKU0Zmp20l4:last-child:not(:only-child){border-radius:0 99px 99px 0!important}
  .psi-newcard{position:relative;border-radius:var(--psi-radius,12px)!important;transition:box-shadow .3s}
  .psi-newbadge{position:absolute;top:10px;right:12px;z-index:5;padding:3px 10px;border-radius:99px;font:800 11px/1.4 "Motiva Sans",Arial,sans-serif;
    letter-spacing:.08em;color:var(--psi-text,#fff);text-shadow:0 1px 2px rgba(0,0,0,.4);pointer-events:none;
    background:linear-gradient(90deg,#ff3b3b,#ff9f1a,#ffe14d,#3ddc84,#22d3ee,#4f7cff,#b05cff,#ff3b3b);background-size:200% 100%;
    animation:psiRainbow 3s linear infinite,psiPulse 1.6s ease-in-out infinite;box-shadow:0 2px 10px rgba(0,0,0,.35)}`;
  let achScanT = 0;
  function libraryExtras() {
    if (!FEAT.rounded) return;
    const pop = window.g_PopupManager && g_PopupManager.m_mapPopups.get("SP Desktop_uid0");
    const doc = pop && pop.m_popup && pop.m_popup.document;
    if (!doc) return;
    if (!doc.getElementById("psi-extra")) { const st = doc.createElement("style"); st.id = "psi-extra"; st.textContent = EXTRA_CSS; doc.head.appendChild(st); }
    // noviny / aktualizácie – NEW!! = posledných 7 dní alebo od tvojho posledného hrania (max 30 dní)
    const loc = window.MainWindowBrowserManager && MainWindowBrowserManager.m_lastLocation;
    const am = loc && /^\/library\/app\/(\d+)/.exec(loc.pathname || "");
    let lastPlayed = 0;
    try { lastPlayed = am && window.appStore ? (appStore.GetAppOverviewByAppID(+am[1]) || {}).rt_last_time_played || 0 : 0; } catch (e) {}
    for (const h of doc.querySelectorAll("h4")) {
      if (h.dataset.psiAge !== undefined || !h.offsetParent) continue;
      const age = feedAge(h.textContent);
      h.dataset.psiAge = age == null ? "x" : String(age);
      if (age == null || age > FADE_DAYS) continue;
      const group = h.parentElement && h.parentElement.lastElementChild;
      if (!group || group === h) continue;
      let posts = [...group.querySelectorAll(".UVeN0kaD3zv1feMj_mMw5")];
      if (!posts.length) posts = [group];
      const a = Math.max(0, 1 - age / FADE_DAYS);                 // čím starší, tým slabší rámček
      const acc = THEME.accent || "#1a9fff";
      for (const post of posts) {
        // len obsah príspevku – riadok s komentármi/👍 (posledný potomok) ostane mimo rámčeka
        const card = post.children.length > 1 ? post.firstElementChild : post;
        card.classList.add("psi-newcard");
        const al = a * 0.55;                                       // tlmený jas
        card.style.boxShadow = `0 0 0 1px ${acc}${Math.round(al * 255).toString(16).padStart(2, "0")},` +
          `0 0 ${Math.round(6 + 10 * a)}px ${acc}${Math.round(al * 90).toString(16).padStart(2, "0")}`;
        card.querySelectorAll(".psi-newbadge").forEach(x => x.remove());
      }
    }
    // dúhový aj pruh sťahovania v lište hry
    for (const trk of doc.querySelectorAll("._25YVDTaClw6Y2COPsU0UaV")) {
      const f = trk.querySelector("._1FnTqlsi2_-TJf1d5apoS6") || trk.firstElementChild;
      if (f && !f.classList.contains("psi-rainbow")) { f.classList.add("psi-rainbow"); trk.classList.add("psi-rainbow-track"); }
    }
    // dúhový pruh achievementov
    let fills = [...doc.querySelectorAll("._3Rm36_oeAhvIg6ZYP9l1Jj:not(.psi-rainbow)")];
    if (!fills.length && Date.now() - achScanT > 4000) {          // záloha podľa textu „unlocked“
      achScanT = Date.now();
      const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) {
        if (!/unlocked|odomkn/i.test(n.textContent) || !n.parentElement.offsetParent) continue;
        let box = n.parentElement; for (let i = 0; i < 3 && box.parentElement; i++) box = box.parentElement;
        const bars = [...box.querySelectorAll("div")].filter(x => { const r = x.getBoundingClientRect(); return r.height > 3 && r.height < 14 && r.width > 4; });
        // výplň je diel s farbou pozadia (zvyšok dráhy je priehľadný)
        const fill = bars.find(x => { const c = getComputedStyle(x).backgroundColor; return c !== "rgba(0, 0, 0, 0)" && c !== "rgb(0, 0, 0)" && x.parentElement && x.parentElement.children.length > 1; });
        if (fill) fills.push(fill);
        break;
      }
    }
    for (const x of doc.querySelectorAll(".psi-rainbow")) {
      const sib = x.parentElement && [...x.parentElement.children];
      if (sib && sib.length > 1 && sib.indexOf(x) > 0 && sib[0].className === x.className.replace(" psi-rainbow", "")) {
        x.classList.remove("psi-rainbow");                   // zvyšok dráhy, nie výplň
        if (!sib[0].classList.contains("psi-rainbow")) fills.push(sib[0]);
      }
    }
    for (const f of fills) {
      if (f.classList.contains("psi-rainbow")) continue;
      f.classList.add("psi-rainbow");
      f.parentElement && f.parentElement.classList.add("psi-rainbow-track");
    }
  }


  /* ---------------- Stiahnuté: hlavička, dúhový pruh, čas / GB / voľné miesto ---------------- */
  const DL_CSS = `
  ._1VNuYHM6BPBOJspC6zPf5r:has(._2sCvZTD6ZTZz3p9_ekH_gI){background:transparent!important;height:auto!important;min-height:0!important;overflow:visible!important;padding:12px 30px 4px 16px!important}
  /* rodičia hlavičky mali pevnú výšku 200 px → spodok karty sa odrezal */
  ._21P7c4MWmsU2QSZeL-uyZo:has(._2sCvZTD6ZTZz3p9_ekH_gI),.OINnOU8K5HzPe2nzczpZi:has(._2sCvZTD6ZTZz3p9_ekH_gI),
  ._3Mbhnlk1Go2j8yCdjthzc7.IbePLaw-vSvhG1GTenYFg:has(._2sCvZTD6ZTZz3p9_ekH_gI),._373v1eWNyaPKhgnea9FZSt:has(._2sCvZTD6ZTZz3p9_ekH_gI),
  ._3Mbhnlk1Go2j8yCdjthzc7:has(._2sCvZTD6ZTZz3p9_ekH_gI){height:auto!important;min-height:0!important;max-height:none!important;flex:0 0 auto!important;overflow:visible!important}
  /* Up Next / Scheduled / … ako rovnaké sklenené karty */
  ._1ugNiylO2vKXhirsGocAxa > ._3Mbhnlk1Go2j8yCdjthzc7{margin:10px 16px!important;width:auto!important;padding:4px 0 12px!important;border-radius:var(--psi-radius,12px)!important;
    background:var(--psi-panel,rgba(18,28,44,.62))!important;border:1px solid rgba(255,255,255,.04)!important;box-sizing:border-box}
  ._1ugNiylO2vKXhirsGocAxa ._3ebCJiEl-ybizhZ4avcFw5{margin:4px 12px!important;border-radius:calc(var(--psi-radius,12px) - 2px)!important;background:rgba(255,255,255,.045)!important;overflow:hidden!important}
  ._1ugNiylO2vKXhirsGocAxa ._3ebCJiEl-ybizhZ4avcFw5 *{background-color:transparent}
  ._1ugNiylO2vKXhirsGocAxa ._3ebCJiEl-ybizhZ4avcFw5 img{border-radius:8px!important}
  ._2sCvZTD6ZTZz3p9_ekH_gI{position:relative!important;width:100%!important;box-sizing:border-box;border-radius:var(--psi-radius,12px)!important;
    overflow:hidden!important;background:var(--psi-panel,rgba(18,28,44,.62))!important;border:1px solid rgba(255,255,255,.04)}
  ._3WauYi7bNDSGIogMLPVYES{-webkit-mask-image:linear-gradient(to right,#000 35%,transparent 92%),linear-gradient(to bottom,transparent 0%,#000 22%,#000 62%,transparent 100%)!important;
    -webkit-mask-composite:source-in!important;mask-image:linear-gradient(to right,#000 35%,transparent 92%),linear-gradient(to bottom,transparent 0%,#000 22%,#000 62%,transparent 100%)!important;mask-composite:intersect!important}
  ._25YVDTaClw6Y2COPsU0UaV{height:7px!important;border-radius:99px!important}
  /* pozadie stránky odvodené z farby témy (predtým sivé Steam pozadie → „bahnité“ karty) */
  ._1bq4x9pa4-9RLY-dXWUZTp:has(._2sCvZTD6ZTZz3p9_ekH_gI),._2Dd4T78PcCTUVgOtDGFY5j:has(._2sCvZTD6ZTZz3p9_ekH_gI){
    background:radial-gradient(1200px 500px at 15% 0%,color-mix(in srgb,var(--psi-accent,#1a9fff) 9%,transparent),transparent 70%),
      var(--psi-bg)!important}
  ._1ugNiylO2vKXhirsGocAxa ._3ebCJiEl-ybizhZ4avcFw5{background:color-mix(in srgb,var(--psi-panel-solid,#121c2c) 70%,#ffffff 6%)!important}
  /* graf siete: jemne mizne k okrajom karty */
  ._2-AUyaXfJHWP85tZVENytR{-webkit-mask-image:linear-gradient(to right,transparent,#000 12%,#000 88%,transparent),linear-gradient(to top,transparent,#000 30%);
    -webkit-mask-composite:source-in;mask-image:linear-gradient(to right,transparent,#000 12%,#000 88%,transparent),linear-gradient(to top,transparent,#000 30%);mask-composite:intersect}
  #psi-dlinfo{display:grid;grid-template-columns:auto auto;gap:3px 16px;margin-top:8px;font-size:11.5px;color:var(--psi-mut,#8b929a);white-space:nowrap}
  #psi-dlinfo b{color:var(--psi-text2,#dcdedf);font-weight:600}`;
  const fmtGB = b => b == null ? "?" : b >= 1e12 ? (b / 1e12).toFixed(2) + " TB" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : (b / 1e6).toFixed(0) + " MB";
  const fmtETA = s => s == null || s < 0 ? "?" : s < 60 ? "< 1 min" : s < 3600 ? Math.round(s / 60) + " min" : Math.floor(s / 3600) + " h " + Math.round((s % 3600) / 60) + " min";
  const diskCache = {};
  window.__psiDownloadsExtras = () => downloadsExtras();
  function downloadsExtras() {
    if (!FEAT.rounded) return;
    const loc = window.MainWindowBrowserManager && MainWindowBrowserManager.m_lastLocation;
    if (!loc || !/^\/library\/downloads/.test(loc.pathname || "")) return;
    const doc = g_PopupManager.m_mapPopups.get("SP Desktop_uid0").m_popup.document;
    if (!doc.getElementById("psi-dl")) { const st = doc.createElement("style"); st.id = "psi-dl"; st.textContent = DL_CSS; doc.head.appendChild(st); }
    for (const trk of doc.querySelectorAll("._25YVDTaClw6Y2COPsU0UaV")) {        // všetky pruhy (hlavný aj v riadkoch)
      const f = trk.querySelector("._1FnTqlsi2_-TJf1d5apoS6") || trk.firstElementChild;
      if (f && !f.classList.contains("psi-rainbow")) { f.classList.add("psi-rainbow"); trk.classList.add("psi-rainbow-track"); }
    }
    const track = doc.querySelector("._25YVDTaClw6Y2COPsU0UaV");
    if (!track) return;
    // aktuálne sťahovaná položka
    const ds = window.downloadsStore;
    let lists = ds && ds.m_DownloadItems;
    lists = lists && typeof lists.values === "function" ? [...lists.values()] : lists ? Object.values(lists) : [];
    const items = lists.flat ? lists.flat() : [].concat(...lists);
    const it = items.find(x => x && x.active) || items.find(x => x && x.queue_index === 0);
    let info = doc.getElementById("psi-dlinfo");
    if (!it) { info && info.remove(); return; }
    const ut = (it.update_type_info || []).find(u => u.has_update) || {};
    const pr = ut.progress || [];
    const dl = pr[2] && pr[2].bytes_total ? pr[2] : pr.reduce((a, b) => (b.bytes_total > (a ? a.bytes_total : 0) ? b : a), null) || {};
    const need = Math.max(0, ...pr.map(p => p.bytes_total || 0));
    let ovw = ds.m_DownloadOverview; ovw = ovw && typeof ovw.values === "function" ? [...ovw.values()][0] : ovw && Object.values(ovw)[0];
    const speed = ovw && ovw.update_network_bytes_per_second;
    const paused = !it.active || (ovw && ovw.paused);
    const eta = ut.overall_estimated_time_remaining_sec;
    const appid = it.appid;
    const dc = diskCache[appid];
    if (!dc || Date.now() - dc.t > 30000) {
      diskCache[appid] = {t: Date.now(), v: dc && dc.v};
      call("disk", {appid}).then(v => { diskCache[appid] = {t: Date.now(), v}; }).catch(() => {});
    }
    const disk = diskCache[appid] && diskCache[appid].v;
    const enough = disk && disk.free != null ? disk.free > Math.max(0, need - (dl.bytes_in_progress || 0)) : null;
    const html = `<span>${tr("Stiahnuté", "Downloaded")} <b>${fmtGB(dl.bytes_in_progress)}</b> ${tr("z", "of")} <b>${fmtGB(dl.bytes_total)}</b></span>` +
      `<span>${tr("Zostáva", "Left")} <b>~ ${fmtETA(eta)}</b>${paused ? tr(" (pri poslednej rýchlosti)", " (at the last speed)") : speed ? ` · ${fmtGB(speed)}/s` : ""}</span>` +
      (need ? `<span>Hra zaberie <b>${fmtGB(need)}</b></span>` : "") +
      (disk && disk.free != null ? `<span>${tr("Voľné na disku", "Free disk space")} <b style="color:${enough === false ? "#f87171" : "#dcdedf"}">${fmtGB(disk.free)}</b>${enough === false ? tr(" – nestačí!", " – not enough!") : ""}</span>` : "");
    if (!info) { info = doc.createElement("div"); info.id = "psi-dlinfo"; track.insertAdjacentElement("afterend", info); }
    if (info.innerHTML !== html) info.innerHTML = html;
  }


  /* poistka: Steam na Linuxe po obnovení okna niekedy nechá vnútro okna malé (napr. 600×113)
     a hlavný kontajner posunutý – zvyšok okna je čierny. PSI to samo opraví. */
  let fixingWindow = false;
  // ľavý okraj pravého panelu knižnice → podľa neho centrujeme Scroll to top
  function syncLibLeft(w) {
    const rp = w.document.querySelector("._3BFcmjAaMyP6GTPwc0VyWi");
    const x = rp ? Math.max(0, Math.round(rp.getBoundingClientRect().left)) : 0;
    const v = x + "px", st = w.document.documentElement.style;
    if (st.getPropertyValue("--psi-lib-left") !== v) st.setProperty("--psi-lib-left", v);
  }
  {
    const pop = window.g_PopupManager && g_PopupManager.m_mapPopups.get("SP Desktop_uid0");
    const w = pop && pop.m_popup;
    if (w) {
      let pend = false;
      const onScroll = () => { if (pend) return; pend = true; w.requestAnimationFrame(() => { pend = false; syncLibLeft(w); }); };
      w.document.addEventListener("scroll", onScroll, true);
      window.__psiScrollOff = () => { try { w.document.removeEventListener("scroll", onScroll, true); } catch (e) {} };
    }
  }
  async function windowWatchdog() {
    const pop = window.g_PopupManager && g_PopupManager.m_mapPopups.get("SP Desktop_uid0");
    const w = pop && pop.m_popup;
    if (!w || fixingWindow || w.document.hidden) return;
    syncLibLeft(w);
    const tooSmall = w.outerHeight > 300 && w.innerHeight < w.outerHeight * 0.6;
    if (tooSmall) {
      fixingWindow = true;
      try {
        const sw = (w.SteamClient && w.SteamClient.Window) || SteamClient.Window;
        const W = w.outerWidth, H = w.outerHeight;
        sw.ResizeTo(W - 60, H - 60, true);
        await new Promise(r => setTimeout(r, 900));
        sw.ResizeTo(W, H, true);
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {}
      fixingWindow = false;
    }
    // hlavné rozloženie sa nemá posúvať – ak je posunuté, vrátime ho
    for (const e of w.document.querySelectorAll("body > div, body > div > div, body > div > div > div")) {
      if (!e.scrollTop) continue;
      const r = e.getBoundingClientRect();
      if (r.width > w.innerWidth * 0.9 && r.height > w.innerHeight * 0.6) e.scrollTop = 0;
    }
  }

  /* ---------------- vlastné CSS (Nastavenia → PSI) ---------------- */
  let CUSTOM_CSS = "";
  async function refreshCustom() { try { CUSTOM_CSS = (await call("custom_css")).css || ""; } catch (e) {} }
  function applyCustom(doc) {
    let st = doc.getElementById("psi-custom");
    if (!CUSTOM_CSS) { st && st.remove(); return; }
    if (!st) { st = doc.createElement("style"); st.id = "psi-custom"; (doc.head || doc.documentElement).appendChild(st); }
    if (st.textContent !== CUSTOM_CSS) st.textContent = CUSTOM_CSS;
    st.parentNode.appendChild(st);                      // vždy posledný → má prednosť
  }

  /* ---------------- Millennium téma (len CSS, bez JavaScriptu) ---------------- */
  let MILL = [];
  async function refreshMillennium() { try { MILL = await call("millennium_patches"); } catch (e) { MILL = []; } }
  function applyMillennium(doc, title) {
    // Millennium vyberá okno podľa názvu, alebo podľa triedy (vzor začína bodkou, napr. „.ModalDialogPopup“)
    const byClass = rx => { try { return /^\.[\w-]+$/.test(rx) && !!doc.querySelector(`html${rx}, body${rx}, body > ${rx}, body > * > ${rx}`); } catch (e) { return false; } };
    const css = MILL.filter(p => { try { return new RegExp(p.re).test(title || "") || byClass(p.re); } catch (e) { return byClass(p.re); } }).map(p => p.css).join("\n");
    let st = doc.getElementById("psi-millennium");
    if (!css) { st && st.remove(); return; }
    if (!st) { st = doc.createElement("style"); st.id = "psi-millennium"; (doc.head || doc.documentElement).appendChild(st); }
    if (st.textContent !== css) st.textContent = css;
  }

  /* ---------------- vlastné písmo ---------------- */
  const FONT = {key: null, css: ""};
  async function refreshFont() {
    try {
      const f = await call("fonts");
      const key = (f.current || "") + "|" + (f.custom || "");
      if (key === FONT.key) return;
      FONT.key = key;
      if (!f.current) { FONT.css = ""; return; }
      const c = await call("font_css");
      FONT.css = `${c.face}
      *:not(svg):not(svg *):not(code):not(pre):not(kbd){font-family:"${c.family}","Motiva Sans",Arial,sans-serif!important}`;
    } catch (e) {}
  }
  function applyFont(doc) {
    let st = doc.getElementById("psi-font");
    if (!FONT.css) { st && st.remove(); return; }
    if (!st) { st = doc.createElement("style"); st.id = "psi-font"; (doc.head || doc.documentElement).appendChild(st); }
    if (st.textContent !== FONT.css) st.textContent = FONT.css;
  }

  /* ---------------- hľadanie okna Nastavení ---------------- */
  function scan() {
    try {
      const pm = window.g_PopupManager;
      if (!pm || !pm.m_mapPopups) return;
      for (const p of pm.m_mapPopups.values()) {
        const doc = p.m_popup && p.m_popup.document;
        if (doc) { applyRounded(doc); applyFont(doc); applyMillennium(doc, p.m_strTitle); applyCustom(doc); psiAutoRound(doc, () => FEAT.rounded); }
        if (doc && doc.querySelector('.PageListColumn [role="tablist"] [id*="/settings/"]')) attachSettings(doc);
      }
    } catch (e) { /* Steam UI sa mení – skúsime znova */ }
  }
  let active = true;
  try { window.g_PopupManager && window.g_PopupManager.AddPopupCreatedCallback && window.g_PopupManager.AddPopupCreatedCallback(() => { if (active) { setTimeout(scan, 0); setTimeout(scan, 120); } }); } catch (e) {}
  refreshFeatures().then(() => { scan(); setTimeout(() => syncCollections(true), 5000); });
  const colTimer = setInterval(() => syncCollections(), 15 * 60e3);
  setTimeout(exportLibrary, 4000);
  const libExportTimer = setInterval(exportLibrary, 30 * 60e3);
  const featTimer = setInterval(refreshFeatures, 4000);
  const timer = setInterval(scan, 1500);
  const libTimer = setInterval(libraryTick, 500);
  const extraTimer = setInterval(() => { try { libraryExtras(); } catch (e) {} try { downloadsExtras(); } catch (e) {} }, 800);
  const wdTimer = setInterval(() => { windowWatchdog().catch(() => {}); }, 2000);
  window.__psiCleanup = () => {
    active = false;
    try { window.__psiScrollOff && window.__psiScrollOff(); } catch (e) {}
    clearInterval(timer);
    clearInterval(featTimer);
    clearInterval(colTimer);
    clearInterval(libExportTimer);
    clearInterval(libTimer);
    clearInterval(extraTimer);
    clearInterval(wdTimer);
    for (const p of (window.g_PopupManager && g_PopupManager.m_mapPopups ? g_PopupManager.m_mapPopups.values() : [])) {
      const doc = p.m_popup && p.m_popup.document;
      if (!doc) continue;
      const panel = doc.getElementById("psi-settings");
      if (panel) { [...panel.parentElement.children].forEach(ch => { ch.style.display = ""; }); panel.remove(); }
      ["psi-tab", "psi-sep", "psi-style", "psi-lib", "psi-round", "psi-font", "psi-theme", "psi-extra", "psi-dl", "psi-dlinfo", "psi-millennium", "psi-custom"].forEach(id => { const e = doc.getElementById(id); e && e.remove(); });
      doc.querySelectorAll(".psi-lib, .psi-libcard").forEach(e => e.remove());
    }
  };
  // prvá verzia nemala __psiCleanup – jej prvky odstránime tu, nová verzia ich hneď nahradí
  for (const p of (window.g_PopupManager && g_PopupManager.m_mapPopups ? g_PopupManager.m_mapPopups.values() : [])) {
    const doc = p.m_popup && p.m_popup.document;
    if (!doc) continue;
    const panel = doc.getElementById("psi-settings");
    if (panel) { [...panel.parentElement.children].forEach(ch => { ch.style.display = ""; }); panel.remove(); }
    ["psi-tab", "psi-sep", "psi-style", "psi-lib"].forEach(id => { const e = doc.getElementById(id); e && e.remove(); });
  }
  scan();
})();
