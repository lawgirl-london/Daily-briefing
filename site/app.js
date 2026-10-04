/* Morning Edition — reads data/briefing.json (rebuilt every morning) and renders it. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");
  const tabsEl = $("#tabs");
  const sheet = $("#sheet");
  const backdrop = $("#backdrop");

  const state = { data: null, byUrl: new Map(), topics: new Map(), route: "today", section: "briefing" };

  const CHECK = '<svg class="verified" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7l8-4Zm-3 9 2 2 4-4"/></svg>';
  const ICON_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
  const ICON_SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4V4Z"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg>';

  /* ------------------------------------------------ helpers */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function timeAgo(iso) {
    if (!iso) return "";
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  const store = {
    get() { try { return JSON.parse(localStorage.getItem("saved") || "[]"); } catch { return []; } },
    set(list) { try { localStorage.setItem("saved", JSON.stringify(list)); } catch { /* private mode */ } },
    has(url) { return this.get().some((a) => a.url === url); },
    toggle(article) {
      const list = this.get();
      const i = list.findIndex((a) => a.url === article.url);
      if (i >= 0) list.splice(i, 1); else list.unshift({ ...article, savedAt: new Date().toISOString() });
      this.set(list);
      return i < 0;
    },
  };

  const topicOf = (article) => state.topics.get(article.topic) || { color: "#c2410c", icon: "📰", name: "News" };

  function media(article, extraClass = "") {
    const t = topicOf(article);
    const img = article.image
      ? `<img src="${esc(article.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
           onerror="this.remove()">`
      : "";
    return `<div class="media ${extraClass}"><div class="fallback" aria-hidden="true">${t.icon}</div>${img}</div>`;
  }

  const pill = (article) => {
    const t = topicOf(article);
    return `<span class="pill">${t.icon} ${esc(t.name)}</span>`;
  };

  const meta = (article) =>
    `<div class="meta"><span class="source">${esc(article.source)}</span>${CHECK}` +
    (article.published ? `<span>·</span><span>${timeAgo(article.published)}</span>` : "") + `</div>`;

  const styleFor = (article) => `style="--c:${topicOf(article).color}"`;

  /* ------------------------------------------------ building blocks */
  const heroCard = (a) => `
    <button class="hero" ${styleFor(a)} data-url="${esc(a.url)}">
      ${media(a)}
      <div class="body">${pill(a)}<h3>${esc(a.title)}</h3>${meta(a)}</div>
    </button>`;

  const featureCard = (a) => `
    <button class="feature" ${styleFor(a)} data-url="${esc(a.url)}">
      ${media(a)}
      <div class="body">${meta(a)}<h3>${esc(a.title)}</h3>${a.summary ? `<p>${esc(a.summary)}</p>` : ""}</div>
    </button>`;

  const listCard = (a, showTopic = false) => `
    <button class="card" ${styleFor(a)} data-url="${esc(a.url)}">
      <div>${showTopic ? pill(a) : ""}<h3>${esc(a.title)}</h3>${meta(a)}</div>
      ${media(a)}
    </button>`;

  /* ------------------------------------------------ screens */
  function renderToday() {
    const { data } = state;
    const highlights = data.highlights.map((u) => state.byUrl.get(u)).filter(Boolean);
    const total = data.topics.reduce((n, t) => n + t.articles.length, 0);

    let html = `<p class="intro">${total} stories across ${data.topics.length} topics. Swipe through today's highlights, or tap a topic above.</p>`;
    if (highlights.length) {
      html += `<div class="section-head"><h2>Today's highlights</h2></div>
        <div class="carousel" id="carousel">${highlights.map(heroCard).join("")}</div>
        <div class="dots" id="dots">${highlights.map((_, i) => `<span class="${i ? "" : "on"}"></span>`).join("")}</div>`;
    }
    for (const t of data.topics) {
      if (!t.articles.length) continue;
      const rest = t.articles.filter((a) => !data.highlights.includes(a.url)).slice(0, 3);
      if (!rest.length) continue;
      html += `<div class="section-head" style="--c:${t.color}">
          <h2>${t.icon} ${esc(t.name)}</h2>
          <button class="see-all" data-topic="${t.id}">See all ${t.articles.length} →</button>
        </div>
        <div class="list">${rest.map((a) => listCard(a)).join("")}</div>`;
    }
    view.innerHTML = html;
    wireCarousel();
  }

  function renderTopic(id) {
    const t = state.topics.get(id);
    if (!t) return go("today");
    const [first, ...rest] = t.articles;
    const sourceNames = [...new Set(t.articles.map((a) => a.source))];
    view.innerHTML = `
      <div class="topic-banner" style="--c:${t.color}">
        <span class="big">${t.icon}</span>
        <div><h2>${esc(t.name)}</h2>
        <p>${t.articles.length} stories · from ${esc(sourceNames.join(", ") || "no sources today")}</p></div>
      </div>
      ${first ? featureCard(first) : `<div class="empty"><div class="big">${t.icon}</div><h2>Nothing new today</h2><p>Check back tomorrow morning.</p></div>`}
      ${rest.length ? `<div class="list">${rest.map((a) => listCard(a)).join("")}</div>` : ""}`;
  }

  function renderSaved() {
    const list = store.get();
    view.innerHTML = list.length
      ? `<div class="section-head"><h2>Saved for later</h2></div>
         <div class="list">${list.map((a) => listCard(a, true)).join("")}</div>`
      : `<div class="empty"><div class="big">🔖</div><h2>Nothing saved yet</h2>
         <p>Tap <strong>Save</strong> on any article to keep it here, even after it leaves the daily briefing.</p></div>`;
  }

  function renderSources() {
    const groups = state.data.topics.map((t) => `
      <section class="source-group">
        <h3>${t.icon} ${esc(t.name)}</h3>
        <div class="list">${(t.sources || []).map((s) => `
          <div class="source-row">
            <span class="status ${s.working ? "" : "off"}" title="${s.working ? "Working today" : "No articles today"}"></span>
            <div>
              <strong>${esc(s.name)}</strong>
              <p>${esc(s.about)}</p>
              <a href="${esc(s.home)}" target="_blank" rel="noopener">Visit ${esc(s.name)} ↗</a>
            </div>
          </div>`).join("")}
        </div>
      </section>`).join("");
    view.innerHTML = `
      <div class="section-head"><h2>Where your news comes from</h2></div>
      <p class="intro">Every article links to the original publisher, shown with a ${CHECK} on each story.
      A green dot means the source delivered articles this morning.</p>
      <div style="height:12px"></div>${groups}`;
  }

  /* ------------------------------------------------ tabs & routing */
  function renderTabs() {
    const showTabs = state.section === "briefing";
    tabsEl.hidden = !showTabs;
    if (!showTabs) return;
    const items = [{ id: "today", name: "Today", icon: "☀️", color: "#c2410c", articles: null }, ...state.data.topics];
    tabsEl.innerHTML = items.map((t) => `
      <button class="tab" role="tab" style="--c:${t.color}" data-topic="${t.id}"
        aria-selected="${state.route === t.id}">${t.icon} ${esc(t.name)}
        ${t.articles ? `<span class="count">${t.articles.length}</span>` : ""}</button>`).join("");
    tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function render() {
    document.querySelectorAll(".bottombar button").forEach((b) =>
      b.classList.toggle("active", b.dataset.section === state.section));
    renderTabs();
    if (state.section === "saved") renderSaved();
    else if (state.section === "sources") renderSources();
    else if (state.route === "today") renderToday();
    else renderTopic(state.route);
  }

  function go(hash) { location.hash = hash; }

  function readHash() {
    const h = decodeURIComponent(location.hash.slice(1)) || "today";
    if (h === "saved" || h === "sources") { state.section = h; }
    else { state.section = "briefing"; state.route = state.topics.has(h) ? h : "today"; }
    render();
    window.scrollTo({ top: 0 });
  }

  /* ------------------------------------------------ article sheet */
  function openArticle(url) {
    const a = state.byUrl.get(url) || store.get().find((x) => x.url === url);
    if (!a) return;
    const t = topicOf(a);
    const saved = store.has(a.url);
    sheet.style.setProperty("--c", t.color);
    sheet.innerHTML = `
      <div class="grabber"></div>
      ${media(a)}
      <div class="content">
        ${pill(a)}
        <h2 id="sheet-title">${esc(a.title)}</h2>
        ${meta(a)}
        ${a.summary ? `<p class="summary">${esc(a.summary)}</p>` : `<div style="height:16px"></div>`}
        <div class="source-box">${CHECK}<div>Published by <strong>${esc(a.source)}</strong>${
          a.published ? ` on ${new Date(a.published).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}` : ""}.
          Tap below to read the full article on their website.</div></div>
        <div class="actions">
          <a class="btn primary" href="${esc(a.url)}" target="_blank" rel="noopener">${ICON_EXT} Read full article</a>
          <button class="btn ${saved ? "saved" : ""}" id="save-btn">${ICON_SAVE} ${saved ? "Saved" : "Save"}</button>
          ${navigator.share ? `<button class="btn" id="share-btn" aria-label="Share">${ICON_SHARE}</button>` : ""}
        </div>
      </div>`;
    sheet.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(() => { sheet.classList.add("show"); backdrop.classList.add("show"); });
    sheet.scrollTop = 0;

    $("#save-btn").onclick = (e) => {
      const now = store.toggle(a);
      e.currentTarget.classList.toggle("saved", now);
      e.currentTarget.innerHTML = `${ICON_SAVE} ${now ? "Saved" : "Save"}`;
      if (state.section === "saved") renderSaved();
    };
    $("#share-btn")?.addEventListener("click", () =>
      navigator.share({ title: a.title, url: a.url }).catch(() => {}));
  }

  function closeSheet() {
    sheet.classList.remove("show"); backdrop.classList.remove("show");
    setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 320);
  }

  // Swipe the sheet down to close it
  let startY = null;
  sheet.addEventListener("touchstart", (e) => { if (sheet.scrollTop <= 0) startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener("touchend", (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transform = ""; startY = null;
    if (dy > 110) closeSheet();
  });
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  function wireCarousel() {
    const c = $("#carousel"), dots = $("#dots");
    if (!c || !dots) return;
    c.addEventListener("scroll", () => {
      const cards = [...c.children];
      const mid = c.scrollLeft + c.clientWidth / 2;
      let best = 0, bestDist = Infinity;
      cards.forEach((card, i) => {
        const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      [...dots.children].forEach((d, i) => d.classList.toggle("on", i === best));
    }, { passive: true });
  }

  /* ------------------------------------------------ events */
  document.addEventListener("click", (e) => {
    const art = e.target.closest("[data-url]");
    if (art && !e.target.closest(".sheet")) return openArticle(art.dataset.url);
    const topic = e.target.closest("[data-topic]");
    if (topic) return go(topic.dataset.topic);
    const sec = e.target.closest("[data-section]");
    if (sec) return go(sec.dataset.section === "briefing" ? (state.route || "today") : sec.dataset.section);
  });
  window.addEventListener("hashchange", readHash);

  /* ------------------------------------------------ header */
  function header() {
    const now = new Date();
    const h = now.getHours();
    $("#greeting").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    $("#today-date").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (state.data?.generated_at) {
      const g = new Date(state.data.generated_at);
      const sameDay = g.toDateString() === now.toDateString();
      $("#updated").textContent = sameDay
        ? `Updated ${g.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}`
        : `Updated ${timeAgo(state.data.generated_at).toLowerCase()}`;
    }
  }

  /* ------------------------------------------------ load */
  async function load() {
    header();
    try {
      const res = await fetch(`data/briefing.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      state.data = await res.json();
    } catch {
      view.innerHTML = `<div class="empty"><div class="big">☕</div><h2>Your first briefing is brewing</h2>
        <p>It's being put together right now. Check back in a few minutes.</p></div>`;
      return;
    }
    state.byUrl.clear(); state.topics.clear();
    for (const t of state.data.topics) {
      state.topics.set(t.id, t);
      for (const a of t.articles) state.byUrl.set(a.url, { ...a, topic: t.id });
    }
    header();
    readHash();
  }

  // Refresh when the app comes back to the foreground (e.g. the next morning)
  let lastLoad = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastLoad > 30 * 60 * 1000) {
      lastLoad = Date.now(); load();
    }
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  load();
})();
