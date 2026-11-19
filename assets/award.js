/* ==========================================================
   Billy's Public House · award.js
   No dependencies. Everything here is an enhancement:
   without JS the page is complete and fully visible.
   ========================================================== */
(() => {
  "use strict";

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* ---------------- Header: hide on the way down, return on the way up ---------------- */
  const header = document.querySelector("[data-header]");
  let lastY = window.scrollY;
  let travel = 0;

  const onScrollHeader = () => {
    const y = window.scrollY;
    const delta = y - lastY;
    lastY = y;

    header.classList.toggle("is-scrolled", y > 12);

    // Small hysteresis so it doesn't flicker on tiny scroll movements.
    travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
    if (y < window.innerHeight * 0.5 || root.classList.contains("menu-open") || travel < -10) {
      header.classList.remove("is-hidden");
    } else if (travel > 30) {
      header.classList.add("is-hidden");
    }
  };

  /* ---------------- Mobile menu ---------------- */
  const menuButton = document.querySelector("[data-menu-button]");
  const menu = document.querySelector("[data-menu]");

  const setMenu = (open) => {
    menu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.querySelector(".menu-button__label").textContent = open ? "Close" : "Menu";
    root.classList.toggle("menu-open", open);
    root.style.overflow = open ? "hidden" : "";
    if (open) {
      header.classList.remove("is-hidden");
      menu.querySelector("a")?.focus({ preventScroll: true });
    }
  };

  if (menuButton && menu) {
    menuButton.addEventListener("click", () => setMenu(menu.hidden));
    menu.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        setMenu(false);
        menuButton.focus();
      }
    });
    // Leaving the mobile layout with the menu open: close it.
    window.matchMedia("(min-width: 861px)").addEventListener("change", (e) => {
      if (e.matches && !menu.hidden) setMenu(false);
    });
  }

  /* ---------------- Scroll reveal ---------------- */
  const revealEls = document.querySelectorAll("[data-reveal]");

  if (!("IntersectionObserver" in window) || reduceMotion.matches) {
    revealEls.forEach((el) => el.classList.add("is-in"));
  } else {
    // Image frames start clipped to nothing (clip-path), and the browser
    // counts that clip, so a frame would never "intersect". Watch the
    // unclipped <figure> around it instead and reveal the frame.
    const targetOf = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (targetOf.get(entry.target) || entry.target).classList.add("is-in");
          io.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    revealEls.forEach((el) => {
      const watched = el.dataset.reveal === "img" && el.parentElement ? el.parentElement : el;
      targetOf.set(watched, el);
      io.observe(watched);
    });
  }

  /* ---------------- Parallax (decorative images and numerals only) ---------------- */
  const parallaxEls = [...document.querySelectorAll("[data-parallax]")].map((el) => ({
    el,
    factor: parseFloat(el.dataset.parallax) || 0,
    anchor: el.parentElement,
  }));

  const renderParallax = () => {
    if (reduceMotion.matches) return;
    const vh = window.innerHeight;
    parallaxEls.forEach(({ el, factor, anchor }) => {
      const r = anchor.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) return; // far off screen: skip
      const offset = (vh / 2 - (r.top + r.height / 2)) * factor;
      el.style.transform = `translate3d(0, ${(-offset).toFixed(1)}px, 0)`;
    });
  };

  /* ---------------- One scroll loop, synced to the display ---------------- */
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      onScrollHeader();
      renderParallax();
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScrollHeader();
  renderParallax();

  /* ---------------- Live "open now" status (Athens time) ---------------- */
  const status = document.querySelector("[data-status]");
  const OPEN = 18 * 60; // 18:00
  const CLOSE = 1 * 60; // 01:00, the next day

  const updateStatus = () => {
    if (!status) return;
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Athens",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
    } catch {
      return; // keep the static "Open every night" text
    }
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const now = get("hour") * 60 + get("minute");
    const isOpen = now >= OPEN || now < CLOSE;

    status.classList.toggle("is-open", isOpen);
    status.querySelector(".status__text").textContent = isOpen
      ? "Open now · until 01:00"
      : "Closed · opens tonight at 18:00";
  };
  updateStatus();
  setInterval(updateStatus, 60 * 1000);

  /* ---------------- Magnetic buttons (mouse only) ---------------- */
  if (finePointer.matches && !reduceMotion.matches) {
    document.querySelectorAll("[data-magnetic]").forEach((btn) => {
      const MAX = 8; // px, a nudge rather than a chase
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
        const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
        btn.style.translate = `${(x * MAX).toFixed(1)}px ${(y * MAX * 0.6).toFixed(1)}px`;
      });
      btn.addEventListener("pointerleave", () => {
        btn.style.translate = "";
      });
    });
  }
})();
