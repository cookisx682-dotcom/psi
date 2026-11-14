/* PSI – Steam obchod (store.steampowered.com/app/<id>):
 * ProtonDB medaila, živý odpočet konca zľavy, odhad zľavy a odporúčanie kúp/počkaj. */
(function () {
  "use strict";
  /* most – spoločný pre store.js aj community.js */
  if (!window.__psiCall) {
    const pending = new Map(); let seq = 0;
    window.__psiReply = (id, r) => { const p = pending.get(id); if (!p) return; pending.delete(id); r && r.ok ? p.res(r.result) : p.rej(new Error((r && r.error) || "PSI")); };
    window.__psiCall = (method, params = {}) => new Promise((res, rej) => {
      if (typeof window.__psiBridge !== "function") return rej(new Error("bridge"));
      const id = ++seq; pending.set(id, {res, rej});
      window.__psiBridge(JSON.stringify({id, method, params}));
      setTimeout(() => pending.delete(id) && rej(new Error("timeout")), 60000);
    });
  }

  /* zaoblené rohy na webe obchodu a komunity */
  const ROUND_WEB = `
  .game_area_purchase_game,.game_area_purchase_game_wrapper .game_area_purchase_game,.block,.game_area_description,.DRM_notice,
  .game_area_already_owned,.review_box,.glance_ctn,.game_header_image_full,.responsive_apppage_details_right,.game_meta_data .block,
  .dlc_page_purchase_dlc_list_block,.game_area_dlc_section,.franchise_notice,.early_access_banner,.queue_overflow_ctn,
  .tab_item,.search_result_row,.store_main_capsule,.home_area_spotlight,.special_tiny_cap,.store_capsule,.carousel_items .store_capsule,
  .home_page_content .home_tabs_row,.profile_customization,.showcase_content_bg,.profile_header_badge,.profile_count_link_preview,
  .responsive_status_info,.profile_leftcol .profile_customization .profile_customization_header,.apphub_Card,.apphub_HeaderTop,
  .game_review_summary_ctn,.user_reviews_filter_bar,.review_histogram_section,.leftcol .game_area_details_specs_ctn{border-radius:10px}
  .game_header_image_full,.store_main_capsule,.tab_item,.special_tiny_cap,.store_capsule,.profile_customization,
  .apphub_Card,.home_area_spotlight,.block,.highlight_ctn{overflow:hidden}
  .highlight_ctn{border-radius:12px}
  #highlight_player_area,.highlight_player_item,.highlight_movie,.highlight_screenshot{border-radius:12px;overflow:hidden}
  .highlight_strip_item,.highlight_strip_screenshot img,.highlight_strip_movie img{border-radius:6px;overflow:hidden}
  [class^="btn_"],[class*=" btn_"],.btnv6_blue_hoverfade,.btnv6_green_white_innerfade,.btnv6_white_transparent,.btn_addtocart > a,
  .game_purchase_action_bg,.discount_block,.discount_block .discount_pct,.discount_final_price,.game_purchase_price,
  .queue_btn_follow,.queue_btn_ignore,.queue_btn_menu,.btn_profile_action,.playerAvatar,.playerAvatar img,.playerAvatar .profile_avatar_frame img,
  #store_nav_search_term,.searchbox,.store_nav,.store_nav .tab,.store_nav_bg,.app_tag,.game_area_details_spec,.inventory_item_link{border-radius:8px}
  .discount_block,.game_purchase_action_bg,.store_nav{overflow:hidden}
  .app_tag{border-radius:12px;padding:0 9px}
  #psi-store .game_area_purchase_game{border-radius:12px}
  /* nový React obchod (2026): stabilné atribúty namiesto generovaných tried */
  [role="navigation"][aria-label="Store menu"]{border-radius:10px}
  [role="navigation"][aria-label="Store menu"] > *{border-radius:10px}
  form[role="search"]{border-radius:10px!important;overflow:hidden;border-color:rgba(255,255,255,.06)!important}
  form[role="search"] *,[role="navigation"][aria-label="Store menu"] form[role="search"] button{border-radius:0!important}
  form[role="search"] input{border:0!important;box-shadow:none!important}
  .gamehighlight_desktopcarousel .responsive_menu_ignore_touch,.gamehighlight_desktopcarousel video{border-radius:12px;overflow:hidden}
  .gamehighlight_desktopcarousel div:has(> img){border-radius:8px}
  .gamehighlight_desktopcarousel img{border-radius:8px}
  .game_header_image_ctn,.game_header_image_full{border-radius:10px;overflow:hidden}
  [class*="Button"],a.btnv6_blue_hoverfade,button[class]{border-radius:8px}
  /* posuvník a šípky pod náhľadmi */
  .gamehighlight_desktopcarousel div{border-radius:8px!important}
  /* obrázok hry vpravo: plynulo zmizne do popisu */
  #game_highlights .game_header_image_full{-webkit-mask-image:linear-gradient(to bottom,#000 55%,rgba(0,0,0,.5) 80%,transparent 100%);
    mask-image:linear-gradient(to bottom,#000 55%,rgba(0,0,0,.5) 80%,transparent 100%)}
  /* lišta fronty (Follow / Ignore / View Your Queue) */
  .queue_ctn,.queue_actions_ctn{border-radius:12px}
  /* ---- jednotné pozadie blokov (rovnaký tón, jemné sklo) ---- */
  .game_area_purchase_game,.rightcol .block,.leftcol .block,.queue_ctn,.review_box,.user_reviews_summary_bar,
  .game_area_dlc_section,.dlc_page_purchase_dlc_list_block,.game_meta_data .block,.franchise_notice,.DRM_notice,
  .game_area_already_owned,.early_access_banner{
    background:rgba(18,28,44,.62)!important;border:1px solid rgba(255,255,255,.035)!important;
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:12px}
  .rightcol .block .block_title,.rightcol .block .block_content,.rightcol .block .block_content_inner,
  .game_area_purchase_game .game_area_purchase_platform,.queue_actions_ctn{background:transparent!important}
  #game_highlights::before{background:rgba(18,28,44,.62)!important}
  #game_highlights .rightcol .glance_ctn{background:transparent!important;box-shadow:none!important;border:0!important;
    position:relative;isolation:isolate;overflow:visible}
  #game_highlights .rightcol .glance_ctn::before{content:"";position:absolute;inset:-12px -12px -12px;z-index:-1;pointer-events:none;
    background:rgba(10,18,30,.42);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    -webkit-mask-image:linear-gradient(to right,transparent,#000 22px,#000 calc(100% - 22px),transparent),linear-gradient(to bottom,transparent,#000 22px,#000 calc(100% - 22px),transparent);
    -webkit-mask-composite:source-in;mask-image:linear-gradient(to right,transparent,#000 22px,#000 calc(100% - 22px),transparent),linear-gradient(to bottom,transparent,#000 22px,#000 calc(100% - 22px),transparent);
    mask-composite:intersect}
  /* jedna sklenená karta okolo videa, náhľadov a pravého stĺpca */
  #game_highlights{position:relative;isolation:isolate}
  #game_highlights::before{content:"";position:absolute;inset:-16px -16px -14px;z-index:-1;border-radius:20px;pointer-events:none;
    background:linear-gradient(135deg,rgba(62,98,128,.38),rgba(27,40,56,.30) 55%,rgba(42,71,94,.34));
    backdrop-filter:blur(14px) saturate(1.25);-webkit-backdrop-filter:blur(14px) saturate(1.25);
    border:0;box-shadow:0 14px 44px rgba(0,0,0,.35)}
  #game_highlights .rightcol{padding-left:4px}
  /* nákupné bloky: cena, Add to Cart, View Info */
  .game_area_purchase_game{border-radius:12px}
  .game_purchase_action_bg{border-radius:10px!important;overflow:hidden}
  .game_purchase_action .btn_addtocart,.game_purchase_action .btn_addtocart a,.game_purchase_action a,.game_purchase_price,
  .discount_block,.discount_pct,.discount_prices,.game_purchase_action_bg > div{border-radius:8px!important}
  .game_area_purchase_game .package_contents img,.game_area_purchase_game img{border-radius:6px}
  /* horný panel obchodu: Cart, Wishlist, menu */
  [role="navigation"][aria-label="Store menu"] a,[role="navigation"][aria-label="Store menu"] button{border-radius:8px!important}
  /* horný panel obchodu: priehľadné zaoblené sklo namiesto pruhu cez celú šírku */
  :has(> [role="navigation"][aria-label="Store menu"]){background:rgba(18,28,44,.42)!important;
    backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);
    border-radius:14px!important;margin:6px 16px 0!important;border:1px solid rgba(255,255,255,.05)!important;
    box-shadow:0 8px 28px rgba(0,0,0,.28)!important}
  [role="navigation"][aria-label="Store menu"],[role="navigation"][aria-label="Store menu"] > *{background-color:transparent!important}
  form[role="search"]{background:rgba(255,255,255,.08)!important}
  #game_highlights .game_header_image_full{border-radius:12px}`;
  /* ---------------- automatické zaoblenie všetkého viditeľného ---------------- */
  // Každý prvok s pozadím, rámikom, tieňom alebo obrázok/tlačidlo dostane zaoblené rohy.
  // Preskočí: SVG, prvky cez celú šírku okna, malé ikonky a prvky, ktoré už zaoblené sú.
  function psiAutoRound(doc, isOn) {
    const win = doc.defaultView;
    if (!win || win.__psiAutoRound) return;
    win.__psiAutoRound = true;
    const done = new WeakSet();
    const MEDIA = /^(IMG|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA|CANVAS)$/;
    let timer = null;
    const pass = () => {
      timer = null;
      if (!isOn()) return;
      const vw = win.innerWidth || 1;
      for (const e of doc.querySelectorAll("div,a,button,img,video,input,select,textarea,section,li,form,canvas,span,label,ul,table,h1,h2,h3")) {
        if (done.has(e)) continue;
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;              // skryté – skúsime neskôr
        done.add(e);
        if (r.width < 14 || r.height < 12 || r.width > vw * 0.97 || e.closest("svg")) continue;
        if (e.closest(".ContextMenuPopupBody") && r.width > vw * 0.9) continue;
        const cs = win.getComputedStyle(e);
        if (cs.borderTopLeftRadius !== "0px" || (cs.display === "inline" && e.tagName === "SPAN")) continue;
        const bg = cs.backgroundColor;
        const visible = MEDIA.test(e.tagName) || (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") ||
          cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || cs.boxShadow !== "none";
        if (!visible) continue;
        const rad = Math.min(window.__psiRadius || 12, Math.max(4, Math.round(Math.min(r.width, r.height) / 4)));
        e.style.setProperty("border-radius", rad + "px");
      }
    };
    const schedule = () => { if (!timer) timer = win.setTimeout(pass, 450); };
    new win.MutationObserver(schedule).observe(doc.documentElement, {childList: true, subtree: true});
    win.addEventListener("scroll", schedule, {passive: true});
    schedule();
  }
  /* ---------------- vlastná téma (Nastavenia → PSI → Vzhľad) ---------------- */
  function psiThemeCss(t, where) {
    const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0).join(",");
    const P = `rgba(${rgb(t.panel)},${t.opacity})`, A = t.accent, B = `${t.blur}px`, R = `${t.radius}px`;
    const glass = `background:${P}!important;backdrop-filter:blur(${B})!important;-webkit-backdrop-filter:blur(${B})!important;border-radius:${R}!important`;
    const vars = `:root{--psi-accent:${A};--psi-panel:${P};--psi-blur:${B};--psi-radius:${R}}`;
    if (where === "web") return vars + `
  .game_area_purchase_game,.rightcol .block,.leftcol .block,.queue_ctn,.review_box,.user_reviews_summary_bar,.game_area_dlc_section,
  .dlc_page_purchase_dlc_list_block,.game_meta_data .block,.franchise_notice,.DRM_notice,.game_area_already_owned,.early_access_banner,
  .profile_customization{${glass}}
  #game_highlights::before{background:${P}!important;backdrop-filter:blur(${B})!important;border-radius:calc(${R} + 8px)!important}
  :has(> [role="navigation"][aria-label="Store menu"]){background:rgba(${rgb(t.panel)},${Math.max(0.12, t.opacity - 0.2)})!important;
    backdrop-filter:blur(calc(${B} + 6px)) saturate(1.3)!important;border-radius:calc(${R} + 2px)!important}
  form[role="search"]{border-radius:${R}!important}
  form[role="search"] button,[role="navigation"][aria-label="Store menu"] a[href*="/cart"],.btn_blue_steamui,.btnv6_blue_blue_innerfade{background:${A}!important}`;
    return vars + `
  .psi-libcard{${glass};border:1px solid rgba(255,255,255,.04)!important}
  .psi-pcard{border-radius:calc(${R} - 2px)!important}
  #psi-settings .psi-card{${glass}}
  #psi-settings .psi-sw.on{background:${A}!important;box-shadow:0 0 12px ${A}66!important}
  .DialogButton.Primary,._3ydigb6zZAjJ0JCDgHwSYA,._2Szzh5sKyGgnLUR870zbDE._5wILZhsLODVwGfcJ0hKmJ{background:${A}!important}
  ._1FnJ6dPuknQFQ2RTpKTI16,._2r4TK4BAuU-J4FuF_O7v_5{border-radius:${R}!important}`;
  }

  /* štýl vložený čo najskôr – aj keď ešte neexistuje <head> */
  function addStyle(id, css) {
    const put = () => {
      const ex = document.getElementById(id);
      if (ex) { if (ex.textContent !== css) ex.textContent = css; return true; }
      const root = document.head || document.documentElement;
      if (!root) return false;
      const st = document.createElement("style"); st.id = id; st.textContent = css; root.appendChild(st);
      return true;
    };
    if (!put()) { const mo = new MutationObserver(() => { if (put()) mo.disconnect(); }); mo.observe(document, {childList: true, subtree: true}); }
  }
  window.__psiApplyTheme = t => { if (!t) return; window.__psiRadius = +t.radius || 12; addStyle("psi-theme", psiThemeCss(t, "web")); };
  const applyFont = c => { if (c && c.family) addStyle("psi-font", c.face + `*:not(svg):not(svg *):not(code):not(pre){font-family:"${c.family}","Motiva Sans",Arial,sans-serif!important}`); };
  const applyLook = (f, t) => {
    if (f.rounded === false) return;
    addStyle("psi-round", ROUND_WEB);
    window.__psiApplyTheme(t);
    const startAuto = () => psiAutoRound(document, () => true);
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", startAuto) : startAuto();
  };
  const BOOT = window.__PSI_BOOT || null;
  if (BOOT) {                                   // okamžite – údaje vložila služba spolu so skriptom
    applyLook(BOOT.features || {}, BOOT.theme || {});
    applyFont(BOOT.font);
  } else {                                      // záloha: cez most
    Promise.all([window.__psiCall("features"), window.__psiCall("theme")]).then(([f, t]) => applyLook(f, t)).catch(() => {});
    window.__psiCall("font_css").then(applyFont).catch(() => {});
  }

  /* modálne okno „hra na Linuxe nemusí ísť“ – spoločné pre stránku hry aj wishlist */
  function psiBuyModal(reasons, onYes) {
    const e = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center";
    ov.innerHTML = `<div style="max-width:460px;background:#1e2a38;border:1px solid #d94126;border-radius:12px;padding:22px 24px;color:#c6d4df;font:14px/1.5 'Motiva Sans',Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="font-size:19px;color:#fff;margin-bottom:10px">⚠ Táto hra na Linuxe nemusí ísť</div>
      ${reasons.map(r => `<div style="margin:4px 0">✕ ${e(r)}</div>`).join("")}
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
        <a class="psi-no" style="cursor:pointer;padding:0 14px;line-height:30px;border-radius:8px;color:#67c1f5;background:rgba(103,193,245,.2)">Zrušiť</a>
        <a class="psi-yes" style="cursor:pointer;padding:0 14px;line-height:30px;border-radius:8px;color:#d2efa9;background:linear-gradient(to right,#75b022 5%,#588a1b 95%)">Aj tak pokračovať</a>
      </div><div style="font-size:11px;color:#56707f;margin-top:10px">PSI · ProtonDB, AreWeAntiCheatYet</div></div>`;
    document.body.appendChild(ov);
    ov.querySelector(".psi-no").onclick = () => ov.remove();
    ov.addEventListener("click", ev => { if (ev.target === ov) ov.remove(); });
    ov.querySelector(".psi-yes").onclick = () => { ov.remove(); onYes(); };
  }
  function psiReasons(d) {
    const r = [];
    if (!d.native && d.tier === "borked") r.push("Podľa ProtonDB sa na Linuxe nespustí (Borked).");
    if (d.ac === "Denied" || d.ac === "Broken") r.push(`${(d.anticheats || []).join(", ")} – do online hier ťa na Linuxe nepustí.`);
    return r;
  }
  /* ---------------- wishlist: odznaky ProtonDB a anti-cheat ---------------- */
  if (location.hostname === "store.steampowered.com" && /^\/wishlist/.test(location.pathname) && !window.__psiWishlist) {
    window.__psiWishlist = true;
    const WL_T = {native: ["#008000", "#fff", "Natívne"], platinum: ["#b4c7dc", "#14161b", "Platinum"], gold: ["#cfb53b", "#14161b", "Gold"],
      silver: ["#a6a6a6", "#14161b", "Silver"], bronze: ["#cd7f32", "#14161b", "Bronze"], borked: ["#e02424", "#fff", "Borked"], pending: ["#444b5e", "#dfe3ee", "?"]};
    const known = new Map();
    let busy = false, on = null;
    const pill = (bg, fg, txt, title) => `<span title="${title}" style="display:inline-block;padding:3px 8px;border-radius:6px;background:${bg};color:${fg};font:600 11px/1.2 'Motiva Sans',Arial,sans-serif;letter-spacing:.04em;box-shadow:0 2px 6px rgba(0,0,0,.5)">${txt}</span>`;
    async function tick() {
      if (busy) return;
      if (on === null) { try { const f = await window.__psiCall("features"); on = f.store !== false; } catch (e) { on = true; } }
      if (!on) return;
      const items = [...document.querySelectorAll('[data-rfd-draggable-id^="WishlistItem-"]')].filter(el => !el.querySelector(".psi-wl"));
      if (!items.length) return;
      const ids = items.map(el => +(/WishlistItem-(\d+)/.exec(el.dataset.rfdDraggableId) || [])[1]).filter(Boolean);
      const need = ids.filter(a => !known.has(a));
      busy = true;
      try {
        if (need.length) { const r = await window.__psiCall("tiers", {appids: need}); for (const [k, v] of Object.entries(r)) known.set(+k, v); }
      } catch (e) { busy = false; return; }
      busy = false;
      for (const el of items) {
        const appid = +(/WishlistItem-(\d+)/.exec(el.dataset.rfdDraggableId) || [])[1];
        const d = known.get(appid), link = el.querySelector('a[href*="/app/"]');
        if (!d || !link || el.querySelector(".psi-wl")) continue;
        const [bg, fg, label] = WL_T[d.native ? "native" : d.tier] || WL_T.pending;
        const bad = d.ac === "Denied" || d.ac === "Broken";
        const box = document.createElement("div");
        box.className = "psi-wl";
        box.style.cssText = "position:absolute;left:6px;bottom:6px;display:flex;gap:4px;flex-wrap:wrap;z-index:3;pointer-events:none";
        box.innerHTML = pill(bg, fg, label, "ProtonDB") + (bad ? pill("#d94126", "#fff", "⊘ Online nepôjde", (d.anticheats || []).join(", ")) : "")
          + (d.deck === 3 ? pill("rgba(23,26,33,.85)", "#59bf40", "Deck ✓", "Steam Deck overené") : "");
        if (getComputedStyle(link).position === "static") link.style.position = "relative";
        link.appendChild(box);
      }
    }
    let allowedWl = false, guardOn = null;
    window.__psiCall("features").then(f => { guardOn = f.buy_warning !== false; }).catch(() => { guardOn = true; });
    document.addEventListener("click", e => {
      if (allowedWl || !guardOn) return;
      const btn = e.target.closest("a, button");
      const item = btn && btn.closest('[data-rfd-draggable-id^="WishlistItem-"]');
      if (!item || !/add to cart|do košíka|buy|kúpiť/i.test(btn.textContent || "")) return;
      const d = known.get(+(/WishlistItem-(\d+)/.exec(item.dataset.rfdDraggableId) || [])[1]);
      const reasons = d ? psiReasons(d) : [];
      if (!reasons.length) return;
      e.preventDefault(); e.stopImmediatePropagation();
      psiBuyModal(reasons, () => { allowedWl = true; btn.click(); allowedWl = false; });
    }, true);
    setInterval(tick, 1200);
    tick();
  }
  if (location.hostname !== "store.steampowered.com") return;
  const m = location.pathname.match(/^\/app\/(\d+)/);
  if (!m || window.__psiStore === m[1]) return;
  window.__psiStore = m[1];
  const appid = +m[1];

  const TIERS = {
    native: {c1: "#4ade80", c2: "#15803d", label: "Native"}, platinum: {c1: "#e5edf7", c2: "#8fa3bf", label: "Platinum"},
    gold: {c1: "#fde68a", c2: "#c99a1c", label: "Gold"}, silver: {c1: "#e5e7eb", c2: "#9ca3af", label: "Silver"},
    bronze: {c1: "#f4b27a", c2: "#a0522d", label: "Bronze"}, borked: {c1: "#fca5a5", c2: "#b91c1c", label: "Borked"},
    pending: {c1: "#6b7280", c2: "#374151", label: "Pending"},
  };
  let medalSeq = 0;
  function medal(tier, size = 34) {
    const t = TIERS[tier] || TIERS.pending, id = "psism" + (++medalSeq);
    const glyph = tier === "borked" ? '<path d="M15 19l6 6M21 19l-6 6" stroke="#5b0d0d" stroke-width="2.4" stroke-linecap="round"/>'
      : tier === "pending" ? '<text x="18" y="26.5" text-anchor="middle" font-size="11" font-weight="700" fill="#d1d5db" font-family="sans-serif">?</text>'
      : '<path d="M18 15.6l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="rgba(255,255,255,.85)"/>';
    return `<svg width="${size}" height="${size * 1.22}" viewBox="0 0 36 44"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient></defs><path d="M9 0h7l3 9-6 4zM27 0h-7l-3 9 6 4z" fill="#22d3ee" opacity=".9"/><path d="M16 0h4l-2 8z" fill="#8b5cf6"/><circle cx="18" cy="23" r="13" fill="url(#${id})" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/><circle cx="18" cy="23" r="9.6" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1"/>${glyph}</svg>`;
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  /* ---------------- karta ProtonDB (rovnaká v knižnici aj v obchode) ---------------- */
  const TIER_BAND = {native: ["#008000", "#fff", "NATIVE"], platinum: ["#b4c7dc", "#14161b", "PLATINUM"], gold: ["#cfb53b", "#14161b", "GOLD"],
    silver: ["#a6a6a6", "#14161b", "SILVER"], bronze: ["#cd7f32", "#14161b", "BRONZE"], borked: ["#e02424", "#fff", "BORKED"], pending: ["#444b5e", "#dfe3ee", "PENDING"]};
  const DECK_INFO = {3: ["#59bf40", "M11 18.5l4.5 4.5 9-10", "Steam Deck: overené"], 2: ["#ffc82c", "M18 16v8M18 11.5v.5", "Steam Deck: hrateľné"],
    1: ["#8b929a", "M11 25L25 11", "Steam Deck: nepodporované"], 0: ["#8b929a", "M14.5 14a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5M18 24.5v.5", "Steam Deck: neznáme"]};
  function deckIcon(cat, s = 30) {
    const [c, path, t] = DECK_INFO[cat] || DECK_INFO[0];
    return `<svg width="${s}" height="${s}" viewBox="0 0 36 36"><title>${t}</title><circle cx="18" cy="18" r="15" fill="none" stroke="${c}" stroke-width="2.6"/><path d="${path}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function tuxIcon(native, s = 30) {
    const c = native ? "#22c55e" : "#5b6170";
    return `<svg width="${s}" height="${s}" viewBox="0 0 36 36"><title>${native ? "Natívna Linux verzia" : "Bez natívnej Linux verzie (beží cez Proton)"}</title>
      <rect x="1.5" y="1.5" width="33" height="33" rx="7" fill="${native ? "rgba(34,197,94,.15)" : "none"}" stroke="${c}" stroke-width="2.4"/>
      <ellipse cx="18" cy="20" rx="7.5" ry="10" fill="${c}"/><ellipse cx="18" cy="22.5" rx="4.6" ry="6.6" fill="#f3f4f6"/>
      <circle cx="15.6" cy="13.5" r="1.3" fill="#111"/><circle cx="20.4" cy="13.5" r="1.3" fill="#111"/><path d="M16 16.5h4l-2 2.2z" fill="#f59e0b"/></svg>`;
  }
  function protonCard(info) {
    const p = info.protondb || {}, tier = info.native ? "native" : (p.tier || "pending");
    const [bg, fg, label] = TIER_BAND[tier] || TIER_BAND.pending;
    const pt = TIERS[p.tier] || TIERS.pending;
    const meta = [p.reports ? `${p.reports} hlásení` : "zatiaľ bez hlásení",
      p.trending && p.trending !== p.tier && TIERS[p.trending] ? `trend ${TIERS[p.trending].label}` : ""].filter(Boolean).join(" · ");
    return `<div class="psi-pcard" style="width:270px;flex:none;border-radius:6px;overflow:hidden;background:#1e222b;border:1px solid rgba(255,255,255,.08);font-family:'Motiva Sans',Arial,sans-serif">
      <div style="background:${bg};color:${fg};text-align:center;font-size:19px;font-weight:600;letter-spacing:.08em;padding:9px 6px">${label}</div>
      <div style="display:flex;justify-content:center;align-items:center;gap:18px;padding:12px 10px 8px">
        <span title="ProtonDB: ${pt.label}">${medal(p.tier || "pending", 26)}</span>${deckIcon(info.deck)}${tuxIcon(info.native)}
      </div>
      <div style="text-align:center;color:#8b929a;font-size:12px;padding:0 10px 11px">${esc(meta)} · <span class="psi-pdb" style="color:#22d3ee;cursor:pointer">ProtonDB ↗</span></div>
    </div>`;
  }
  /* ---------------- vysvetlenie: prečo Gold, anti-cheat, Deck ---------------- */
  const TIER_WHY = {
    native: "Hra má natívnu Linux verziu – Proton netreba.",
    platinum: "Beží perfektne hneď po inštalácii, nič netreba nastavovať.",
    gold: "Beží perfektne, ale niekedy po menšej úprave (iná verzia Protonu alebo spúšťací parameter).",
    silver: "Hrateľná, ale s menšími chybami (grafika, zvuk, občasný pád).",
    bronze: "Spustí sa, ale má vážne problémy – hranie môže byť nepríjemné.",
    borked: "Nespustí sa alebo je nehrateľná.",
    pending: "Zatiaľ málo hlásení na spoľahlivé hodnotenie.",
  };
  const CONF = {strong: "vysoká", good: "dobrá", moderate: "stredná", low: "nízka", inadequate: "nedostatočná"};
  const AC = {
    Supported: ["ok", "Anti-cheat na Linuxe funguje – online hranie je v poriadku."],
    Running: ["warn", "Anti-cheat beží, ale vývojár Linux oficiálne nepodporuje – môže sa to kedykoľvek zmeniť."],
    Planned: ["warn", "Podpora Linuxu sa plánuje – online zatiaľ nemusí fungovať."],
    Broken: ["bad", "Anti-cheat na Linuxe nefunguje – do online hier ťa nepustí alebo vyhodí."],
    Denied: ["bad", "Vývojár Linux zablokoval – do online hier ťa nepustí (offline režim, ak ho hra má, ide)."],
  };
  const DECK_TXT = {3: ["ok", "Steam Deck: overené"], 2: ["warn", "Steam Deck: hrateľné (drobné obmedzenia)"], 1: ["bad", "Steam Deck: nepodporované"], 0: ["info", "Steam Deck: zatiaľ nehodnotené"]};
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
    const fps = n => n == null ? "?" : n >= 144 ? "144+" : String(n);
    const row = (lvl, label, mine, need) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:4px 0;line-height:1.4">
      <span style="flex:none;margin-top:2px">${ICO[lvl]}</span><span style="min-width:74px;color:#8f98a0">${label}</span>
      <span><span style="color:#fff">${esc(mine)}</span>${need ? `<span style="color:#8f98a0"> · ${ref === rc ? "odporúčané" : "minimum"}: ${esc(need)}</span>` : ""}</span></div>`;
    const head = p.fps_high ? `<div style="display:flex;gap:26px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
        <div><div style="font-size:34px;line-height:1;color:${col};font-weight:300">≈ ${fps(p.fps_high)} <span style="font-size:16px">FPS</span></div>
          <div style="font-size:12.5px;color:#8f98a0;margin-top:4px">${esc(p.preset || "")} detaily · 1080p</div></div>
        ${p.fps_low ? `<div><div style="font-size:20px;line-height:1;color:#dcdedf">≈ ${fps(p.fps_low)} FPS</div><div style="font-size:12.5px;color:#8f98a0;margin-top:4px">nízke detaily</div></div>` : ""}
      </div>` : `<div style="color:#8f98a0;margin-bottom:8px">Odhad nie je k dispozícii – hra neuvádza porovnateľné požiadavky.</div>`;
    return head
      + row(cmp(pc.gpu_score, ref.gpu_score), "Grafika", pc.gpu || "?", ref.gpu || "")
      + row(cmp(pc.cpu_score, ref.cpu_score), "Procesor", pc.cpu || "?", ref.cpu || "")
      + row(cmp(pc.ram, ref.ram), "RAM", pc.ram ? `${pc.ram} GB` : "?", ref.ram ? `${ref.ram} GB` : "")
      + (p.notes || []).map(n => `<div style="color:#8f98a0;font-size:12px;padding-top:4px">ⓘ ${esc(n)}</div>`).join("")
      + `<div style="color:#56707f;font-size:11px;margin-top:8px">Odhad podľa požiadaviek hry a tvojho hardvéru – skutočné FPS sa môžu líšiť.</div>`;
  }

  function linuxRows(info) {
    const p = info.protondb || {}, tier = info.native ? "native" : (p.tier || "pending");
    const rows = [];
    const tl = (TIERS[tier] || TIERS.pending).label;
    rows.push([tier === "borked" ? "bad" : ["bronze", "silver", "pending"].includes(tier) ? "warn" : "ok", `<b style="color:#fff;font-weight:600">${tl}</b> – ${TIER_WHY[tier] || ""}`]);
    if (!info.native && p.reports) {
      const extra = [`${p.reports} hlásení`, CONF[p.confidence] ? `istota ${CONF[p.confidence]}` : "",
        p.trending && p.trending !== p.tier && TIERS[p.trending] ? `nové hlásenia: ${TIERS[p.trending].label}` : "",
        p.best && p.best !== p.tier && TIERS[p.best] ? `najlepšie: ${TIERS[p.best].label}` : ""].filter(Boolean).join(" · ");
      rows.push(["info", `ProtonDB: ${esc(extra)}`]);
    }
    const ac = info.anticheat;
    if (ac && ac.anticheats && ac.anticheats.length) {
      const [lvl, txt] = AC[ac.status] || ["info", `Stav: ${esc(ac.status)}`];
      rows.push([lvl, `<b style="color:#fff;font-weight:600">${esc(ac.anticheats.join(", "))}</b> – ${txt}`]);
      (ac.notes || []).forEach(n => rows.push(["info", `<span style="color:#8f98a0">${esc(n)}</span>`]));
    } else {
      rows.push(["ok", "Bez známeho problémového anti-cheatu – online by malo ísť."]);
    }
    const [dl, dt] = DECK_TXT[info.deck] || DECK_TXT[0];
    rows.push([dl, dt]);
    rows.push([info.native ? "ok" : "info", info.native ? "Natívna Linux verzia" : "Beží cez Proton (Steam Play)"]);
    return rows.map(([l, h]) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:5px 0;line-height:1.45"><span style="flex:none;margin-top:2px">${ICO[l]}</span><span>${h}</span></div>`).join("");
  }
  const cd = ts => { let s = Math.max(0, Math.floor(ts - Date.now() / 1000)); const d = Math.floor(s / 86400); s %= 86400;
    const p = n => String(n).padStart(2, "0"); return (d ? d + " d " : "") + p(Math.floor(s / 3600)) + ":" + p(Math.floor(s % 3600 / 60)) + ":" + p(s % 60); };


  /* ---------------- varovanie pred kúpou ---------------- */
  function buyGuard(info) {
    const ac = info.anticheat || {};
    const reasons = psiReasons({native: info.native, tier: (info.protondb || {}).tier, ac: ac.status, anticheats: ac.anticheats});
    if (!reasons.length) return null;
    let allowed = false;
    document.addEventListener("click", e => {
      if (allowed) return;
      const btn = e.target.closest("a, button");
      if (!btn || !btn.closest('[id^="game_area_purchase"], .game_area_purchase_game') || btn.closest("#psi-store")) return;
      if (!/add to cart|do košíka|buy|kúpiť|purchase|add to account/i.test(btn.textContent || "")) return;
      e.preventDefault(); e.stopImmediatePropagation();
      psiBuyModal(reasons, () => { allowed = true; btn.click(); allowed = false; });
    }, true);
    return reasons;
  }

  function mount() {
    const anchor = document.querySelector("#game_area_purchase") || document.querySelector(".game_area_purchase_game_wrapper");
    if (!anchor) return setTimeout(mount, 150);
    if (document.getElementById("psi-store")) return;
    const box = document.createElement("div");
    box.id = "psi-store";
    box.innerHTML = `<div class="game_area_purchase_game_wrapper"><div class="game_area_purchase_game"><h1>Hrať na Linuxe</h1><div style="color:#8f98a0">Načítavam…</div></div></div>`;
    anchor.parentNode.insertBefore(box, anchor);
    const feats = BOOT ? Promise.resolve(BOOT.features || {}) : window.__psiCall("features").catch(() => ({}));
    Promise.all([window.__psiCall("linux", {appid}), feats, window.__psiCall("perf", {appid}).catch(() => null)]).then(([info, feats, perf]) => {
      const warn = feats.buy_warning !== false ? buyGuard(info) : null;
      const t = TIERS[info.native ? "native" : (info.protondb || {}).tier] || TIERS.pending;
      box.innerHTML = `
        <div class="game_area_purchase_game_wrapper"><div class="game_area_purchase_game" style="padding-bottom:18px">
          <h1>Hrať na Linuxe – ${esc(t.label)}</h1>
          ${warn ? `<div style="margin:6px 0 4px;padding:10px 14px;border-radius:8px;background:rgba(217,65,38,.15);border:1px solid rgba(217,65,38,.55);color:#ffb4a3;font-size:14px">⚠ Pozor pred kúpou: ${warn.map(esc).join(" ")}</div>` : ""}
          <div style="display:flex;gap:22px;align-items:flex-start;margin-top:8px;color:#c6d4df;font-size:14px">
            <div style="flex:1;min-width:0">${linuxRows(info)}</div>
            ${protonCard(info)}
          </div>
        </div></div>
        <div class="game_area_purchase_game_wrapper"><div class="game_area_purchase_game" style="padding-bottom:18px">
          <h1>Výkon na tvojom PC</h1>
          <div style="margin-top:8px;color:#c6d4df;font-size:14px">${perfHtml(perf)}</div>
        </div></div>
        <div class="game_area_purchase_game_wrapper"><div class="game_area_purchase_game psi-price" style="padding-bottom:18px">
          <h1>Cena a zľava</h1><div style="color:#8f98a0;margin-top:6px">Načítavam ceny…</div>
        </div></div>`;
      const link = box.querySelector(".psi-pdb");
      link && link.addEventListener("click", () => window.open(`https://www.protondb.com/app/${appid}`, "_blank"));
      // cena môže trvať dlhšie (CheapShark) – doplní sa, keď príde
      window.__psiCall("deal", {appid}).then(d => {
        const verdict = {buy: ["Kúp teraz", "#a4d007", "#1b2838"], wait: ["Počkaj", "#e5a83a", "#1b2838"], info: ["Info", "#8f98a0", "#1b2838"]}[d.verdict] || ["", "#8f98a0", "#1b2838"];
        const stat = (big, small) => `<div style="min-width:110px"><div style="font-size:18px;color:#fff">${big}</div><div style="font-size:12px;color:#8f98a0">${small}</div></div>`;
        box.querySelector(".psi-price").innerHTML = `
          <h1>Cena a zľava</h1>
          <div style="display:flex;gap:26px;flex-wrap:wrap;margin:8px 0 12px">
            ${d.on_sale ? stat(`−${d.discount} %`, d.ends ? `končí o <span data-psi-end="${d.ends}">${cd(d.ends)}</span>` : "aktuálna zľava")
              : d.estimate ? stat(`≈ −${d.estimate} %`, "odhad najbližšej zľavy") : ""}
            ${d.best_ever ? stat(`−${d.best_ever} %`, "historické maximum") : ""}
            ${d.next_sale ? stat(d.next_sale.active ? "práve teraz" : `o ${Math.ceil(d.next_sale.days)} dní`, esc(d.next_sale.name)) : ""}
          </div>
          <div style="display:flex;gap:10px;align-items:center;color:#c6d4df;font-size:14px">
            <span style="flex:none;background:${verdict[1]};color:${verdict[2]};font-size:12px;font-weight:700;text-transform:uppercase;padding:3px 9px;border-radius:6px">${verdict[0]}</span>
            <span>${esc(d.reason)}</span>
          </div>
          <div style="margin-top:12px;font-size:11px;color:#56707f">Údaje: ProtonDB, AreWeAntiCheatYet, Steam, CheapShark · PSI</div>`;
      }).catch(() => { const p = box.querySelector(".psi-price"); p && p.parentElement.remove(); });
      setInterval(() => box.querySelectorAll("[data-psi-end]").forEach(el => el.textContent = cd(+el.dataset.psiEnd)), 1000);
    }).catch(() => box.remove());
  }
  const start = () => BOOT ? (BOOT.features.store !== false && mount())
    : window.__psiCall("features").then(f => f.store !== false && mount()).catch(mount);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
