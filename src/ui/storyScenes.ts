import type { StoryScene } from '../data/story';
import { el } from './dom';

/**
 * Painted backdrops for the story cards: three parallax layers of inline SVG silhouettes over a
 * gradient sky, with drifting ash. Pure DOM/CSS (no image assets); the layers only animate
 * `transform` / `opacity`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

interface LayerDef {
  readonly cls: string;
  /** SVG markup inside a 1600×600 viewBox anchored to the bottom. */
  readonly body: string;
}

const SCENES: Readonly<Record<StoryScene, readonly LayerDef[]>> = {
  skyfire: [
    {
      cls: 'far',
      body: `<circle cx="1080" cy="210" r="120" fill="url(#g-sun)"/>
        <path d="M0 470 L120 430 L210 450 L330 400 L420 440 L560 390 L700 430 L820 380 L960 420 L1100 370 L1240 420 L1380 380 L1500 410 L1600 390 L1600 600 L0 600Z" fill="#2a0d08"/>`,
    },
    {
      cls: 'mid',
      body: `<path d="M0 520 L60 520 L60 440 L90 440 L90 400 L120 440 L150 440 L150 480 L230 480 L230 380 L250 360 L270 380 L270 470 L360 470 L360 430 L400 410 L440 430 L440 500 L520 500 L520 360 L545 330 L570 360 L570 460 L640 460 L640 420 L700 420 L700 500 L800 500 L800 400 L830 370 L860 400 L860 480 L960 480 L960 440 L1010 400 L1060 440 L1060 500 L1150 500 L1150 350 L1175 320 L1200 350 L1200 470 L1290 470 L1290 430 L1340 430 L1340 500 L1440 500 L1440 410 L1470 390 L1500 410 L1500 490 L1600 490 L1600 600 L0 600Z" fill="#140605"/>
        <g fill="#ff8a3a" opacity="0.75"><rect x="245" y="400" width="6" height="10"/><rect x="540" y="380" width="6" height="12"/><rect x="822" y="420" width="6" height="10"/><rect x="1170" y="370" width="6" height="12"/><rect x="1018" y="450" width="8" height="8"/></g>`,
    },
    {
      cls: 'near',
      body: `<path d="M0 560 Q200 530 380 555 T760 548 T1180 556 T1600 540 L1600 600 L0 600Z" fill="#070303"/>
        <path d="M180 560 L196 470 L204 470 L212 560Z M1360 552 L1372 480 L1380 480 L1390 552Z" fill="#070303"/>`,
    },
  ],
  spire: [
    {
      cls: 'far',
      body: `<path d="M0 480 L180 420 L320 460 L480 400 L640 450 L800 410 L960 455 L1120 405 L1300 450 L1460 415 L1600 440 L1600 600 L0 600Z" fill="#1d0b10"/>`,
    },
    {
      cls: 'mid',
      body: `<path d="M740 560 L760 260 L770 260 L780 120 L792 60 L800 20 L808 60 L820 120 L830 260 L840 260 L860 560Z" fill="#0f0508"/>
        <path d="M700 560 L716 380 L740 380 L744 560Z M856 560 L860 380 L884 380 L900 560Z" fill="#0f0508"/>
        <g stroke="#3a1a14" stroke-width="3" fill="none"><path d="M800 120 Q600 200 380 470"/><path d="M800 120 Q1000 200 1220 470"/><path d="M800 180 Q640 260 520 500"/><path d="M800 180 Q960 260 1080 500"/></g>
        <circle cx="800" cy="92" r="10" fill="#ff3a1a"/><circle cx="800" cy="92" r="34" fill="url(#g-eye)"/>`,
    },
    {
      cls: 'near',
      body: `<path d="M0 560 L120 540 L260 562 L420 536 L600 558 L760 545 L940 560 L1120 538 L1300 556 L1460 540 L1600 552 L1600 600 L0 600Z" fill="#060203"/>`,
    },
  ],
  risen: [
    {
      cls: 'far',
      body: `<ellipse cx="800" cy="520" rx="700" ry="90" fill="url(#g-mist)"/>
        <path d="M0 470 L240 440 L420 465 L640 430 L900 462 L1120 436 L1380 460 L1600 444 L1600 600 L0 600Z" fill="#160a0c"/>`,
    },
    {
      cls: 'mid',
      body: `<g fill="#0c0506"><path d="M330 520 L330 470 L318 470 L318 458 L330 458 L330 440 L342 440 L342 458 L354 458 L354 470 L342 470 L342 520Z"/><path d="M1180 520 L1180 460 L1166 460 L1166 446 L1180 446 L1180 426 L1194 426 L1194 446 L1208 446 L1208 460 L1194 460 L1194 520Z"/><rect x="520" y="480" width="34" height="44" rx="14"/><rect x="1010" y="486" width="30" height="40" rx="12"/></g>
        <ellipse cx="800" cy="430" rx="240" ry="200" fill="url(#g-sun)" opacity="0.55"/>
        <path d="M800 540 L776 540 L770 470 L752 430 L760 400 L784 380 L786 352 Q800 336 814 352 L816 380 L840 400 L848 430 L830 470 L824 540Z" fill="#0a0405"/>
        <ellipse cx="800" cy="545" rx="140" ry="18" fill="#ff6a1a" opacity="0.55"/>
        <g fill="#ffb15e"><circle cx="760" cy="470" r="3"/><circle cx="846" cy="420" r="2.5"/><circle cx="812" cy="360" r="2"/><circle cx="780" cy="300" r="2.5"/></g>`,
    },
    {
      cls: 'near',
      body: `<path d="M0 566 Q260 540 520 560 T1040 556 T1600 548 L1600 600 L0 600Z" fill="#050203"/>`,
    },
  ],
  oath: [
    {
      cls: 'far',
      body: `<circle cx="1180" cy="190" r="90" fill="url(#g-sun)"/>
        <path d="M600 470 L760 440 L900 455 L1060 420 L1240 450 L1420 425 L1600 440 L1600 600 L600 600Z" fill="#2a0d08"/>
        <g fill="#ff7a2a" opacity="0.5"><circle cx="980" cy="452" r="5"/><circle cx="1200" cy="440" r="4"/><circle cx="1400" cy="436" r="5"/></g>`,
    },
    {
      cls: 'mid',
      body: `<path d="M0 420 L180 400 L340 410 L460 430 L560 470 L600 600 L0 600Z" fill="#0d0506"/>
        <path d="M292 404 L284 352 L276 330 L282 304 L296 292 L298 272 Q306 262 314 272 L316 292 L330 304 L334 330 L326 352 L318 404Z" fill="#050203"/>
        <path d="M328 300 L392 190 L398 194 L336 306Z" fill="#050203"/><path d="M392 190 L398 194" stroke="#ffb15e" stroke-width="3"/>`,
    },
    {
      cls: 'near',
      body: `<path d="M0 470 L120 460 L240 480 L360 470 L470 520 L520 600 L0 600Z" fill="#040102"/>`,
    },
  ],
};

