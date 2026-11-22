/*
 * Tableau de bord privé des visites du portfolio.
 * Lit l'API GoatCounter avec une clé en lecture seule, gardée dans ce navigateur.
 * Tout texte venant de l'API (pages, sites référents…) est inséré avec textContent.
 */
(() => {
  "use strict";

  const SITE = "https://setoudie.goatcounter.com";
  const TOKEN_KEY = "gc-dash-token";
  const RANGE_KEY = "gc-dash-range";
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(n || 0));
  const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  const yearFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const longDayFmt =new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  let regionNames = null;
  try {
    regionNames = new Intl.DisplayNames(["fr"], { type: "region" });
  } catch (e) {
    /* navigateur ancien : on garde les noms anglais */
  }

  /* ---------- Stockage (tolérant aux navigateurs qui le refusent) ---------- */
  let memToken = "";
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
      } catch (e) {
        return key === TOKEN_KEY ? memToken : "";
      }
    },
    set(key, value, persist = true) {
      if (key === TOKEN_KEY) memToken = value;
      try {
        (persist ? localStorage : sessionStorage).setItem(key, value);
      } catch (e) {
        /* reste en mémoire pour cette visite */
      }
    },
    remove(key) {
      if (key === TOKEN_KEY) memToken = "";
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {
        /* rien à faire */
      }
    },
  };

  /* ---------- API : une requête à la fois (limite GoatCounter : 4 par seconde) ---------- */
  class AuthError extends Error {}
  class NetError extends Error {}

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let queue = Promise.resolve();
  let token = "";

  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

  async function request(path, params, attempt = 0) {
    const url = new URL(`${SITE}/api/v0/${path}`);
    Object.entries(params || {}).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
    // GoatCounter refuse vite les rafales (mesuré : 3 ou 4 appels, puis quelques
    // secondes de refus). Un refus arrive souvent sans en-têtes CORS, et le navigateur
    // le présente comme une erreur réseau : on patiente de plus en plus, puis on réessaie.
    const WAITS = [2000, 3000, 4000, 5000, 6000, 8000];
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (attempt < WAITS.length) {
        await sleep(WAITS[attempt]);
        return request(path, params, attempt + 1);
      }
      throw new NetError(e.message);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < WAITS.length) {
      await sleep(WAITS[attempt]);
      return request(path, params, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) throw new AuthError(String(res.status));
    // 404 : GoatCounter n'a encore rien pour cette période (site tout neuf) → données vides
    if (res.status === 404 && path.startsWith("stats/")) return {};
    if (!res.ok) throw new Error(`GoatCounter a répondu ${res.status} sur « ${path} »`);
    return res.json();
  }

  // Une requête à la fois, espacées : chaque appel compte double pour la limite
  // (le navigateur envoie d'abord une vérification CORS à cause de la clé).
  function api(path, params) {
    const p = queue.then(() => request(path, params));
    queue = p.then(
      () => sleep(500),
      () => sleep(500)
    );
    return p;
  }

  /* ---------- Mémoire des derniers chiffres (affichage immédiat) ---------- */
  const cacheKey = (d) => `gc-dash-cache-${d}`;
  function readCache(d) {
    try {
      return JSON.parse(localStorage.getItem(cacheKey(d)) || "null");
    } catch (e) {
      return null;
    }
  }
  function writeCache(d, data) {
    try {
      localStorage.setItem(cacheKey(d), JSON.stringify({ at: Date.now(), data }));
    } catch (e) {
      /* pas de mémoire : on rechargera tout la prochaine fois */
    }
  }
  function clearCache() {
    [1, 7, 30, 90, 365].forEach((d) => {
      try {
        localStorage.removeItem(cacheKey(d));
      } catch (e) {
        /* rien à faire */
      }
    });
  }

  /* ---------- Noms lisibles ---------- */
  const WHERE = {
    menu: "menu",
    accueil: "accueil",
    contact: "section contact",
    projets: "projets",
    parcours: "parcours",
    "a-propos": "à propos",
    formation: "formation",
    distinctions: "distinctions",
    competences: "compétences",
    pied: "pied de page",
    page: "page",
  };
  const NETWORKS = {
    linkedin: "LinkedIn",
    github: "GitHub",
    instagram: "Instagram",
    x: "X",
    "whatsapp-lien": "WhatsApp (lien direct)",
  };

  // Sépare "nom-de-l-evenement-<endroit>" en { base, where }
  function splitWhere(rest) {
    for (const key of Object.keys(WHERE)) {
      if (rest === key) return { base: "", where: key };
      if (rest.endsWith(`-${key}`)) return { base: rest.slice(0, -key.length - 1), where: key };
    }
    return { base: rest, where: "" };
  }

  function describeEvent(name) {
    const fixed = {
      "contact-ouvert": ["contact", "Fenêtre de contact ouverte"],
      "contact-choix-mail": ["contact", "A choisi l'e-mail"],
      "contact-choix-whatsapp": ["contact", "A choisi WhatsApp"],
      "contact-mail-envoye": ["contact", "E-mail envoyé"],
      "contact-whatsapp-ouvert": ["contact", "Message WhatsApp préparé"],
      "mail-copie": ["mail", "Adresse e-mail copiée"],
      telephone: ["phone", "Numéro de téléphone cliqué"],
    };
    if (fixed[name]) return { group: fixed[name][0], label: fixed[name][1], where: "" };
    let m = name.match(/^cv-(.+)$/);
    if (m) return { group: "cv", label: "CV téléchargé", where: m[1] };
    m = name.match(/^mail-lien-(.+)$/);
    if (m) return { group: "mail", label: "Lien e-mail cliqué", where: m[1] };
    m = name.match(/^reseau-(.+)$/);
    if (m) {
      const { base, where } = splitWhere(m[1]);
      const net = base || m[1];
      return { group: "net", label: NETWORKS[net] || net, where };
    }
    return { group: "other", label: name, where: "" };
  }

  // GoatCounter renvoie un identifiant (phone, tablet…) et parfois un nom vide
  const SIZES = {
    phone: "Téléphones",
    largephone: "Grands téléphones",
    tablet: "Tablettes, petits portables",
    desktop: "Ordinateurs",
    desktophd: "Grands écrans",
    unknown: "Inconnu",
    Phones: "Téléphones",
    "Large phones, small tablets": "Grands téléphones",
    "Tablets and small laptops": "Tablettes, petits portables",
    "Computer monitors": "Ordinateurs",
    "Computer monitors larger than HD": "Grands écrans",
  };

  const unknown = (s) => !s || /^\(?(unknown|no data)\)?$/i.test(s);

  function countryName(item) {
    if (unknown(item.name)) return "Inconnu";
    const code = String(item.id || "").toUpperCase();
    if (regionNames && /^[A-Z]{2}$/.test(code)) {
      try {
        return regionNames.of(code) || item.name;
      } catch (e) {
        return item.name;
      }
    }
    return item.name;
  }

  /* ---------- Rendu des listes à barres ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function skeleton(list, rows = 4) {
    list.replaceChildren(...Array.from({ length: rows }, () => el("li", "skeleton")));
  }

  function renderBars(list, items, { accent = "var(--c2)", limit = 7, empty = "Rien pour l'instant", total } = {}) {
    list.replaceChildren();
    if (!items.length) {
      list.append(el("li", "bars-empty", empty));
      return;
    }
    const max = Math.max(...items.map((i) => i.value), 1);
    const sum = total || items.reduce((s, i) => s + i.value, 0) || 1;
    const rows = items.map((it) => {
      const li = el("li", "bar-row");
      li.style.setProperty("--accent", it.accent || accent);
      const label = el("span", "bar-row__label", it.label);
      if (it.title) label.title = it.title;
      if (it.chip) label.append(el("span", "bar-row__chip", it.chip));
      if (it.sub) label.append(el("span", "bar-row__sub", it.sub));
      li.append(label, el("span", "bar-row__val", fmt(it.value)), el("span", "bar-row__pct", `${Math.round((it.value / sum) * 100)} %`));
      // Largeur animée après insertion
      requestAnimationFrame(() => li.style.setProperty("--w", `${(it.value / max) * 100}%`));
      return li;
    });
    rows.forEach((r, i) => {
      if (i >= limit) r.hidden = true;
      list.append(r);
    });
    if (rows.length > limit) {
      const more = el("button", "bars-more", `Voir les ${rows.length - limit} autres`);
      more.type = "button";
      more.addEventListener("click", () => {
        rows.forEach((r) => (r.hidden = false));
        more.remove();
      });
      const li = el("li");
      li.append(more);
      list.append(li);
    }
  }

  /* ---------- Période ---------- */
  let days = Number(store.get(RANGE_KEY)) || 30;
  if (![1, 7, 30, 90, 365].includes(days)) days = 30;

  const TITLES = {
    1: "Les dernières 24 heures",
    7: "Les 7 derniers jours",
    30: "Les 30 derniers jours",
    90: "Les 3 derniers mois",
    365: "Les 12 derniers mois",
  };

  function period(n) {
    const end = new Date();
    end.setMinutes(0, 0, 0);
    end.setHours(end.getHours() + 1); // heure en cours incluse
    const start = new Date(end.getTime() - n * 864e5);
    const prevStart = new Date(start.getTime() - n * 864e5);
    return { start, end, prevStart };
  }

  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  /* ---------- Série du graphique (pages vues, hors événements) ---------- */
  function buildSeries(hits, start, end, n = days) {
    const pages = hits.filter((h) => !h.event);
    const evs = hits.filter((h) => h.event);
    const sumBy = (list, fn) => {
      const map = new Map();
      list.forEach((h) => (h.stats || []).forEach((s) => fn(map, s)));
      return map;
    };

    if (n === 1) {
      const byHour = (list) =>
        sumBy(list, (map, s) =>
          (s.hourly || []).forEach((v, h) => {
            const k = `${s.day} ${h}`;
            map.set(k, (map.get(k) || 0) + v);
          })
        );
      const pv = byHour(pages);
      const ev = byHour(evs);
      const out = [];
      for (let t = new Date(start); t < end; t = new Date(t.getTime() + 36e5)) {
        const k = `${dayKey(t)} ${t.getHours()}`;
        out.push({
          value: pv.get(k) || 0,
          clicks: ev.get(k) || 0,
          title: `${longDayFmt.format(t)}, ${pad(t.getHours())} h – ${pad((t.getHours() + 1) % 24)} h`,
          short: `${pad(t.getHours())} h`,
        });
      }
      return out;
    }

    const byDay = (list) => sumBy(list, (map, s) => map.set(s.day, (map.get(s.day) || 0) + (s.daily || 0)));
    const pv = byDay(pages);
    const ev = byDay(evs);
    const daily = [];
    for (let d = parseDay(dayKey(start)); d < end; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      daily.push({ date: new Date(d), value: pv.get(k) || 0, clicks: ev.get(k) || 0 });
    }
    // Trop de jours : regroupement par semaine
    if (daily.length > 92) {
      const weeks = [];
      for (let i = 0; i < daily.length; i += 7) {
        const chunk = daily.slice(i, i + 7);
        const last = chunk[chunk.length - 1].date;
        weeks.push({
          value: chunk.reduce((s, c) => s + c.value, 0),
          clicks: chunk.reduce((s, c) => s + c.clicks, 0),
          title: `Semaine du ${dayFmt.format(chunk[0].date)} au ${dayFmt.format(last)}`,
          short: dayFmt.format(chunk[0].date),
          date: chunk[0].date,
        });
      }
      return weeks;
    }
    return daily.map((d) => ({
      ...d,
      title: longDayFmt.format(d.date),
      short: dayFmt.format(d.date),
    }));
  }

  /* ---------- Graphique SVG ---------- */
  const chart = $("chart");
  const tip = $("chart-tip");
  const SVG = "http://www.w3.org/2000/svg";
  let lastSeries = [];

  function niceMax(v) {
    if (v <= 4) return 4;
    const raw = v / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    return step * 4;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  }

  function drawChart(series) {
    lastSeries = series;
    tip.hidden = true;
    chart.classList.remove("is-hovering");
    const total = series.reduce((s, p) => s + p.value, 0);
    if (!series.length || total === 0) {
      chart.replaceChildren(
        el(
          "div",
          "chart-empty",
          "Pas encore de visite sur cette période. Les nouvelles visites apparaissent ici quelques minutes après leur passage."
        )
      );
      chart.setAttribute("aria-label", "Aucune visite sur la période");
      return;
    }

    const W = chart.clientWidth;
    const H = chart.clientHeight;
    const padL = 34;
    const padB = 22;
    const padT = 6;
    const plotW = Math.max(10, W - padL);
    const plotH = Math.max(10, H - padB - padT);
    const max = niceMax(Math.max(...series.map((p) => p.value)));
    const n = series.length;
    const slot = plotW / n;
    const barW = Math.max(1, Math.min(26, slot * 0.72));

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });

    // Lignes horizontales + graduations
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = padT + plotH - (v / max) * plotH;
      svg.append(svgEl("line", { class: "grid-line", x1: padL, x2: W, y1: y, y2: y }));
      const t = svgEl("text", { class: "axis", x: padL - 8, y: y + 3, "text-anchor": "end" });
      t.textContent = fmt(v);
      svg.append(t);
    }

    // Étiquettes de l'axe horizontal, espacées pour ne pas se chevaucher
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 62))));
    series.forEach((p, i) => {
      if (i % every !== 0) return;
      const t = svgEl("text", { class: "axis", x: padL + i * slot + slot / 2, y: H - 6, "text-anchor": "middle" });
      t.textContent = p.short;
      svg.append(t);
    });

    const bars = series.map((p, i) => {
      const h = p.value ? Math.max(2, (p.value / max) * plotH) : 0;
      const r = svgEl("rect", {
        class: "bar",
        x: padL + i * slot + (slot - barW) / 2,
        y: padT + plotH - h,
        width: barW,
        height: h,
        rx: Math.min(3, barW / 3),
      });
      svg.append(r);
      return r;
    });

    // Zones de survol (toute la hauteur, plus faciles à viser)
    series.forEach((p, i) => {
      const hit = svgEl("rect", { class: "hit", x: padL + i * slot, y: 0, width: slot, height: H - padB });
      const show = () => {
        chart.classList.add("is-hovering");
        bars.forEach((b, j) => b.classList.toggle("is-on", j === i));
        tip.replaceChildren(el("b", "", p.title));
        tip.append(
          el("span", "", `${fmt(p.value)} visiteur${p.value > 1 ? "s" : ""}`),
          document.createElement("br"),
          el("span", "", `${fmt(p.clicks)} clic${p.clicks > 1 ? "s" : ""} suivi${p.clicks > 1 ? "s" : ""}`)
        );
        tip.hidden = false;
        const panel = chart.parentElement;
        const cx = chart.offsetLeft + padL + i * slot + slot / 2;
        const tw = tip.offsetWidth;
        const left = Math.min(Math.max(8, cx - tw / 2), panel.clientWidth - tw - 8);
        tip.style.left = `${left}px`;
        tip.style.top = `${chart.offsetTop + Math.max(0, padT + plotH - (p.value / max) * plotH - tip.offsetHeight - 10)}px`;
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerdown", show);
      svg.append(hit);
    });
    svg.addEventListener("pointerleave", () => {
      chart.classList.remove("is-hovering");
      tip.hidden = true;
    });

    chart.replaceChildren(svg);
    const best = series.reduce((a, b) => (b.value > a.value ? b : a), series[0]);
    chart.setAttribute(
      "aria-label",
      `${fmt(total)} visiteurs sur la période, maximum ${fmt(best.value)} (${best.title})`
    );
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => lastSeries.length && drawChart(lastSeries), 120);
  });

  /* ---------- Entonnoir de contact ---------- */
  function renderFunnel(ev) {
    const opened = ev["contact-ouvert"] || 0;
    const chMail = ev["contact-choix-mail"] || 0;
    const chWa = ev["contact-choix-whatsapp"] || 0;
    const sentMail = ev["contact-mail-envoye"] || 0;
    const sentWa = ev["contact-whatsapp-ouvert"] || 0;
    const steps = [
      { label: "Fenêtre ouverte", value: opened, accent: "var(--c4)" },
      { label: "Canal choisi", value: chMail + chWa, accent: "var(--c6)", split: `e-mail ${fmt(chMail)} · WhatsApp ${fmt(chWa)}` },
      {
        label: "Message envoyé",
        value: sentMail + sentWa,
        accent: "var(--c1)",
        split: `e-mail envoyé ${fmt(sentMail)} · WhatsApp préparé ${fmt(sentWa)}`,
      },
    ];
    const box = $("funnel");
    box.replaceChildren();
    if (!opened && !(chMail + chWa + sentMail + sentWa)) {
      box.append(el("p", "bars-empty", "Personne n'a encore ouvert la fenêtre de contact sur cette période."));
      return;
    }
    const base = Math.max(...steps.map((s) => s.value), 1);
    steps.forEach((s, i) => {
      const row = el("div", "funnel__step");
      const top = el("div", "funnel__top");
      const num = el("span", "funnel__num", fmt(s.value));
      if (i > 0 && steps[0].value) num.append(el("small", "", `${Math.round((s.value / steps[0].value) * 100)} %`));
      top.append(el("span", "", s.label), num);
      const track = el("div", "funnel__track");
      const fill = el("div", "funnel__fill");
      fill.style.setProperty("--accent", s.accent);
      track.append(fill);
      requestAnimationFrame(() => fill.style.setProperty("--w", `${(s.value / base) * 100}%`));
      row.append(top, track);
      if (s.split) row.append(el("span", "funnel__split", s.split));
      box.append(row);
    });
  }

  /* ---------- Chargement des données ---------- */
  const ui = {
    gate: $("gate"),
    dash: $("dash"),
    range: $("range"),
    refresh: $("refresh"),
    logout: $("logout"),
  };
  let loading = 0;

  function setDelta(node, cur, prev) {
    node.replaceChildren();
    if (!prev && !cur) return;
    if (!prev) {
      node.append(el("span", "up", "nouveau"), document.createTextNode(" par rapport à la période précédente"));
      return;
    }
    const pct = Math.round(((cur - prev) / prev) * 100);
    const span = el("span", pct >= 0 ? "up" : "down", `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)} %`);
    node.append(span, document.createTextNode(` vs période précédente (${fmt(prev)})`));
  }

  function showError(msg) {
    const box = $("dash-error");
    box.textContent = msg;
    box.hidden = !msg;
  }

  /* ---------- Rendu des différentes parties ---------- */
  const visitorsOf = (t) => Math.max(0, ((t && t.total) || 0) - ((t && t.total_events) || 0));

  function eventsOf(hits) {
    const ev = {};
    hits.filter((h) => h.event).forEach((h) => (ev[h.path] = (ev[h.path] || 0) + (h.count || 0)));
    return ev;
  }

  // Haut de page : chiffres clés, graphique, contact, clics, pages, événements
  function renderTop(d) {
    const hits = d.hits;
    const visitors = visitorsOf(d.total);
    const ev = eventsOf(hits);
    const sumWhere = (re) => Object.entries(ev).reduce((s, [k, v]) => (re.test(k) ? s + v : s), 0);
    const n = d.days;

    $("k-visitors").textContent = fmt(visitors);
    const series = buildSeries(hits, new Date(d.start), new Date(d.end), n);
    drawChart(series);
    const best = series.reduce((a, b) => (b.value > a.value ? b : a), series[0] || { value: 0 });
    if (n === 1) {
      $("k-avg-label").textContent = "Heure la plus active";
      $("k-avg").textContent = best.value ? best.short : "–";
      $("k-avg-sub").textContent = best.value ? `${fmt(best.value)} visiteur${best.value > 1 ? "s" : ""}` : "";
    } else {
      $("k-avg-label").textContent = "Par jour en moyenne";
      const avg = visitors / n;
      $("k-avg").textContent = avg >= 10 || avg === 0 ? fmt(avg) : avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
      const weekly = series.length && /^Semaine/.test(series[0].title);
      $("k-avg-sub").textContent = best.value
        ? `${weekly ? "Meilleure semaine : du" : "Meilleur jour :"} ${best.short} (${fmt(best.value)})`
        : "";
    }
    const cv = sumWhere(/^cv-/);
    $("k-cv").textContent = fmt(cv);
    $("k-cv-sub").textContent = visitors ? `${Math.round((cv / visitors) * 100)} % des visiteurs` : "";
    const sentMail = ev["contact-mail-envoye"] || 0;
    const sentWa = ev["contact-whatsapp-ouvert"] || 0;
    $("k-contact").textContent = fmt(sentMail + sentWa);
    $("k-contact-sub").textContent = `e-mail ${fmt(sentMail)} · WhatsApp ${fmt(sentWa)}`;

    renderFunnel(ev);

    // Clics regroupés : CV, réseaux, e-mail, téléphone (le contact est dans l'entonnoir)
    const groups = new Map();
    Object.entries(ev).forEach(([name, value]) => {
      const e = describeEvent(name);
      if (e.group === "contact") return;
      const g = groups.get(e.label) || { label: e.label, value: 0, where: {} };
      g.value += value;
      if (e.where) g.where[e.where] = (g.where[e.where] || 0) + value;
      groups.set(e.label, g);
    });
    const ACCENTS = { "CV téléchargé": "var(--c3)", LinkedIn: "var(--c6)", GitHub: "var(--c4)", Instagram: "var(--c5)" };
    renderBars(
      $("actions"),
      [...groups.values()]
        .sort((a, b) => b.value - a.value)
        .map((g) => ({
          label: g.label,
          value: g.value,
          accent: ACCENTS[g.label] || "var(--c2)",
          sub: Object.entries(g.where)
            .sort((a, b) => b[1] - a[1])
            .map(([w, v]) => `${WHERE[w] || w} ${fmt(v)}`)
            .join(" · "),
        })),
      { empty: "Aucun clic suivi sur cette période." }
    );

    renderBars(
      $("pages"),
      hits
        .filter((h) => !h.event)
        .sort((a, b) => b.count - a.count)
        .map((h) => {
          const isHome = h.path === "/" || h.path === "/index.html";
          const is404 = /introuvable/i.test(h.title || "");
          return {
            label: isHome ? "Accueil" : h.path,
            title: `${h.path}${h.title ? ` — ${h.title}` : ""}`,
            chip: is404 ? "404" : "",
            sub: isHome ? h.path : "",
            value: h.count || 0,
            accent: is404 ? "var(--c1)" : "var(--c2)",
          };
        }),
      { empty: "Aucune page vue sur cette période." }
    );

    renderBars(
      $("events"),
      Object.entries(ev)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => {
          const e = describeEvent(name);
          return { label: e.label, sub: e.where ? WHERE[e.where] || e.where : "", chip: name, value, accent: "var(--c3)" };
        }),
      { limit: 50, empty: "Aucun événement sur cette période." }
    );
  }

  const REF_NAMES = { ig: "Instagram", fb: "Facebook", li: "LinkedIn", wa: "WhatsApp" };

  const LISTS = {
    refs: (rows) =>
      renderBars(
        $("refs"),
        rows.map((r) => ({
          label: unknown(r.name) ? "Accès direct ou masqué" : REF_NAMES[r.name] || r.name,
          chip: r.ref_scheme === "c" ? "campagne" : "",
          value: r.count,
          accent: "var(--c4)",
        })),
        { empty: "Pas encore de site référent." }
      ),
    locations: (rows) =>
      renderBars(
        $("locations"),
        rows.map((l) => ({ label: countryName(l), value: l.count, accent: "var(--c6)" })),
        { empty: "Pas encore de données." }
      ),
    sizes: (rows) =>
      renderBars(
        $("sizes"),
        rows.map((s) => ({
          label: SIZES[s.id] || SIZES[s.name] || (unknown(s.name) ? s.id || "Inconnu" : s.name),
          value: s.count,
          accent: "var(--c5)",
        })),
        { limit: 5, empty: "Pas encore de données." }
      ),
    browsers: (rows) =>
      renderBars(
        $("browsers"),
        rows.map((s) => ({ label: unknown(s.name) ? "Inconnu" : s.name, value: s.count, accent: "var(--c7)" })),
        { limit: 5, empty: "Pas encore de données." }
      ),
    systems: (rows) =>
      renderBars(
        $("systems"),
        rows.map((s) => ({ label: unknown(s.name) ? "Inconnu" : s.name, value: s.count, accent: "var(--c3)" })),
        { limit: 5, empty: "Pas encore de données." }
      ),
  };

  function renderPart(key, d) {
    if ((key === "total" || key === "hits") && d.total && d.hits) renderTop(d);
    if ((key === "prev" || key === "total") && d.total && d.prev) setDelta($("k-visitors-delta"), visitorsOf(d.total), visitorsOf(d.prev));
    if (LISTS[key] && d[key]) LISTS[key](d[key]);
  }

  function renderAll(d) {
    ["total", "hits", "prev", ...Object.keys(LISTS)].forEach((k) => d[k] && renderPart(k, d));
  }

  function periodLabel(d, at) {
    const start = new Date(d.start);
    const f = d.days >= 90 ? yearFmt : dayFmt;
    const range = d.days === 1 ? `Depuis hier ${timeFmt.format(start)}` : `Du ${f.format(start)} au ${f.format(at)}`;
    return `${range} · mis à jour à ${timeFmt.format(at)}`;
  }

  /* ---------- Chargement : mémoire d'abord, puis GoatCounter partie par partie ---------- */
  async function load() {
    const run = ++loading;
    const n = days;
    const { start, end, prevStart } = period(n);
    const range = { start: iso(start), end: iso(end) };

    $("dash-title").textContent = TITLES[n];
    ui.refresh.classList.add("is-loading");
    showError("");

    const cached = readCache(n);
    if (cached && cached.data && cached.data.total && cached.data.hits) {
      renderAll(cached.data);
      $("dash-meta").textContent = `Chiffres de ${timeFmt.format(new Date(cached.at))} · mise à jour en cours…`;
    } else {
      $("dash-meta").textContent = "Chargement…";
      ["actions", "refs", "locations", "sizes", "browsers", "systems", "pages", "events"].forEach((id) =>
        skeleton($(id), id === "sizes" || id === "browsers" || id === "systems" ? 3 : 4)
      );
      $("funnel").replaceChildren(el("div", "skeleton"), el("div", "skeleton"), el("div", "skeleton"));
      ["k-visitors", "k-avg", "k-cv", "k-contact"].forEach((id) => ($(id).textContent = "–"));
    }

    const stats = async (page, limit) => ((await api(`stats/${page}`, { ...range, limit })).stats || []).filter((s) => s.count > 0);
    // Ordre : le plus utile d'abord
    const steps = [
      ["total", () => api("stats/total", range)],
      ["hits", async () => (await api("stats/hits", { ...range, limit: 100 })).hits || []],
      ["refs", () => stats("toprefs", 20)],
      ["locations", () => stats("locations", 20)],
      ["prev", () => api("stats/total", { start: iso(prevStart), end: iso(start) })],
      ["sizes", () => stats("sizes", 10)],
      ["browsers", () => stats("browsers", 10)],
      ["systems", () => stats("systems", 10)],
    ];
    const fresh = { days: n, start: range.start, end: range.end };

    try {
      for (const [key, get] of steps) {
        const value = await get();
        if (run !== loading) return;
        fresh[key] = value;
        renderPart(key, fresh);
      }
      writeCache(n, fresh);
      $("dash-meta").textContent = periodLabel(fresh, new Date());
    } catch (err) {
      if (run !== loading) return;
      if (err instanceof AuthError) {
        logout("Cette clé a été refusée par GoatCounter (révoquée, ou sans la permission « Read statistics »).");
        return;
      }
      $("dash-meta").textContent = cached ? `Chiffres de ${timeFmt.format(new Date(cached.at))}` : "Données incomplètes";
      showError(
        err instanceof NetError
          ? "GoatCounter ne répond pas pour le moment (trop de requêtes, réseau, ou bloqueur de pub qui bloque goatcounter.com). Réessayez dans une minute avec le bouton Actualiser."
          : `Erreur pendant le chargement : ${err.message}`
      );
    } finally {
      if (run === loading) ui.refresh.classList.remove("is-loading");
    }
  }

  /* ---------- Écrans ---------- */
  function showGate(message) {
    ui.dash.hidden = true;
    ui.range.hidden = true;
    ui.refresh.hidden = true;
    ui.logout.hidden = true;
    if (ui.toMobile) ui.toMobile.hidden = true;
    ui.gate.hidden = false;
    const err = $("gate-error");
    err.textContent = message || "";
    err.hidden = !message;
    $("token").focus();
  }

  function showDash() {
    ui.gate.hidden = true;
    ui.dash.hidden = false;
    ui.range.hidden = false;
    ui.refresh.hidden = false;
    ui.logout.hidden = false;
    if (ui.toMobile) ui.toMobile.hidden = false;
    ui.range.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days)));
  }

  function logout(message) {
    loading++;
    token = "";
    store.remove(TOKEN_KEY);
    clearCache();
    $("token").value = "";
    showGate(message);
  }

  $("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("token").value.trim();
    if (!value) return;
    const btn = $("gate-submit");
    btn.disabled = true;
    btn.textContent = "Vérification…";
    token = value;
    try {
      const now = new Date();
      await api("stats/total", { start: iso(new Date(now.getTime() - 36e5)), end: iso(now) });
      store.set(TOKEN_KEY, value, $("remember").checked);
      showDash();
      load();
    } catch (err) {
      token = "";
      showGate(
        err instanceof AuthError
          ? "Clé refusée. Vérifiez qu'elle est complète et qu'elle a la permission « Read statistics »."
          : err instanceof NetError
            ? "Impossible de joindre GoatCounter. Un bloqueur de pub bloque peut-être goatcounter.com : autorisez cette page, puis réessayez."
            : err.message
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Ouvrir le tableau de bord";
    }
  });

  ui.range.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-days]");
    if (!b) return;
    days = Number(b.dataset.days);
    store.set(RANGE_KEY, String(days));
    showDash();
    load();
  });

  ui.refresh.addEventListener("click", () => load());
  ui.logout.addEventListener("click", () => logout(""));

  // Actualisation automatique quand l'onglet est visible
  setInterval(() => {
    if (token && !ui.dash.hidden && document.visibilityState === "visible") load();
  }, AUTO_REFRESH_MS);

  /* ---------- Thème ---------- */
  const root = document.documentElement;
  const themeMeta = $("theme-color");
  $("theme-toggle").addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    if (themeMeta) themeMeta.setAttribute("content", next === "light" ? "#f6f4fb" : "#14111f");
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      /* choix valable pour cette visite */
    }
  });

  /* ---------- Ouvrir sur mobile : QR code avec la clé dans le #fragment ---------- */
  // Le fragment (#…) n'est jamais envoyé au serveur ; la page le lit puis l'efface de l'adresse.
  const qrDialog = $("qr-dialog");
  const qrBox = $("qr-code");
  let qrLib = null;

  function loadQrLib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLib) {
      qrLib = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
        s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("QR indisponible")));
        s.onerror = () => {
          qrLib = null;
          reject(new Error("QR indisponible"));
        };
        document.head.append(s);
      });
    }
    return qrLib;
  }

  ui.toMobile = $("to-mobile");
  ui.toMobile.addEventListener("click", async () => {
    if (!token || typeof qrDialog.showModal !== "function") return;
    qrBox.textContent = "Génération du QR code…";
    qrDialog.showModal();
    try {
      const qrcode = await loadQrLib();
      const qr = qrcode(0, "M");
      qr.addData(`${location.origin}${location.pathname}#cle=${encodeURIComponent(token)}`);
      qr.make();
      // SVG produit par la bibliothèque à partir de notre propre adresse
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      qrBox.textContent = "Impossible de générer le QR code (connexion ou bloqueur). Collez la clé à la main sur le téléphone.";
    }
  });
  const closeQr = () => qrDialog.open && qrDialog.close();
  $("qr-close").addEventListener("click", closeQr);
  qrDialog.addEventListener("click", (e) => e.target === qrDialog && closeQr());
  // Le QR ne reste pas dans la page une fois la fenêtre fermée
  qrDialog.addEventListener("close", () => qrBox.replaceChildren());

  /* ---------- Démarrage ---------- */
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("cle");
  if (fromLink) {
    store.set(TOKEN_KEY, fromLink.trim(), true);
    history.replaceState(null, "", location.pathname + location.search);
  }
  token = store.get(TOKEN_KEY);
  if (token) {
    showDash();
    load();
  } else {
    showGate();
  }
})();
