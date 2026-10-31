(function () {
  "use strict";

  var juuri = document.getElementById("tarina");
  if (!juuri) return;

  /* Animaatio on puhdas funktio ajasta: piirra(t) asettaa jokaisen elementin
     tilan suoraan ajanhetkestä t. Silmukka, hyppy vaiheeseen ja pysäytys
     ovat siksi pelkkää t:n asettamista. */
  var KESTO = 16.6;
  var VAIHEET = [
    { alku: 0, loppukuva: 3.6, nimi: "Kuitti", lause: "Penni lukee kuitin puolestasi." },
    { alku: 4, loppukuva: 8.2, nimi: "Tosite", lause: "Tosite syntyy valmiiksi. Sinä hyväksyt." },
    { alku: 8.6, loppukuva: 12.2, nimi: "Raportit", lause: "Raportit päivittyvät heti." },
    { alku: 12.4, loppukuva: 15.8, nimi: "Oma kone", lause: "Kaikki pysyy omalla koneellasi." }
  ];

  /* ---------- apurit ---------- */
  function rajaa(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function vali(t, a, b) { return rajaa((t - a) / (b - a)); }
  function ulos(x) { return 1 - Math.pow(1 - x, 3); }
  function sisaan(x) { return x * x * x; }
  function pehmea(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function pomppu(x) { var c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function lerp(a, b, x) { return a + (b - a) * x; }

  /* Rahat kokonaisina sentteinä, kuten moottorissa. */
  function raha(c) {
    var neg = c < 0;
    var s = String(Math.abs(Math.round(c))).padStart(3, "0");
    var kok = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "−" : "") + kok + "," + s.slice(-2);
  }

  /* ---------- kohtaus ---------- */
  var RIVIT = [
    { tili: "8650 Neuvottelukulut", debet: 2184 },
    { tili: "1763 ALV-saamiset", debet: 306, auto: true },
    { tili: "1910 Pankkitili", kredit: 2490 }
  ];
  var KUUKAUDET = ["Tam", "Hel", "Maa", "Huh", "Tou", "Kes", "Hei"];
  var KERTYMA = [312000, 441000, 518000, 596000, 643000, 748000, 921690];

  function hammas() {
    var d = "M0 8 Q0 0 8 0 H168 Q176 0 176 8 V228";
    for (var x = 176; x > 0; x -= 11) d += " L" + (x - 5.5) + " 236 L" + (x - 11) + " 228";
    return d + " Z";
  }
  function kuittiRivi(y, vasen, oikea, luokka) {
    return '<text x="14" y="' + y + '" class="mono ' + (luokka || "") + '">' + vasen + "</text>" +
      (oikea ? '<text x="162" y="' + y + '" text-anchor="end" class="mono ' + (luokka || "") + '">' + oikea + "</text>" : "");
  }
  function lappu(id, leveys, teksti, anchorOikea) {
    var x = anchorOikea ? -leveys : 0;
    return '<g id="' + id + '" opacity="0"><rect x="' + x + '" y="0" width="' + leveys +
      '" height="20" rx="10" class="t-lappu"/><text x="' + (x + leveys / 2) +
      '" y="13.8" text-anchor="middle" class="t-lappu-teksti">' + teksti + "</text></g>";
  }
  /* Pennin merkki 100 × 100 -ruudussa: oranssi kiekko, violetti P, avoin keskusta. */
  function merkki(idEtuliite) {
    return '<g mask="url(#' + idEtuliite + '-reika)"><circle cx="48.3" cy="47" r="37.5" fill="url(#' + idEtuliite + '-oranssi)"/>' +
      '<g filter="url(#' + idEtuliite + '-pvarjo)" fill="url(#' + idEtuliite + '-violetti)">' +
      '<circle cx="48.3" cy="45.2" r="29.7"/><path d="M18.7 45.2 V86 a9.5 9.5 0 0 0 19 0 V45.2 Z"/></g></g>';
  }
  function merkinMaaritteet(p) {
    return '<linearGradient id="' + p + '-oranssi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8941d"/><stop offset="1" stop-color="#e06a00"/></linearGradient>' +
      '<linearGradient id="' + p + '-violetti" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6248f4"/><stop offset="1" stop-color="#4b3bd6"/></linearGradient>' +
      '<mask id="' + p + '-reika" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><circle cx="48.3" cy="45.2" r="11" fill="#000"/></mask>' +
      '<filter id="' + p + '-pvarjo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="0.6" dy="1.6" stdDeviation="1.4" flood-color="#231c36" flood-opacity=".28"/></filter>';
  }

  var palkit = "";
  KERTYMA.forEach(function (_, i) {
    var x = 36 + i * 50;
    palkit += '<rect id="t-palkki' + i + '" x="' + x + '" y="240" width="28" height="0" rx="5" class="' +
      (i === 6 ? "t-palkki-uusi" : "t-palkki") + '"/>' +
      '<text x="' + (x + 14) + '" y="260" text-anchor="middle" class="t-pieni">' + KUUKAUDET[i] + "</text>";
  });

  var rivit = RIVIT.map(function (r, i) {
    var y = 118 + i * 28;
    return '<g id="t-rivi' + i + '" opacity="0">' +
      '<text x="20" y="' + y + '" class="t-rivi">' + r.tili + "</text>" +
      (r.auto ? '<rect x="133" y="' + (y - 11) + '" width="34" height="15" rx="7.5" class="t-auto"/>' +
        '<text x="150" y="' + (y - 0.5) + '" text-anchor="middle" class="t-auto-teksti">auto</text>' : "") +
      '<text x="232" y="' + y + '" text-anchor="end" class="t-rivi luku">' + (r.debet ? raha(r.debet) : "") + "</text>" +
      '<text x="300" y="' + y + '" text-anchor="end" class="t-rivi luku">' + (r.kredit ? raha(r.kredit) : "") + "</text></g>";
  }).join("");

  var svg =
    '<svg class="tarina-kuva" viewBox="0 0 480 400" role="img" aria-label="Animaatio: Penni lukee kuitin, tekee siitä tositteen, jonka sinä hyväksyt, päivittää raportit ja tallentaa kaiken omalle koneellesi.">' +
    "<defs>" +
      '<pattern id="t-pisteet" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#e6e6ee"/></pattern>' +
      '<filter id="t-varjo" x="-25%" y="-20%" width="150%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#282135" flood-opacity=".10"/></filter>' +
      '<linearGradient id="t-sade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f46e5" stop-opacity="0"/><stop offset="1" stop-color="#4f46e5" stop-opacity=".22"/></linearGradient>' +
      '<clipPath id="t-kuittirajaus"><rect x="0" y="0" width="176" height="236"/></clipPath>' +
      merkinMaaritteet("t") +
    "</defs>" +
    '<rect width="480" height="400" fill="url(#t-pisteet)"/>' +
    '<g id="t-kaikki">' +

    /* 1 · kuitti */
    '<g id="t-kuitti" opacity="0">' +
      '<path d="' + hammas() + '" class="t-paperi" filter="url(#t-varjo)"/>' +
      '<rect id="t-k-h0" x="8" y="21" width="0" height="16" rx="4" class="t-korostus"/>' +
      '<rect id="t-k-h1" x="8" y="127" width="0" height="16" rx="4" class="t-korostus"/>' +
      '<rect id="t-k-h2" x="8" y="153" width="0" height="16" rx="4" class="t-korostus"/>' +
      kuittiRivi(33, "RAVINTOLA PIENI PENNI", "", "vahva") +
      kuittiRivi(50, "Fredrikinkatu 24", "", "himmea") +
      kuittiRivi(64, "Y-tunnus 2841234-5", "", "himmea") +
      kuittiRivi(90, "Lounas", "12,45") +
      kuittiRivi(106, "Lounas", "12,45") +
      '<line x1="14" y1="117" x2="162" y2="117" class="t-katko"/>' +
      kuittiRivi(139, "YHTEENSÄ", "24,90", "vahva") +
      kuittiRivi(165, "ALV 14 %", "3,06") +
      kuittiRivi(192, "23.07.2026  12:41", "", "himmea") +
      kuittiRivi(207, "KORTTI **** 4417", "", "himmea") +
      '<g clip-path="url(#t-kuittirajaus)"><g id="t-sade" opacity="0">' +
        '<rect x="0" y="-28" width="176" height="28" fill="url(#t-sade)"/>' +
        '<rect x="0" y="-1.5" width="176" height="1.5" fill="#4f46e5"/></g></g>' +
    "</g>" +
    lappu("t-lappu0", 54, "Myyjä", true) +
    lappu("t-lappu1", 58, "Summa") +
    lappu("t-lappu2", 66, "ALV 14 %") +

    /* 2 · tosite */
    '<g id="t-tosite" opacity="0">' +
      '<rect width="320" height="306" rx="16" class="t-kortti" filter="url(#t-varjo)"/>' +
      '<text x="20" y="36" class="t-otsikko">Tosite kuitista</text>' +
      '<g id="t-luonnos"><rect x="238" y="22" width="62" height="20" rx="10" class="t-harmaa"/><text x="269" y="35.8" text-anchor="middle" class="t-pieni">Luonnos</text></g>' +
      '<g id="t-numero" opacity="0"><rect x="232" y="22" width="68" height="20" rx="10" class="t-vaalea"/><text x="266" y="35.8" text-anchor="middle" class="t-pieni violetti">Nro 187</text></g>' +
      '<text x="20" y="56" class="t-pieni">23.07.2026 · Lounas asiakastapaamisessa</text>' +
      '<text x="20" y="88" class="t-sarake">TILI</text>' +
      '<text x="232" y="88" text-anchor="end" class="t-sarake">DEBET</text>' +
      '<text x="300" y="88" text-anchor="end" class="t-sarake">KREDIT</text>' +
      '<line x1="20" y1="96" x2="300" y2="96" class="t-viiva"/>' +
      rivit +
      '<line x1="20" y1="190" x2="300" y2="190" class="t-viiva"/>' +
      '<rect x="20" y="204" width="280" height="34" rx="10" class="t-harmaa"/>' +
      '<rect id="t-tase-ok" x="20" y="204" width="280" height="34" rx="10" class="t-vaalea" opacity="0"/>' +
      '<text id="t-tase-teksti" x="34" y="225.5" class="t-rivi">○  Debet ≠ kredit</text>' +
      '<text id="t-tase-luvut" x="286" y="225.5" text-anchor="end" class="t-rivi luku">0,00 / 0,00</text>' +
      '<text x="20" y="273.5" class="t-pieni">Sinä päätät, mitä kirjataan.</text>' +
      '<g id="t-nappi">' +
        '<rect id="t-nappi-tausta" x="190" y="252" width="110" height="34" rx="10" class="t-ensisijainen"/>' +
        '<text id="t-nappi-teksti" x="245" y="273.5" text-anchor="middle" class="t-nappi-teksti">Hyväksy</text>' +
        '<g id="t-nappi-ok" opacity="0"><rect x="190" y="252" width="110" height="34" rx="10" class="t-vaalea"/>' +
        '<text x="245" y="273.5" text-anchor="middle" class="t-nappi-teksti violetti">✓ Tallennettu</text></g>' +
      "</g>" +
    "</g>" +
    '<path id="t-osoitin" opacity="0" d="M0 0 L0 17 L4.6 13.2 L7.6 20 L10.6 18.7 L7.7 12 L13.6 12 Z" class="t-osoitin"/>' +

    /* 3 · raportit */
    '<g id="t-raportti" opacity="0">' +
      '<rect width="400" height="282" rx="16" class="t-kortti" filter="url(#t-varjo)"/>' +
      '<text x="24" y="36" class="t-otsikko">Tuloslaskelma</text>' +
      '<text x="376" y="36" text-anchor="end" class="t-pieni">1.1.–23.7.2026</text>' +
      '<text x="24" y="70" class="t-pieni">Tilikauden tulos</text>' +
      '<text id="t-tulos" x="24" y="98" class="t-iso">9 216,90 €</text>' +
      '<text x="230" y="70" class="t-pieni">Vähennettävä ALV</text>' +
      '<text id="t-alv" x="230" y="98" class="t-iso">412,40 €</text>' +
      '<line x1="24" y1="116" x2="376" y2="116" class="t-viiva"/>' +
      palkit +
      '<rect id="t-valahdus" x="336" y="0" width="28" height="0" rx="5" fill="#fff" opacity="0"/>' +
      '<g id="t-pudotus" opacity="0"><rect x="-42" y="0" width="84" height="22" rx="11" class="t-oranssi"/>' +
        '<text x="0" y="15" text-anchor="middle" class="t-oranssi-teksti">−21,84 €</text></g>' +
    "</g>" +

    /* 4 · oma kone */
    '<g id="t-kone">' +
      '<path id="t-naytto-tausta" d="M132 92 H348 Q360 92 360 104 V236 Q360 248 348 248 H132 Q120 248 120 236 V104 Q120 92 132 92 Z" fill="#f6f6fb" opacity="0"/>' +
      '<path id="t-naytto" pathLength="1" stroke-dashoffset="1" d="M132 92 H348 Q360 92 360 104 V236 Q360 248 348 248 H132 Q120 248 120 236 V104 Q120 92 132 92 Z" class="t-piirros"/>' +
      '<path id="t-jalka" pathLength="1" stroke-dashoffset="1" d="M100 262 H380 L398 279 Q402 284 395 284 H85 Q78 284 82 279 Z" class="t-piirros"/>' +
      '<g id="t-merkki" opacity="0">' + merkki("t") + "</g>" +
      '<g id="t-tiedosto" opacity="0">' +
        '<rect x="-128" y="0" width="256" height="32" rx="16" class="t-kortti"/>' +
        '<path d="M-110 8 h9 l5 5 v12 h-14 Z" class="t-tiedosto-ikoni"/>' +
        '<text x="-88" y="20.5" class="mono t-tiedostonimi">kirjanpito.penni</text>' +
        '<text x="112" y="20.5" text-anchor="end" class="t-pieni violetti">✓ tällä koneella</text>' +
      "</g>" +
    "</g>" +
    "</g></svg>";

  var vaiheNapit = VAIHEET.map(function (v, i) {
    return '<li><button type="button" data-vaihe="' + i + '"><b>' + (i + 1) + "</b> " + v.nimi +
      '<i class="viiva"><i></i></i></button></li>';
  }).join("");

  juuri.innerHTML = svg +
    '<figcaption><p class="tarina-lause" aria-hidden="true"></p>' +
    '<div class="tarina-ohjaus"><ol class="tarina-vaiheet" aria-label="Animaation vaiheet">' + vaiheNapit + "</ol>" +
    '<button type="button" class="tarina-tauko" aria-pressed="false" aria-label="Pysäytä animaatio">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="tauko" d="M5 3.5v9M11 3.5v9"/><path class="toista" d="M5.5 3.2 12.5 8l-7 4.8Z"/></svg>' +
    "</button></div></figcaption>";

  function $(id) { return document.getElementById(id); }
  var el = {};
  ["kaikki", "kuitti", "sade", "k-h0", "k-h1", "k-h2", "lappu0", "lappu1", "lappu2", "tosite", "luonnos",
    "numero", "tase-ok", "tase-teksti", "tase-luvut", "nappi", "nappi-ok", "nappi-teksti", "nappi-tausta",
    "osoitin", "raportti", "tulos", "alv", "valahdus", "pudotus", "naytto", "naytto-tausta", "jalka",
    "merkki", "tiedosto", "rivi0", "rivi1", "rivi2"].forEach(function (n) { el[n] = $("t-" + n); });
  var palkkiEl = KERTYMA.map(function (_, i) { return $("t-palkki" + i); });
  var lauseEl = juuri.querySelector(".tarina-lause");
  var napit = juuri.querySelectorAll("[data-vaihe]");
  var taukoNappi = juuri.querySelector(".tarina-tauko");

  /* Kirjoitetaan DOMiin vain muuttuneet arvot. */
  var muisti = new WeakMap();
  function attr(e, nimi, arvo) {
    var m = muisti.get(e);
    if (!m) { m = {}; muisti.set(e, m); }
    if (m[nimi] === arvo) return;
    m[nimi] = arvo;
    e.setAttribute(nimi, arvo);
  }
  function teksti(e, arvo) {
    if (e.textContent !== arvo) e.textContent = arvo;
  }
  function sijoita(e, o, x, y, s, kierto, kx, ky) {
    attr(e, "opacity", o.toFixed(3));
    var tr = "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ")";
    if (kierto) tr += " rotate(" + kierto.toFixed(2) + " " + (kx || 0) + " " + (ky || 0) + ")";
    if (s !== 1) tr += " scale(" + s.toFixed(4) + ")";
    attr(e, "transform", tr);
  }

  /* ---------- aikajana ---------- */
  function piirra(t) {
    attr(el.kaikki, "opacity", (1 - vali(t, 16.1, 16.6)).toFixed(3));

    /* 1 · kuitti saapuu, säde lukee, kentät korostuvat */
    var tulo = ulos(vali(t, 0, 0.9));
    var pienennys = pehmea(vali(t, 4.0, 4.8));
    var kuittiPois = vali(t, 8.6, 9.1);
    sijoita(el.kuitti, tulo * (1 - kuittiPois),
      lerp(152, 24, pienennys), lerp(82, 50, pienennys) + (1 - tulo) * 60 - ulos(kuittiPois) * 20,
      lerp(1, 0.56, pienennys), lerp(5, -1.5, tulo) * (1 - pienennys), 88, 118);

    var sade = vali(t, 1.0, 2.4);
    attr(el.sade, "opacity", (vali(t, 0.9, 1.05) * (1 - vali(t, 2.35, 2.6))).toFixed(3));
    attr(el.sade, "transform", "translate(0 " + (sade * 250).toFixed(2) + ")");

    [[29, 146], [135, 160], [161, 160]].forEach(function (k, i) {
      var hetki = 1.0 + 1.4 * ((k[0] + 8) / 250); // säde ohittaa rivin alareunan
      var p = ulos(vali(t, hetki, hetki + 0.35));
      attr(el["k-h" + i], "width", (k[1] * p).toFixed(2));
      var lappuPois = vali(t, 3.6, 3.95);
      var lx = i === 0 ? 142 : 334, ly = [101, 207, 233][i];
      sijoita(el["lappu" + i], p * (1 - lappuPois), lx + (i === 0 ? 1 : -1) * (1 - p) * 8, ly, 1);
    });

    /* 2 · tosite: viennit, täsmäys, hyväksyntä */
    var korttiTulo = ulos(vali(t, 4.3, 5.0));
    var korttiPois = vali(t, 8.6, 9.1);
    sijoita(el.tosite, korttiTulo * (1 - korttiPois), 136, 50 + (1 - korttiTulo) * 16 - ulos(korttiPois) * 20, 1);

    var debet = 0, kredit = 0;
    RIVIT.forEach(function (r, i) {
      var p = ulos(vali(t, 5.0 + i * 0.4, 5.45 + i * 0.4));
      sijoita(el["rivi" + i], p, (1 - p) * -12, 0, 1);
      if (p > 0.5) { debet += r.debet || 0; kredit += r.kredit || 0; }
    });
    var tasmaa = debet > 0 && debet === kredit;
    attr(el["tase-ok"], "opacity", (tasmaa ? vali(t, 6.0, 6.35) : 0).toFixed(3));
    teksti(el["tase-teksti"], tasmaa ? "✓  Debet = kredit" : "○  Debet ≠ kredit");
    attr(el["tase-teksti"], "class", tasmaa ? "t-rivi violetti" : "t-rivi");
    teksti(el["tase-luvut"], raha(debet) + " / " + raha(kredit));

    var osoitinLiike = pehmea(vali(t, 6.3, 6.95));
    var painallus = vali(t, 6.95, 7.2);
    var kuoppa = Math.sin(Math.PI * painallus);
    sijoita(el.osoitin, vali(t, 6.3, 6.5) * (1 - vali(t, 7.5, 7.8)) * (1 - korttiPois),
      lerp(440, 378, osoitinLiike), lerp(392, 322, osoitinLiike), 1 - 0.15 * kuoppa);
    attr(el.nappi, "transform", "translate(245 269) scale(" + (1 - 0.05 * kuoppa).toFixed(4) + ") translate(-245 -269)");
    var tallennettu = vali(t, 7.08, 7.35);
    attr(el["nappi-ok"], "opacity", tallennettu.toFixed(3));
    attr(el.numero, "opacity", tallennettu.toFixed(3));
    attr(el.luonnos, "opacity", (1 - tallennettu).toFixed(3));

    /* 3 · raportit: palkit kasvavat, uusi kirjaus putoaa, luvut päivittyvät */
    var raporttiTulo = ulos(vali(t, 9.0, 9.6));
    var raporttiPois = vali(t, 12.4, 12.9);
    sijoita(el.raportti, raporttiTulo * (1 - raporttiPois), 40, 60 + (1 - raporttiTulo) * 16 - ulos(raporttiPois) * 20, 1);
    var huippu = 950000;
    KERTYMA.forEach(function (arvo, i) {
      var p = ulos(vali(t, 9.3 + i * 0.08, 9.8 + i * 0.08));
      var h = (arvo / huippu) * 110 * p;
      attr(palkkiEl[i], "height", h.toFixed(2));
      attr(palkkiEl[i], "y", (240 - h).toFixed(2));
    });
    var viimeinenYla = 240 - (KERTYMA[6] / huippu) * 110;
    var putoaa = sisaan(vali(t, 10.4, 10.95));
    var liukenee = vali(t, 10.95, 11.2);
    sijoita(el.pudotus, vali(t, 10.4, 10.55) * (1 - liukenee), 350, lerp(120, viimeinenYla - 18, putoaa), 1 - 0.3 * liukenee);
    var valahdus = Math.sin(Math.PI * vali(t, 10.95, 11.5));
    attr(el.valahdus, "y", viimeinenYla.toFixed(2));
    attr(el.valahdus, "height", ((KERTYMA[6] / huippu) * 110).toFixed(2));
    attr(el.valahdus, "opacity", (0.45 * valahdus).toFixed(3));
    var laskuri = pehmea(vali(t, 11.0, 11.7));
    teksti(el.tulos, raha(lerp(921690, 919506, laskuri)) + " €");
    teksti(el.alv, raha(lerp(41240, 41546, laskuri)) + " €");

    /* 4 · oma kone: kone piirtyy, merkki ja tiedosto asettuvat */
    attr(el.naytto, "stroke-dashoffset", (1 - pehmea(vali(t, 12.8, 13.7))).toFixed(4));
    attr(el.jalka, "stroke-dashoffset", (1 - pehmea(vali(t, 13.1, 13.8))).toFixed(4));
    var koneNakyy = vali(t, 12.75, 12.8);
    attr(el.naytto, "opacity", koneNakyy.toFixed(3));
    attr(el.jalka, "opacity", vali(t, 13.05, 13.1).toFixed(3));
    attr(el["naytto-tausta"], "opacity", vali(t, 13.5, 13.9).toFixed(3));
    var merkkiP = vali(t, 13.7, 14.3);
    var s = 1.12 * lerp(0.6, 1, pomppu(merkkiP));
    sijoita(el.merkki, ulos(vali(t, 13.7, 13.95)), 240 - 48.3 * s, 170 - 52.5 * s, s);
    var tiedosto = ulos(vali(t, 14.3, 14.85));
    sijoita(el.tiedosto, tiedosto, 240, 306 + (1 - tiedosto) * 12, 1);
  }

  /* ---------- toisto ja ohjaus ---------- */
  var vahennetty = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var t = vahennetty ? VAIHEET[1].loppukuva : 0;
  var kayssa = !vahennetty;
  var nakyvissa = true;
  var edellinen = null;
  var aktiivinen = -1;

  function vaiheAjassa(aika) {
    for (var i = VAIHEET.length - 1; i >= 0; i--) if (aika >= VAIHEET[i].alku) return i;
    return 0;
  }
  function paivitaKuvateksti() {
    var v = vaiheAjassa(t);
    if (v !== aktiivinen) {
      aktiivinen = v;
      lauseEl.textContent = VAIHEET[v].lause;
      Array.prototype.forEach.call(napit, function (b, i) {
        if (i === v) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
    }
    Array.prototype.forEach.call(napit, function (b, i) {
      var loppu = i + 1 < VAIHEET.length ? VAIHEET[i + 1].alku : KESTO;
      var p = i < v ? 1 : i > v ? 0 : rajaa((t - VAIHEET[i].alku) / (loppu - VAIHEET[i].alku));
      b.querySelector(".viiva i").style.transform = "scaleX(" + p.toFixed(3) + ")";
    });
  }
  function ruutu(nyt) {
    if (edellinen !== null) {
      t += Math.min(0.1, (nyt - edellinen) / 1000);
      if (t >= KESTO) t -= KESTO;
    }
    edellinen = nyt;
    piirra(t);
    paivitaKuvateksti();
    if (kayssa && nakyvissa) window.requestAnimationFrame(ruutu);
    else edellinen = null;
  }
  function kaynnista() {
    if (kayssa && nakyvissa && edellinen === null) window.requestAnimationFrame(ruutu);
  }
  function asetaTauko(tauolla) {
    kayssa = !tauolla;
    taukoNappi.setAttribute("aria-pressed", String(tauolla));
    taukoNappi.setAttribute("aria-label", tauolla ? "Jatka animaatiota" : "Pysäytä animaatio");
    juuri.classList.toggle("tauolla", tauolla);
    kaynnista();
  }

  Array.prototype.forEach.call(napit, function (b) {
    b.addEventListener("click", function () {
      var v = VAIHEET[Number(b.dataset.vaihe)];
      t = kayssa ? v.alku : v.loppukuva;
      piirra(t);
      paivitaKuvateksti();
    });
  });
  taukoNappi.addEventListener("click", function () { asetaTauko(kayssa); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (havainnot) {
      nakyvissa = havainnot[0].isIntersecting;
      kaynnista();
    }, { threshold: 0.15 }).observe(juuri);
  }
  document.addEventListener("visibilitychange", function () {
    nakyvissa = !document.hidden;
    kaynnista();
  });

  piirra(t);
  paivitaKuvateksti();
  asetaTauko(!kayssa);
})();