const DEFS = `<defs>
  <radialGradient id="g-sun"><stop offset="0" stop-color="#ffd08a"/><stop offset="0.35" stop-color="#ff7a2a" stop-opacity="0.85"/><stop offset="1" stop-color="#ff3a0a" stop-opacity="0"/></radialGradient>
  <radialGradient id="g-eye"><stop offset="0" stop-color="#ff5a2a" stop-opacity="0.9"/><stop offset="1" stop-color="#ff2a0a" stop-opacity="0"/></radialGradient>
  <radialGradient id="g-mist"><stop offset="0" stop-color="#8a5a50" stop-opacity="0.35"/><stop offset="1" stop-color="#8a5a50" stop-opacity="0"/></radialGradient>
</defs>`;

function layerSvg(def: LayerDef): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `scene-layer scene-${def.cls}`);
  svg.setAttribute('viewBox', '0 0 1600 600');
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  svg.setAttribute('aria-hidden', 'true');
  // Constant, trusted markup authored above.
  svg.innerHTML = DEFS + def.body;
  return svg;
}

/** Builds a scene element (sky, three parallax layers, drifting ash). */
export function buildScene(scene: StoryScene): HTMLElement {
  const root = el('div', `scene scene-${scene}`);
  root.append(el('div', 'scene-sky'));
  for (const layer of SCENES[scene]) root.append(layerSvg(layer));
  root.append(el('div', 'scene-ash'), el('div', 'scene-ash scene-ash-2'), el('div', 'scene-shade'));
  return root;
}
