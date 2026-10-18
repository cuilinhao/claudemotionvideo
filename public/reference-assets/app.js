(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Section links (/#create, #pricing-plans) scroll as usual, then the "#…" is dropped so URLs stay clean.
  const dropHash = () => {
    if (!location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(history.state, "", location.pathname + location.search);
  };
  addEventListener("hashchange", dropHash);

  // A scenario card (home page, footer) opens the Studio with that scenario picked; it's handed over here, so the
  // Studio's address stays plain /studio (Studio.tsx reads it once).
  document.addEventListener("click", (e) => {
    const card = e.target.closest("a[data-scene]");
    if (card) try { sessionStorage.setItem("cmv.scene", card.dataset.scene); } catch {}
  });

  // The phone menu closes when you tap anywhere else.
  document.addEventListener("click", (e) => {
    for (const d of $$("details.mnav[open]")) if (!d.contains(e.target)) d.open = false;
  });
  if (document.readyState === "complete") dropHash(); else addEventListener("load", dropHash);

  const toast = (msg) => {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 1600);
  };

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    e.stopPropagation();
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Prompt copied"); } catch { toast("Copy failed"); }
  });

  // Gallery filters: chips toggle which set of cards is visible; search filters by text.
  $$("[data-gallery]").forEach((gal) => {
    const cards = $$(".card", gal);
    const chips = $$(`[data-for="${gal.id}"] .chip`);
    const search = $(`[data-for="${gal.id}"] .search`);
    const moreBtn = $(`[data-more="${gal.id}"]`);
    const page = Number(gal.dataset.page) || 0;
    let shown = page;
    const apply = () => {
      const active = {};
      chips.filter((c) => c.getAttribute("aria-pressed") === "true").forEach((c) => (active[c.dataset.group] = c.dataset.value));
      const q = (search?.value || "").trim().toLowerCase();
      let n = 0;
      cards.forEach((card) => {
        const ok = Object.entries(active).every(([g, v]) => v === "all" || (card.dataset[g] || "").split(" ").includes(v))
          && (!q || card.dataset.q.includes(q));
        const visible = ok && (!page || n < shown);
        if (ok) n++;
        card.hidden = !visible;
      });
      if (moreBtn) moreBtn.hidden = !page || n <= shown;
      const count = $(`[data-count="${gal.id}"]`);
      if (count) count.textContent = n;
    };
    chips.forEach((c) => c.addEventListener("click", () => {
      chips.filter((x) => x.dataset.group === c.dataset.group).forEach((x) => x.setAttribute("aria-pressed", "false"));
      c.setAttribute("aria-pressed", "true");
      shown = page; apply();
    }));
    search?.addEventListener("input", () => { shown = page; apply(); });
    moreBtn?.addEventListener("click", () => { shown += page; apply(); });
    apply();
  });

  // Example modal: our own player for the creator's video, the prompt, and a source line.
  let data = null;
  const loadData = async () => (data ??= await fetch("/reference-assets/data/examples.json").then((r) => r.json()));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const RATIO = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1" };

  const dlg = $("#example-dlg");
  if (dlg) {
    const body = $(".modal-body", dlg);
    const close = () => { dlg.close(); body.innerHTML = ""; };
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest(".modal-close")) close(); });
    dlg.addEventListener("close", () => { body.innerHTML = ""; });
    document.addEventListener("click", async (e) => {
      const card = e.target.closest(".card[data-id]");
      if (!card) return;
      const ex = (await loadData())[card.dataset.id];
      if (!ex) return;
      const player = `<a class="ex-video" href="${esc(ex.postUrl)}" target="_blank" rel="noopener" style="aspect-ratio:${RATIO[ex.format] || "16 / 9"}" aria-label="Watch this video on X">
            ${ex.poster ? `<img src="${esc(ex.poster)}" alt="" referrerpolicy="no-referrer">` : ""}
            <span class="ex-play" aria-hidden="true"></span><span class="ex-watch">Watch on X ↗</span>
          </a>`;
      body.innerHTML = `
        <span class="mono muted">${esc(ex.catLabel)} · ${ex.duration}s · ${esc(ex.format)}</span>
        <h3>${esc(ex.name || "@" + ex.author)} <span class="muted" style="font-weight:400">@${esc(ex.author)}</span></h3>
        ${player}
        ${ex.tags.length ? `<div class="tags">${ex.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div>
          <div class="mono muted" style="margin-bottom:8px">${ex.fullPrompt ? "Prompt" : "From the original post"}</div>
          <div class="prompt-box">${esc(ex.prompt)}</div>
        </div>
        <div class="ex-actions">
          <button class="btn" type="button" data-copy="${esc(ex.prompt)}">Copy prompt</button>
          <a class="btn primary" href="/studio" data-close data-prefill="${esc(ex.id)}">Make one like this</a>
        </div>
        <p class="ex-source">Source: <a href="${esc(ex.postUrl)}" target="_blank" rel="noopener">@${esc(ex.author)} on X</a>. Video and prompt belong to the creator.</p>`;
      dlg.showModal();
    });
    document.addEventListener("click", async (e) => {
      const pre = e.target.closest("[data-prefill]");
      if (pre) {
        const ex = (await loadData())[pre.dataset.prefill];
        if (ex) {
          const detail = { brief: ex.prompt.slice(0, 2000), aspect: ex.format };
          try { sessionStorage.setItem("cmv.prefill", JSON.stringify(detail)); } catch {}
          window.dispatchEvent(new CustomEvent("cmv:prefill", { detail }));
        }
      }
      if (e.target.closest("[data-close]")) close();
    });
  }
})();
