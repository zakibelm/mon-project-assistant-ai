"use client";
import { RefObject, useLayoutEffect, useRef } from "react";

/**
 * Mouvement du poste (« FLIP » mesuré, Web Animations API, transform et opacité seulement) :
 * - une carte réglée se replie en « ✓ Réglé » (scaleY contre-compensé sur son contenu), son contenu
 *   réapparaît de 4 px, la coche tourne en se posant et un bref surlignage ambre marque le changement ;
 * - les autres cartes glissent à leur nouvelle place (0,4 s, power3.inOut, décalage de 15 ms) ;
 * - le chiffre du compteur roule vers sa nouvelle valeur, sans rebond.
 * Les positions sont mesurées après chaque rendu, quelle qu'en soit la cause (geste local ou point du jour
 * rechargé par le parent). Sous prefers-reduced-motion, rien ne bouge : l'état final s'affiche directement.
 */
type Box = { top: number; left: number; h: number; resolved: boolean };

const DUREE = 400;
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // power3.inOut
const EASE_INOUT = "cubic-bezier(.65,0,.35,1)";
const EASE_OUT = "cubic-bezier(.22,1,.36,1)"; // power3.out
const EASE_BACK = "cubic-bezier(.34,1.8,.64,1)"; // back.out : seule courbe à dépassement, réservée à la coche

/** Position dans le document, sans les transformations en cours (offsetTop ignore transform). */
function place(el: HTMLElement) {
  let top = 0, left = 0, n: HTMLElement | null = el;
  while (n) { top += n.offsetTop; left += n.offsetLeft; n = n.offsetParent as HTMLElement | null; }
  return { top, left };
}

function replier(card: HTMLElement, dx: number, dy: number, k: number, regle: boolean) {
  const body = card.querySelector<HTMLElement>(".body");
  // Échantillonne la courbe pour contre-compenser exactement l'échelle sur le contenu.
  const N = 12, carte: Keyframe[] = [], contenu: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const e = inOut(i / N), s = k + (1 - k) * e;
    carte.push({ transform: `translate(${dx * (1 - e)}px, ${dy * (1 - e)}px) scaleY(${s})` });
    contenu.push({ transform: `scaleY(${1 / s})` });
  }
  card.animate(carte, { duration: DUREE, easing: "linear" });
  body?.animate(contenu, { duration: DUREE, easing: "linear" });
  if (!regle || !body) return;
  for (const child of Array.from(body.children) as HTMLElement[]) {
    child.animate([{ opacity: 0, translate: "0 4px" }, { opacity: 1, translate: "0 0" }], { duration: 240, delay: 40, easing: EASE_OUT, fill: "backwards" });
  }
  card.querySelector(".ok-mark")?.animate([{ transform: "rotate(-90deg) scale(.4)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 80, easing: EASE_BACK, fill: "backwards" });
  card.classList.add("vient-de-changer");
  window.setTimeout(() => card.classList.remove("vient-de-changer"), 1600);
}

export function useDeskMotion(root: RefObject<HTMLElement | null>, tally: number | null) {
  const prev = useRef<Map<string, Box>>(new Map());
  const prevTally = useRef<number | null>(tally);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-flip-id]"));
    const next = new Map<string, Box>();
    for (const c of cards) next.set(c.dataset.flipId!, { ...place(c), h: c.offsetHeight, resolved: c.classList.contains("resolved") });
    const before = prev.current;
    prev.current = next;
    const avant = prevTally.current;
    prevTally.current = tally;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || before.size === 0) return;

    let rang = 0;
    for (const c of cards) {
      const a = before.get(c.dataset.flipId!), b = next.get(c.dataset.flipId!)!;
      if (!a) continue;
      const dx = a.left - b.left, dy = a.top - b.top;
      const regle = !a.resolved && b.resolved;
      const plie = regle || a.resolved !== b.resolved || Math.abs(a.h - b.h) > 2;
      if (!plie && Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      c.getAnimations({ subtree: true }).forEach((x) => x.cancel());
      if (plie && b.h > 0) replier(c, dx, dy, a.h / b.h, regle || (a.resolved && !b.resolved));
      else c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: DUREE, delay: 15 * rang++, easing: EASE_INOUT, fill: "backwards" });
    }

    if (tally !== null && avant !== null && tally !== avant) {
      const pill = el.querySelector<HTMLElement>(".tally"), n = pill?.querySelector<HTMLElement>(".tally-n");
      n?.animate([{ transform: `translateY(${tally < avant ? -110 : 110}%)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 450, delay: 100, easing: EASE_OUT, fill: "backwards" });
      pill?.animate([{ transform: "scale(1.08)" }, { transform: "none" }], { duration: 400, delay: 100, easing: EASE_OUT, fill: "backwards" });
    }
  });
}
