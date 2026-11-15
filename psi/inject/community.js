/* PSI – Steam komunita: vitrína „Môj týždeň“ a PSI odznaky na vlastnom profile. */
(function () {
  const LANG = ((window.__PSI_BOOT || {}).features || {}).lang || (/^(sk|cs)/.test(document.documentElement.lang || "") ? "sk" : "en");
  const tr = (sk, en) => LANG === "en" ? en : sk;
  "use strict";
  if (location.hostname !== "steamcommunity.com" || !/^\/(id|profiles)\/[^/]+\/?$/.test(location.pathname)) return;
  if (window.__psiCommunity || !window.__psiCall) return;
  window.__psiCommunity = true;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const fmtH = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h} h ${mm} min` : `${mm} min`; };

  async function mount() {
    const col = document.querySelector(".profile_leftcol") || document.querySelector(".profile_customization_area");
    if (!col) return;
    const profile = window.g_rgProfileData || {};
    const f = await window.__psiCall("features").catch(() => ({}));
    if (f.community === false) return;
    const me = await window.__psiCall("me").catch(() => ({}));
    if (!me.steamid || String(profile.steamid) !== String(me.steamid)) return; // len vlastný profil
    const w = await window.__psiCall("week");
    const g = w.game_of_week;
    const max = Math.max(60, ...w.days.map(d => d.minutes));
    const box = document.createElement("div");
    box.className = "profile_customization";
    box.innerHTML = `
      <div class="profile_customization_header">${tr("Môj týždeň", "My week")}</div>
      <div style="padding:14px;border-radius:var(--psi-radius,12px);background:color-mix(in srgb,var(--psi-accent,#1a9fff) 8%,transparent);border:1px solid color-mix(in srgb,var(--psi-accent,#1a9fff) 22%,transparent)">
        <div style="display:flex;gap:18px;align-items:flex-end">
          <div><div style="font-size:36px;font-weight:600;line-height:1;color:var(--psi-text,#fff)">${(w.total_minutes / 60).toFixed(1)} h</div>
            <div style="color:var(--psi-mut,#8f98a0);font-size:12px">${tr("za 7 dní", "last 7 days")} · ${w.days.filter(d => d.minutes).length}/7 ${tr("dní", "days")}</div></div>
          <div style="flex:1;display:flex;gap:5px;align-items:flex-end;height:56px">${w.days.map(d => `<div title="${esc(d.label)} ${fmtH(d.minutes)}" style="flex:1;border-radius:4px 4px 2px 2px;height:${Math.max(4, d.minutes / max * 100)}%;background:${d.minutes ? "var(--psi-accent,#1a9fff)" : "rgba(255,255,255,.08)"}"></div>`).join("")}</div>
        </div>
        ${g ? `<div style="display:flex;gap:12px;align-items:center;margin-top:14px">
          <img src="${esc(g.header)}" style="width:150px;border-radius:8px">
          <div><div style="color:var(--psi-accent,#1a9fff);font-size:11px;letter-spacing:.08em">${tr("HRA TÝŽDŇA", "GAME OF THE WEEK")}</div><div style="font-size:16px;color:#fff">${esc(g.name)}</div>
            <div style="color:var(--psi-mut,#8f98a0)">${fmtH(g.minutes)} · ${g.share} %</div></div></div>` : ""}
        ${w.badges.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${w.badges.map(b => `<span title="${esc(b.desc)}" style="padding:4px 10px;border-radius:99px;background:color-mix(in srgb,var(--psi-accent,#1a9fff) 16%,transparent);color:var(--psi-text,#fff)">${esc(b.icon)} ${esc(b.name)}</span>`).join("")}</div>` : ""}
      </div>`;
    col.prepend(box);
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();
})();
