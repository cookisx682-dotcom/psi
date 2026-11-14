/* PSI – Steam komunita: vitrína „Môj týždeň“ a PSI odznaky na vlastnom profile. */
(function () {
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
      <div class="profile_customization_header">Ψ Môj týždeň</div>
      <div style="padding:14px;border-radius:6px;background:linear-gradient(135deg,rgba(34,211,238,.08),rgba(139,92,246,.12));border:1px solid rgba(139,92,246,.3)">
        <div style="display:flex;gap:18px;align-items:flex-end">
          <div><div style="font-size:38px;font-weight:700;line-height:1;background:linear-gradient(135deg,#22d3ee,#8b5cf6);-webkit-background-clip:text;color:transparent">${(w.total_minutes / 60).toFixed(1)} h</div>
            <div style="color:#8d96bd;font-size:12px">za 7 dní · ${w.days.filter(d => d.minutes).length}/7 dní</div></div>
          <div style="flex:1;display:flex;gap:5px;align-items:flex-end;height:56px">${w.days.map(d => `<div title="${esc(d.label)} ${fmtH(d.minutes)}" style="flex:1;border-radius:4px 4px 2px 2px;height:${Math.max(4, d.minutes / max * 100)}%;background:${d.minutes ? "linear-gradient(180deg,#22d3ee,#8b5cf6)" : "rgba(148,163,255,.15)"}"></div>`).join("")}</div>
        </div>
        ${g ? `<div style="display:flex;gap:12px;align-items:center;margin-top:14px">
          <img src="${esc(g.header)}" style="width:150px;border-radius:4px;box-shadow:0 0 18px rgba(34,211,238,.25)">
          <div><div style="color:#22d3ee;font-size:11px;letter-spacing:.08em">HRA TÝŽDŇA</div><div style="font-size:16px;color:#fff">${esc(g.name)}</div>
            <div style="color:#8d96bd">${fmtH(g.minutes)} · ${g.share} %</div></div></div>` : ""}
        ${w.badges.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${w.badges.map(b => `<span title="${esc(b.desc)}" style="padding:4px 10px;border-radius:99px;background:rgba(139,92,246,.2);border:1px solid rgba(139,92,246,.4);color:#e7ecff">${esc(b.icon)} ${esc(b.name)}</span>`).join("")}</div>` : ""}
      </div>`;
    col.prepend(box);
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();
})();
