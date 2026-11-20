(() => {
  "use strict";

  const CONTACT_EMAIL = "diedhiousenytoutou@outlook.com";
  const WHATSAPP_NUMBER = "221775878934";

  const root = document.documentElement;
  const nav = document.getElementById("nav");
  const toggle = nav.querySelector(".nav__toggle");
  const links = Array.from(nav.querySelectorAll(".nav__links a"));

  /* ---------- Thème clair / sombre (sombre par défaut) ---------- */
  const themeBtn = document.getElementById("theme-toggle");
  const themeMeta = document.getElementById("theme-color");

  const applyTheme = (theme) => {
    root.setAttribute("data-theme", theme);
    const light = theme === "light";
    themeBtn.setAttribute("aria-label", light ? "Passer en mode sombre" : "Passer en mode clair");
    if (themeMeta) themeMeta.setAttribute("content", light ? "#f6f4fb" : "#14111f");
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  };

  applyTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");

  themeBtn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
    applyTheme(next);
  });

  /* ---------- Barre de navigation ---------- */
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const closeMenu = () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Menu";
  };
  toggle.addEventListener("click", () => {
    const open = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Fermer" : "Menu";
  });
  links.forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      closeMenu();
      toggle.focus();
    }
  });

  /* Lien actif selon la section visible + apparition au défilement */
  const sectionLinks = links.filter((a) => a.hash);
  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          sectionLinks.forEach((a) => a.classList.toggle("is-active", a.hash === `#${entry.target.id}`));
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sectionLinks.forEach((a) => {
      const target = document.querySelector(a.hash);
      if (target) spy.observe(target);
    });

    const reveal = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            reveal.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));
  } else {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- Toast ---------- */
  const toast = document.getElementById("toast");
  let toastTimer = 0;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  };

  /* Copier l'adresse e-mail */
  const copyBtn = document.getElementById("copy-mail");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.mail);
      showToast("Adresse copiée");
    } catch {
      showToast("Copie impossible : sélectionnez l'adresse à la main");
    }
  });

  /* ---------- Fenêtre « Écrivez-moi » ---------- */
  const dialog = document.getElementById("contact-dialog");
  const form = document.getElementById("contact-form");
  const status = document.getElementById("cf-status");
  const submitBtn = document.getElementById("cf-submit");
  const supportsDialog = dialog && typeof dialog.showModal === "function";

  const setStatus = (text, state) => {
    status.textContent = text;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  };

  document.querySelectorAll("[data-open-contact]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!supportsDialog) return; // vieux navigateur : on garde le lien vers la section contact
      e.preventDefault();
      closeMenu();
      setStatus("");
      dialog.showModal();
      document.getElementById("cf-name").focus();
    });
  });

  if (supportsDialog) {
    dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
    // Clic sur le fond : fermer
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.elements._honey.value) return; // robot

    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const message = form.elements.message.value.trim();

    if (!name || !message) {
      setStatus("Indiquez votre nom et votre message.", "error");
      (name ? form.elements.message : form.elements.name).focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Indiquez une adresse e-mail valide pour que je puisse vous répondre.", "error");
      form.elements.email.focus();
      return;
    }

    // 1. WhatsApp : ouvert tout de suite (dans le clic, sinon le navigateur bloque la fenêtre)
    const waText = `Bonjour Seny, je suis ${name} (${email}).\n\n${message}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waText)}`, "_blank", "noopener");

    // 2. E-mail : envoyé directement
    submitBtn.disabled = true;
    setStatus("Envoi de l'e-mail…");
    try {
      const res = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name,
          email,
          message,
          _subject: `Portfolio : message de ${name}`,
          _replyto: email,
          _template: "table",
          _captcha: "false",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || String(data.success) !== "true") throw new Error(data.message || res.status);

      form.reset();
      setStatus("E-mail envoyé. Pensez à appuyer sur Envoyer dans WhatsApp. Je vous réponds vite.", "ok");
    } catch (err) {
      setStatus(
        `L'e-mail n'est pas parti. Écrivez-moi directement à ${CONTACT_EMAIL}, votre message WhatsApp reste valable.`,
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* Année du pied de page */
  document.getElementById("year").textContent = String(new Date().getFullYear());
})();
