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
  const cachedJson = (path) => {
    let request = null;
    return () => (request ??= (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error("Example data could not load.");
        const value = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid example data.");
        return value;
      } finally { clearTimeout(timeout); }
    })().catch((error) => { request = null; throw error; }));
  };
  const loadData = cachedJson("/reference-assets/data/examples.json");
  const loadMedia = cachedJson("/reference-assets/data/example-media.json");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const RATIO = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1" };
  const mediaUrl = (entry) => {
    if (!entry || entry.type !== "video/mp4" || typeof entry.url !== "string" || /[\s\\]/.test(entry.url)) return null;
    // Check the raw authority too: URL normalizes an explicit :443 to no port.
    if (!/^https:\/\/video\.twimg\.com\//i.test(entry.url)) return null;
    try {
      const url = new URL(entry.url);
      if (url.protocol !== "https:" || url.hostname !== "video.twimg.com" || url.port || url.username || url.password || url.hash || !/\.mp4$/i.test(url.pathname)) return null;
      if (/[\u0000-\u0020]/.test(decodeURIComponent(url.pathname))) return null;
      return url.href;
    } catch { return null; }
  };

  const dlg = $("#example-dlg");
  if (dlg) {
    const body = $(".modal-body", dlg);
    let generation = 0, selectedId = null, currentVideo = null;
    const releaseVideo = (video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    const cleanup = () => {
      generation++;
      selectedId = null;
      const previous = currentVideo;
      currentVideo = null;
      if (previous) releaseVideo(previous);
      body.replaceChildren();
      body.removeAttribute("aria-busy");
    };
    const close = () => { cleanup(); if (dlg.open) dlg.close(); };
    const isCurrent = (token) => token === generation && dlg.open;
    const showError = (message, retry) => {
      const player = $(".ex-video", body);
      const status = $(".ex-player-status", player);
      if (status) status.hidden = true;
      const error = document.createElement("div");
      error.className = "ex-player-error";
      error.setAttribute("role", retry ? "alert" : "status");
      const text = document.createElement("p");
      text.textContent = message;
      error.append(text);
      if (retry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn small";
        button.dataset.exampleRetry = "";
        button.textContent = "Retry";
        error.append(button);
      }
      player.append(error);
      body.removeAttribute("aria-busy");
    };
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest(".modal-close")) close(); });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    // A queued close event must not clear a newer, already reopened dialog.
    dlg.addEventListener("close", () => { if (!dlg.open) cleanup(); });
    addEventListener("pagehide", close);
    const openExample = async (id, format) => {
      cleanup();
      const token = generation;
      selectedId = id;
      body.setAttribute("aria-busy", "true");
      body.innerHTML = `<div class="ex-video" style="aspect-ratio:${RATIO[format] || "16 / 9"}"><div class="ex-player-status" role="status">Loading video…</div></div>`;
      if (!dlg.open) dlg.showModal();
      const [dataResult, mediaResult] = await Promise.allSettled([loadData(), loadMedia()]);
      if (!isCurrent(token)) return;
      if (dataResult.status === "rejected") { showError("The example could not load. Please try again.", true); return; }
      const ex = Object.hasOwn(dataResult.value, id) ? dataResult.value[id] : null;
      if (!ex || typeof ex.prompt !== "string") { showError("This example is not available here.", false); return; }
      body.innerHTML = `
        <span class="mono muted">${esc(ex.catLabel)} · ${esc(ex.duration)}s · ${esc(ex.format)}</span>
        <h3>${esc(ex.name || "@" + ex.author)} <span class="muted" style="font-weight:400">@${esc(ex.author)}</span></h3>
        <div class="ex-video" style="aspect-ratio:${RATIO[ex.format] || "16 / 9"}"><div class="ex-player-status" role="status">Loading video…</div></div>
        ${Array.isArray(ex.tags) && ex.tags.length ? `<div class="tags">${ex.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div>
          <div class="mono muted" style="margin-bottom:8px">${ex.fullPrompt ? "Prompt" : "From the original post"}</div>
          <div class="prompt-box">${esc(ex.prompt)}</div>
        </div>
        <div class="ex-actions">
          <button class="btn" type="button" data-copy="${esc(ex.prompt)}">Copy prompt</button>
          <a class="btn primary" href="/studio" data-close data-prefill="${esc(ex.id)}">Make one like this</a>
        </div>
        <p class="ex-source">Source: <a href="${esc(ex.postUrl)}" target="_blank" rel="noopener">@${esc(ex.author)} on X</a>. Video and prompt belong to the creator.</p>`;
      body.removeAttribute("aria-busy");
      if (mediaResult.status === "rejected") { showError("The video could not load. Please try again.", true); return; }
      const entry = Object.hasOwn(mediaResult.value, id) ? mediaResult.value[id] : null;
      const url = mediaUrl(entry);
      if (!url) { showError("This video is not available to play here.", false); return; }
      const player = $(".ex-video", body), status = $(".ex-player-status", player);
      const video = document.createElement("video");
      video.className = "ex-player";
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.muted = false;
      video.setAttribute("aria-label", `Video by @${ex.author}`);
      if (ex.poster) video.poster = ex.poster;
      video.addEventListener("loadedmetadata", () => { if (isCurrent(token) && currentVideo === video) status.hidden = true; });
      video.addEventListener("error", () => {
        if (!isCurrent(token) || currentVideo !== video) return;
        currentVideo = null;
        releaseVideo(video);
        showError("The video could not play. Please try again.", true);
      });
      currentVideo = video;
      video.src = url;
      player.prepend(video);
      // Audible playback can lose browser activation while metadata loads.
      // A denial is normal: leave the native controls available for a tap.
      try {
        await video.play();
        if (!isCurrent(token) || currentVideo !== video) releaseVideo(video);
        else status.hidden = true;
      } catch {
        if (isCurrent(token) && currentVideo === video) status.hidden = true;
      }
    };
    document.addEventListener("click", (e) => {
      const card = e.target.closest(".card[data-id]");
      if (card) { e.preventDefault(); void openExample(card.dataset.id, card.dataset.fmt); }
      if (e.target.closest("[data-example-retry]") && selectedId) void openExample(selectedId);
    });
    document.addEventListener("click", async (e) => {
      const pre = e.target.closest("[data-prefill]");
      if (e.target.closest("[data-close]")) close();
      if (pre) {
        try {
          const ex = (await loadData())[pre.dataset.prefill];
          if (ex) {
            const detail = { brief: ex.prompt.slice(0, 2000), aspect: ex.format };
            try { sessionStorage.setItem("cmv.prefill", JSON.stringify(detail)); } catch {}
            window.dispatchEvent(new CustomEvent("cmv:prefill", { detail }));
          }
        } catch { toast("The prompt could not load. Please try again."); }
      }
    });
  }
})();
