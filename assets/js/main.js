(() => {
  "use strict";

  const nav = document.getElementById("nav");
  const toggle = nav.querySelector(".nav__toggle");
  const links = Array.from(nav.querySelectorAll(".nav__links a"));

  /* Fond de la barre de navigation après le haut de page */
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* Menu mobile */
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

  /* Lien actif selon la section visible */
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

    /* Apparition au défilement */
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

  /* Copier l'adresse e-mail */
  const toast = document.getElementById("toast");
  let toastTimer = 0;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };

  const copyBtn = document.getElementById("copy-mail");
  copyBtn.addEventListener("click", async () => {
    const mail = copyBtn.dataset.mail;
    try {
      await navigator.clipboard.writeText(mail);
      showToast("Adresse copiée");
    } catch {
      showToast("Copie impossible : sélectionnez l'adresse à la main");
    }
  });

  /* Année du pied de page */
  document.getElementById("year").textContent = String(new Date().getFullYear());
})();
