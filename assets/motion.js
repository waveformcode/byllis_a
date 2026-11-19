/* ==========================================================
   motion.js
   Fluid interactions for Billy's, no dependencies.
   - Springs use Apple's two parameters: damping ratio + response.
   - Every animation starts from the current on-screen value,
     inherits the finger's velocity and can be grabbed mid-flight.
   ========================================================== */
(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("js");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isReduced = () => reduceMotion.matches;

  // iOS Safari only applies :active on touch if a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });

  /* ---------------- Physics helpers ---------------- */

  class Spring {
    constructor(value, { damping = 1, response = 0.4, epsilon = 0.1 } = {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.damping = damping;
      this.response = response;
      this.epsilon = epsilon;
    }

    config(damping, response) {
      this.damping = damping;
      this.response = response;
      return this;
    }

    // Holds the value in place (used while a finger drives it).
    hold(value) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
    }

    step(dt) {
      const stiffness = (2 * Math.PI / this.response) ** 2;
      const friction = (4 * Math.PI * this.damping) / this.response;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const force = -stiffness * (this.value - this.target) - friction * this.velocity;
        this.velocity += force * h;
        this.value += this.velocity * h;
      }
    }

    get settled() {
      return (
        Math.abs(this.value - this.target) < this.epsilon &&
        Math.abs(this.velocity) < this.epsilon * 10
      );
    }

    settle() {
      this.value = this.target;
      this.velocity = 0;
    }
  }

  // Runs a set of springs on the display clock until they all rest.
  function createLoop(springs, render, onRest) {
    let frame = 0;
    let last = 0;

    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      springs.forEach((s) => s.step(dt));
      if (springs.every((s) => s.settled)) {
        springs.forEach((s) => s.settle());
        render();
        frame = 0;
        onRest();
        return;
      }
      render();
      frame = requestAnimationFrame(tick);
    };

    return {
      start() {
        if (frame) return;
        last = performance.now();
        frame = requestAnimationFrame(tick);
      },
      stop() {
        cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }

  // Keeps the last ~100ms of pointer samples to measure release velocity.
  function createTracker() {
    let samples = [];
    return {
      reset() {
        samples = [];
      },
      add(x, y, t) {
        samples.push({ x, y, t });
        while (samples.length > 2 && t - samples[0].t > 100) samples.shift();
      },
      velocity() {
        if (samples.length < 2) return { x: 0, y: 0 };
        const a = samples[0];
        const b = samples[samples.length - 1];
        const dt = Math.max((b.t - a.t) / 1000, 1 / 120);
        return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      },
    };
  }

  // Apple's momentum projection (Designing Fluid Interfaces, WWDC 2018).
  const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

  // Progressive resistance past a boundary.
  const rubberband = (overshoot, dimension, c = 0.55) =>
    (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const DRAG_THRESHOLD = 10;

  /* ---------------- Header ---------------- */

  const header = document.querySelector("header");

  const setHeaderHeight = () =>
    root.style.setProperty("--header-h", `${header.offsetHeight}px`);
  setHeaderHeight();
  window.addEventListener("resize", setHeaderHeight);

  let lastScrollY = window.scrollY;
  let scrollTravel = 0;
  let keepHeaderUntil = 0;

  const onScroll = () => {
    const y = window.scrollY;
    const delta = y - lastScrollY;
    lastScrollY = y;

    header.classList.toggle("is-scrolled", y > 8);

    // Hysteresis: hide after 24px of downward travel, show on 8px up.
    scrollTravel = Math.sign(delta) === Math.sign(scrollTravel) ? scrollTravel + delta : delta;
    const menuOpen = root.classList.contains("menu-open");
    if (y < header.offsetHeight * 2 || menuOpen || scrollTravel < -8) {
      header.classList.remove("is-hidden");
    } else if (scrollTravel > 24 && performance.now() > keepHeaderUntil) {
      header.classList.add("is-hidden");
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Jumping to a section should not hide the header we just used.
  document.querySelectorAll('a[href^="#"]').forEach((link) =>
    link.addEventListener("click", () => {
      scrollTravel = 0;
      keepHeaderUntil = performance.now() + 1500;
    })
  );

  /* ---------------- Mobile menu sheet ---------------- */

  const menuButton = document.querySelector(".menu-button");
  const sheet = document.querySelector(".menu-sheet");
  const scrim = document.querySelector(".menu-scrim");

  if (menuButton && sheet && scrim) {
    let sheetHeight = 0;
    let isOpen = false;
    const y = new Spring(0, { epsilon: 0.5 });

    const renderSheet = () => {
      if (isReduced()) return;
      sheet.style.transform = `translateY(${y.value}px)`;
      scrim.style.opacity = clamp01(1 + y.value / sheetHeight);
    };

    const sheetLoop = createLoop([y], renderSheet, () => {
      if (!isOpen) {
        sheet.hidden = true;
        scrim.hidden = true;
      }
    });

    const setOpenState = (open) => {
      isOpen = open;
      root.classList.toggle("menu-open", open);
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "Close menu" : "Menu");
      if (open) header.classList.remove("is-hidden");
    };

    const openMenu = (velocity = 0) => {
      const wasHidden = sheet.hidden;
      sheet.hidden = false;
      scrim.hidden = false;
      sheetHeight = sheet.offsetHeight;
      setOpenState(true);

      if (isReduced()) {
        sheet.style.opacity = 0;
        scrim.style.opacity = 0;
        requestAnimationFrame(() => {
          sheet.style.opacity = 1;
          scrim.style.opacity = 1;
        });
        return;
      }
      if (wasHidden) y.hold(-sheetHeight);
      // Plain open: no overshoot. Thrown open: a little bounce.
      y.config(velocity ? 0.8 : 1, velocity ? 0.3 : 0.4);
      y.target = 0;
      if (velocity) y.velocity = velocity;
      sheetLoop.start();
    };

    const closeMenu = (velocity = 0) => {
      if (!isOpen) return;
      setOpenState(false);

      if (isReduced()) {
        sheet.style.opacity = 0;
        scrim.style.opacity = 0;
        setTimeout(() => {
          if (!isOpen) {
            sheet.hidden = true;
            scrim.hidden = true;
          }
        }, 200);
        return;
      }
      y.config(1, velocity ? 0.3 : 0.35);
      y.target = -sheetHeight;
      if (velocity) y.velocity = velocity;
      sheetLoop.start();
    };

    // The button retargets the same spring, so tapping it mid-flight reverses smoothly.
    menuButton.addEventListener("click", () => (isOpen ? closeMenu() : openMenu()));
    scrim.addEventListener("click", () => closeMenu());
    sheet.querySelectorAll("ul a").forEach((a) => a.addEventListener("click", () => closeMenu()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) {
        closeMenu();
        menuButton.focus();
      }
    });
    window.matchMedia("(min-width: 821px)").addEventListener("change", (e) => {
      if (e.matches && isOpen) {
        setOpenState(false);
        sheetLoop.stop();
        sheet.hidden = true;
        scrim.hidden = true;
      }
    });

    // Drag the sheet up to dismiss; it follows the finger 1:1.
    const tracker = createTracker();
    let pointerId = null;
    let startY = 0;
    let startValue = 0;
    let dragging = false;
    let suppressClick = false;

    sheet.addEventListener("pointerdown", (e) => {
      if (isReduced() || pointerId !== null) return;
      pointerId = e.pointerId;
      startY = e.clientY;
      startValue = y.value;
      dragging = false;
      tracker.reset();
      tracker.add(0, e.clientY, e.timeStamp);
    });

    sheet.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        sheet.setPointerCapture(e.pointerId);
        sheetLoop.stop(); // grab it wherever it is, even mid-animation
        startY = e.clientY;
        startValue = y.value;
      }
      tracker.add(0, e.clientY, e.timeStamp);
      let next = startValue + (e.clientY - startY);
      if (next > 0) next = rubberband(next, sheetHeight); // can't open further than open
      y.hold(next);
      renderSheet();
    });

    const endDrag = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      const v = tracker.velocity().y;
      const projected = y.value + project(v);
      // Decide on where the throw is heading, not where the finger let go.
      if (projected < -sheetHeight / 2) closeMenu(v);
      else openMenu(v);
    };
    sheet.addEventListener("pointerup", endDrag);
    sheet.addEventListener("pointercancel", endDrag);

    // A drag that ends on a link should not also follow it.
    sheet.addEventListener(
      "click",
      (e) => {
        if (suppressClick) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick = false;
        }
      },
      true
    );
  }

  /* ---------------- Lightbox ---------------- */

  const thumbs = document.querySelectorAll(
    ".billiards-photos img, .about-photos img, .bar-games-img img"
  );

  if (thumbs.length) {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.tabIndex = -1;
    const boxScrim = document.createElement("div");
    boxScrim.className = "lightbox-scrim";
    const img = document.createElement("img");
    img.className = "lightbox-img";
    img.draggable = false;
    box.append(boxScrim, img);
    document.body.append(box);

    // progress: 0 = sitting in the grid, 1 = full screen
    const progress = new Spring(0, { epsilon: 0.001 });
    const offsetX = new Spring(0, { epsilon: 0.3 });
    const offsetY = new Spring(0, { epsilon: 0.3 });

    let active = null; // the thumbnail that is open
    let from = null; // thumbnail geometry
    let to = null; // full-screen geometry
    let isClosing = false;

    const measure = () => {
      const r = active.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = vw < 640 ? 0 : 48;
      const nw = active.naturalWidth || r.width;
      const nh = active.naturalHeight || r.height;
      const fit = Math.min((vw - pad * 2) / nw, (vh - pad * 2) / nh);
      to = { w: nw * fit, h: nh * fit, cx: vw / 2, cy: vh / 2 };
      // The thumbnail is object-fit: cover, so start as a cropped, scaled-down
      // copy of the full image that lines up exactly with it.
      const s = Math.max(r.width / to.w, r.height / to.h);
      from = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        scale: s,
        insetX: (to.w - r.width / s) / 2,
        insetY: (to.h - r.height / s) / 2,
      };
      img.style.width = `${to.w}px`;
      img.style.height = `${to.h}px`;
    };

    const renderBox = () => {
      const p = isReduced() ? 1 : progress.value;
      const pc = clamp01(p);
      const vh = window.innerHeight;
      const pull = clamp01(Math.hypot(offsetX.value, offsetY.value) / (vh * 0.6));
      const scale = lerp(from.scale, 1, p) * (1 - pull * 0.35);
      const cx = lerp(from.cx, to.cx, p) + offsetX.value;
      const cy = lerp(from.cy, to.cy, p) + offsetY.value;
      const ix = Math.max(0, lerp(from.insetX, 0, pc));
      const iy = Math.max(0, lerp(from.insetY, 0, pc));
      img.style.transform = `translate(${cx - to.w / 2}px, ${cy - to.h / 2}px) scale(${scale})`;
      img.style.clipPath = `inset(${iy}px ${ix}px round ${(pc * 4) / scale}px)`;
      boxScrim.style.opacity = isReduced() ? 1 : pc * (1 - pull);
      box.style.opacity = isReduced() ? clamp01(progress.value) : 1;
    };

    const finishClose = () => {
      active.style.visibility = "";
      box.hidden = true;
      root.style.overflow = "";
      const thumb = active;
      active = null;
      isClosing = false;
      thumb.focus({ preventScroll: true });
    };

    const boxLoop = createLoop([progress, offsetX, offsetY], renderBox, () => {
      if (isClosing) finishClose();
    });

    const openPhoto = (thumb) => {
      if (active) return;
      active = thumb;
      isClosing = false;
      img.src = thumb.currentSrc || thumb.src;
      img.alt = thumb.alt;
      box.setAttribute("aria-label", thumb.alt);
      measure();
      progress.hold(0);
      offsetX.hold(0);
      offsetY.hold(0);
      progress.config(1, isReduced() ? 0.25 : 0.42);
      progress.target = 1;
      thumb.style.visibility = "hidden";
      box.hidden = false;
      root.style.overflow = "hidden";
      renderBox();
      box.focus({ preventScroll: true });
      boxLoop.start();
    };

    const closePhoto = (vx = 0, vy = 0) => {
      if (!active) return;
      isClosing = true;
      measure(); // the grid may have moved; fly home to where it is now
      progress.config(1, isReduced() ? 0.25 : 0.4);
      progress.target = 0;
      offsetX.config(1, 0.4);
      offsetY.config(1, 0.4);
      offsetX.target = 0;
      offsetY.target = 0;
      // Hand the finger's velocity to the springs: no seam at release.
      offsetX.velocity = vx;
      offsetY.velocity = vy;
      boxLoop.start();
    };

    thumbs.forEach((thumb) => {
      thumb.classList.add("zoomable");
      thumb.tabIndex = 0;
      thumb.setAttribute("role", "button");
      thumb.addEventListener("click", () => openPhoto(thumb));
      thumb.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPhoto(thumb);
        }
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && active && !isClosing) closePhoto();
    });
    window.addEventListener("resize", () => {
      if (active) {
        measure();
        renderBox();
      }
    });

    // Drag the photo anywhere; let go with enough throw and it flies home.
    const tracker = createTracker();
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let moved = false;

    box.addEventListener("pointerdown", (e) => {
      if (!active || pointerId !== null) return;
      pointerId = e.pointerId;
      box.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
      tracker.reset();
      tracker.add(e.clientX, e.clientY, e.timeStamp);
    });

    box.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved) {
        if (isReduced() || Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        moved = true;
        // Grabbing a photo that is flying home pulls it back open.
        if (isClosing) {
          isClosing = false;
          progress.config(1, 0.42);
          progress.target = 1;
        }
        startX = e.clientX;
        startY = e.clientY;
        baseX = offsetX.value;
        baseY = offsetY.value;
        boxLoop.start();
      }
      tracker.add(e.clientX, e.clientY, e.timeStamp);
      offsetX.hold(baseX + (e.clientX - startX));
      offsetY.hold(baseY + (e.clientY - startY));
      renderBox();
    });

    const endPhotoDrag = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (!moved) {
        // A tap anywhere closes, like Photos.
        if (!isClosing) closePhoto();
        return;
      }
      const v = tracker.velocity();
      const px = offsetX.value + project(v.x);
      const py = offsetY.value + project(v.y);
      if (Math.hypot(px, py) > window.innerHeight * 0.18) {
        closePhoto(v.x, v.y);
      } else {
        // Snap back. It was thrown, so a touch of bounce is earned.
        offsetX.config(0.8, 0.35);
        offsetY.config(0.8, 0.35);
        offsetX.target = 0;
        offsetY.target = 0;
        offsetX.velocity = v.x;
        offsetY.velocity = v.y;
        boxLoop.start();
      }
    };
    box.addEventListener("pointerup", endPhotoDrag);
    box.addEventListener("pointercancel", endPhotoDrag);
  }

  /* ---------------- Scroll reveal ---------------- */

  const heroImg = document.querySelector(".hero img");
  const revealItems = [
    ...(heroImg ? [heroImg] : []),
    ...document.querySelectorAll(
      ".typography > *, .billiards-photos img, .about-photos img, .bar-games-img"
    ),
  ];

  revealItems.forEach((el) => {
    el.classList.add("reveal");
    if (el === heroImg) el.classList.add("reveal-hero");
    else if (el.matches("img, .bar-games-img")) el.classList.add("reveal-media");
  });

  const show = (el, delay) => {
    el.style.transitionDelay = `${delay}ms`;
    el.classList.add("is-visible");
    el.addEventListener(
      "transitionend",
      () => {
        el.style.transitionDelay = "";
      },
      { once: true }
    );
  };

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((el) => el.classList.add("is-visible"));
  } else {
    // Anything already scrolled past (e.g. reload mid-page) just appears.
    revealItems.forEach((el) => {
      if (el.getBoundingClientRect().bottom < 0) el.classList.add("is-visible");
    });

    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        // Items arriving together cascade in reading order.
        entering.forEach((el, i) => {
          show(el, isReduced() ? 0 : Math.min(i * 80, 400));
          observer.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    revealItems.forEach((el) => {
      if (!el.classList.contains("is-visible")) observer.observe(el);
    });
  }
})();
