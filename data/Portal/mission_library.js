async function fetchMissions() {
  try {
    const r = await fetch("/api/missions");
    if (!r.ok) throw new Error("no api");
    return await r.json();
  } catch {
    return [];
  }
}

function render(missions) {
  const wrap = document.getElementById("missions");

  const rows = missions.map(m => `
    <div style="display:flex; gap:10px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line);">
      <!-- Leave space for ACTIVE button (green) -->
      <button class="btn btn-green" style="visibility:hidden;">Active</button>

      <!-- LOAD button (blue) -->
      <button class="btn btn-blue" data-load="${m.id}">Load</button>

      <div style="flex:1;">
        <div style="font-weight:700;">${escapeHtml(m.name)}</div>
        <div class="muted" style="font-size:13px;">${escapeHtml(m.description || "")}</div>
      </div>
    </div>
  `).join("");

  wrap.innerHTML = `<div>${rows || "<div class='muted'>No missions yet.</div>"}</div>`;

  wrap.querySelectorAll("button[data-load]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-load"));
      const mission = missions.find(x => x.id === id);
      localStorage.setItem("saber_active_mission_prefill", JSON.stringify(mission));
      window.location.href = "./active_mission.html";
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

fetchMissions().then(render);
