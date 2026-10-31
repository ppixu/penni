
(function () {
  "use strict";

  var juuri = document.getElementById("demo");
  if (!juuri) return;

  /* Rahat kokonaisina sentteinä — sama invariantti kuin moottorissa.
     Tilinumerot Kitsaan yritystilikartasta (kitsas/tilikartat/yritys). */
  var TILIT = [
    { nro: "1701", nimi: "Myyntisaamiset",             laji: "vastaavaa" },
    { nro: "1763", nimi: "Arvonlisäverosaamiset",      laji: "vastaavaa" },
    { nro: "1910", nimi: "Pankkitili",                 laji: "vastaavaa" },
    { nro: "2871", nimi: "Ostovelat",                  laji: "vastattavaa" },
    { nro: "2939", nimi: "Arvonlisäverovelka",         laji: "vastattavaa" },
    { nro: "3000", nimi: "Myynti",                     laji: "tuotto",  kanta: 2550 },
    { nro: "7230", nimi: "Toimitilavuokrat",           laji: "kulu",    kanta: 0 },
    { nro: "7530", nimi: "Ajoneuvojen polttoaine",     laji: "kulu",    kanta: 2550 },
    { nro: "7660", nimi: "Atk-ohjelmistot, päivitykset ja ylläpito", laji: "kulu", kanta: 2550 },
    { nro: "7690", nimi: "Atk-laitteiden pienhankinnat", laji: "kulu",  kanta: 2550 },
    { nro: "7800", nimi: "Matkaliput",                 laji: "kulu",    kanta: 1400 },
    { nro: "8090", nimi: "Internetmainonta",           laji: "kulu",    kanta: 2550 },
    { nro: "8380", nimi: "Taloushallintopalvelut",     laji: "kulu",    kanta: 2550 },
    { nro: "8500", nimi: "Puhelinkulut",               laji: "kulu",    kanta: 2550 },
    { nro: "8620", nimi: "Toimistotarvikkeet",         laji: "kulu",    kanta: 2550 },
    { nro: "8650", nimi: "Kokous- ja neuvottelukulut", laji: "kulu",    kanta: 2550 }
  ];
  var ALV_OSTO = "1763";
  var ALV_MYYNTI = "2939";
  var PANKKI = "1910";
  var SAAMISET = "1701";

  function tili(nro) {
    for (var i = 0; i < TILIT.length; i++) if (TILIT[i].nro === nro) return TILIT[i];
    return { nro: nro, nimi: nro, laji: "kulu", kanta: 0 };
  }
  function menotilit() {
    return TILIT.filter(function (t) { return t.laji === "kulu"; });
  }

  /* Demokirjan tositteet lähdemuodossa; viennit lasketaan näistä,
     joten debet = kredit aina rakenteen puolesta. */
  var LAHTO = [
    { pvm: "07.01.2026", laji: "meno",     tili: "7230", brutto: 156000, selite: "Toimitilavuokra, tammi–maaliskuu" },
    { pvm: "09.01.2026", laji: "meno",     tili: "7660", brutto: 12550,  selite: "Ohjelmistotilaukset, tammikuu" },
    { pvm: "15.01.2026", laji: "myynti",   brutto: 496000, selite: "Myyntilasku 2026-001 · Metsäpolku Oy" },
    { pvm: "03.02.2026", laji: "meno",     tili: "8500", brutto: 3990,   selite: "Puhelinlasku, helmikuu" },
    { pvm: "12.02.2026", laji: "suoritus", brutto: 496000, selite: "Suoritus: myyntilasku 2026-001" },
    { pvm: "28.02.2026", laji: "myynti",   brutto: 620000, selite: "Myyntilasku 2026-002 · Aalto Digital Oy" },
    { pvm: "11.03.2026", laji: "meno",     tili: "8380", brutto: 24800,  selite: "Tilitoimiston palkkio, Q1" },
    { pvm: "16.03.2026", laji: "suoritus", brutto: 620000, selite: "Suoritus: myyntilasku 2026-002" },
    { pvm: "24.03.2026", laji: "meno",     tili: "7800", brutto: 7800,   selite: "Junaliput Helsinki–Tampere" },
    { pvm: "16.04.2026", laji: "meno",     tili: "8090", brutto: 31000,  selite: "Google Ads, huhtikuu" },
    { pvm: "02.06.2026", laji: "meno",     tili: "7530", brutto: 9680,   selite: "Polttoaine, asiakaskäynnit", kuitti: true },
    { pvm: "18.06.2026", laji: "meno",     tili: "8620", brutto: 8640,   selite: "Toimistotarvikkeet, Toimisto Oy", kuitti: true },
    { pvm: "30.06.2026", laji: "myynti",   brutto: 1240000, selite: "Myyntilasku 2026-003 · Kaupunki Studio Oy" },
    { pvm: "01.07.2026", laji: "meno",     tili: "7660", brutto: 6320,   selite: "Ohjelmistotilaukset, heinäkuu" }
  ];

  var LASKUT = [
    { nro: "2026-001", asiakas: "Metsäpolku Oy",      pvm: "15.01.2026", era: "29.01.2026", summa: 496000,  tila: "Maksettu" },
    { nro: "2026-002", asiakas: "Aalto Digital Oy",   pvm: "28.02.2026", era: "14.03.2026", summa: 620000,  tila: "Maksettu" },
    { nro: "2026-003", asiakas: "Kaupunki Studio Oy", pvm: "30.06.2026", era: "14.07.2026", summa: 1240000, tila: "Erääntynyt" },
    { nro: "2026-004", asiakas: "Metsäpolku Oy",      pvm: "24.07.2026", era: "07.08.2026", summa: 372000,  tila: "Luonnos" }
  ];

  /* Luettavat kuitit. "poiminta" on se, minkä konenäkö lukee paperilta. */
  var KUITIT = [
    {
      id: "k1", myyja: "Ravintola Pieni Penni", pvm: "23.07.2026",
      brutto: 2490, kanta: 1400, tili: "8650", varmuus: 96,
      historia: "12 aiempaa kirjausta samalta myyjältä",
      selite: "Lounas asiakastapaamisessa",
      paperi: [
        "Fredrikinkatu 24",
        "Y-tunnus 2841234-5",
        "",
        "Lounas          12,45",
        "Lounas          12,45",
        "---------------------",
        "YHTEENSÄ        24,90",
        "ALV 14 %         3,06",
        "",
        "23.07.2026  12:41",
        "KORTTI **** 4417"
      ]
    },
    {
      id: "k2", myyja: "Verkkokauppa.com", pvm: "22.07.2026",
      brutto: 18900, kanta: 2550, tili: "7690", varmuus: 71, uusi: true,
      selite: "Näppäimistö ja kaapeli",
      paperi: [
        "Tilaus 41-2298871",
        "",
        "Näppäimistö    129,00",
        "USB-C-kaapeli   19,90",
        "Toimitus        40,10",
        "---------------------",
        "YHTEENSÄ       189,00",
        "ALV 25,5 %      38,40",
        "",
        "22.07.2026"
      ]
    },
    {
      id: "k3", myyja: "Neste K Pitäjänmäki", pvm: "21.07.2026",
      brutto: 7245, kanta: 2550, tili: "7530", varmuus: 98,
      historia: "7 aiempaa kirjausta samalta myyjältä",
      selite: "Polttoaine, asiakaskäynnit",
      paperi: [
        "Takkatie 12",
        "",
        "95E10      38,50 l",
        "         1,882 EUR/l",
        "---------------------",
        "YHTEENSÄ        72,45",
        "ALV 25,5 %      14,72",
        "",
        "21.07.2026  07:58",
        "KORTTI **** 4417"
      ]
    }
  ];

  /* ---------- rahan esitys ---------- */
  function sentit(teksti) {
    var siisti = String(teksti).replace(/\s|€/g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(siisti)) return null;
    return Math.round(parseFloat(siisti) * 100);
  }
  function raha(c) {
    var neg = c < 0;
    var s = String(Math.abs(c)).padStart(3, "0");
    var kok = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "−" : "") + kok + "," + s.slice(-2);
  }
  function kantaTeksti(bp) { return raha(bp).replace(/,00$/, "").replace(/,(\d)0$/, ",$1") + " %"; }
  function nettoOsa(brutto, kanta) { return Math.round((brutto * 10000) / (10000 + kanta)); }
  function pakoon(s) {
    return String(s).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }

  /* ---------- kuvakkeet ---------- */
  /* Samat lucide-kuvakkeet kuin sovelluksen sivupalkissa ja tositelistassa. */
  var IKONIT = {
    kojelauta: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    uusi: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/>',
    tositteet: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    kumppanit: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    raportit: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    alv: '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    tilikartta: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
    tilinpaatos: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m9 9.5 2 2 4-4"/>',
    asetukset: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    meno: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    myynti: '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 7V4a2 2 0 0 1 2-2 2 2 0 0 0-2 2"/><path d="M4.063 20.999a2 2 0 0 0 2 1L18 22a2 2 0 0 0 2-2V7l-5-5H6"/><path d="m5 11-3 3"/><path d="m5 17-3-3h10"/>',
    siirto: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    kuitti: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    liite: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    nuoli: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'
  };
  function ikoni(nimi) {
    return '<svg class="demo-ikoni" viewBox="0 0 24 24" aria-hidden="true">' + IKONIT[nimi] + "</svg>";
  }
  var TYYPPI_IKONI = {
    Meno: { ikoni: "meno", savy: "meno" },
    Myyntilasku: { ikoni: "myynti", savy: "tulo" },
    Suoritus: { ikoni: "siirto", savy: "neutraali" }
  };
  function tyyppiMerkki(tyyppi) {
    var t = TYYPPI_IKONI[tyyppi] || TYYPPI_IKONI.Suoritus;
    return '<span class="demo-tyyppi ' + t.savy + '">' + ikoni(t.ikoni) + "</span>";
  }

  /* ---------- kirja ---------- */
  var TOSITTEET = [];
  var seuraavaNumero = 187;

  function teeTosite(l, numero) {
    var rivit, tyyppi, netto;
    if (l.laji === "myynti") {
      netto = nettoOsa(l.brutto, 2550);
      tyyppi = "Myyntilasku";
      rivit = [
        { tili: SAAMISET, debet: l.brutto },
        { tili: "3000", kredit: netto, kanta: 2550 },
        { tili: ALV_MYYNTI, kredit: l.brutto - netto, auto: true }
      ];
    } else if (l.laji === "suoritus") {
      tyyppi = "Suoritus";
      rivit = [
        { tili: PANKKI, debet: l.brutto },
        { tili: SAAMISET, kredit: l.brutto }
      ];
    } else {
      var kanta = l.kanta != null ? l.kanta : tili(l.tili).kanta;
      netto = nettoOsa(l.brutto, kanta);
      tyyppi = "Meno";
      rivit = [{ tili: l.tili, debet: netto, kanta: kanta }];
      if (l.brutto - netto > 0) rivit.push({ tili: ALV_OSTO, debet: l.brutto - netto, auto: true });
      rivit.push({ tili: PANKKI, kredit: l.brutto });
    }
    return {
      numero: numero, pvm: l.pvm, tyyppi: tyyppi, selite: l.selite,
      brutto: l.brutto, rivit: rivit, kuitti: !!l.kuitti
    };
  }

  LAHTO.forEach(function (l, i) {
    TOSITTEET.push(teeTosite(l, seuraavaNumero - LAHTO.length + i));
  });
  TOSITTEET.reverse();

  function saldo(nro) {
    var d = 0, k = 0;
    TOSITTEET.forEach(function (t) {
      t.rivit.forEach(function (r) {
        if (r.tili !== nro) return;
        d += r.debet || 0;
        k += r.kredit || 0;
      });
    });
    return { debet: d, kredit: k };
  }
  function saldoLuku(nro) {
    var t = tili(nro), s = saldo(nro);
    return (t.laji === "vastattavaa" || t.laji === "tuotto") ? s.kredit - s.debet : s.debet - s.kredit;
  }
  function tulos() {
    var tuotot = 0, kulut = 0;
    TILIT.forEach(function (t) {
      if (t.laji === "tuotto") tuotot += saldoLuku(t.nro);
      if (t.laji === "kulu") kulut += saldoLuku(t.nro);
    });
    return { tuotot: tuotot, kulut: kulut, tulos: tuotot - kulut };
  }
  /* Tulot ja kulut kuukausittain, kuten kojelaudan pylväskaaviossa. */
  function kuukaudet() {
    var nimet = ["Tammi", "Helmi", "Maalis", "Huhti", "Touko", "Kesä", "Heinä"];
    return nimet.map(function (nimi, i) {
      var tulot = 0, kulut = 0;
      TOSITTEET.forEach(function (t) {
        if (Number(t.pvm.slice(3, 5)) !== i + 1) return;
        t.rivit.forEach(function (r) {
          var ti = tili(r.tili);
          if (ti.laji === "tuotto") tulot += (r.kredit || 0) - (r.debet || 0);
          if (ti.laji === "kulu") kulut += (r.debet || 0) - (r.kredit || 0);
        });
      });
      return { nimi: nimi, tulot: tulot, kulut: kulut };
    });
  }

  /* ---------- näkymän tila ---------- */
  var nakyma = "tositteet";
  var editori = null;       // avoin tositeluonnos, kun ei null
  var luettava = null;      // kuitin id lukuanimaation ajan

  var otsakeEl = document.getElementById("demoOtsake");
  var tilaEl = document.getElementById("demoTila");
  var toiminnotEl = document.getElementById("demoToiminnot");
  var sisaltoEl = document.getElementById("demoSisalto");

  function nappi(toiminto, teksti, ensisijainen, poissa) {
    return '<button type="button" class="demo-nappi' + (ensisijainen ? " ensisijainen" : "") +
      '" data-toiminto="' + toiminto + '"' + (poissa ? " disabled" : "") + ">" + teksti + "</button>";
  }

  /* ---------- kojelauta ---------- */
  /* Rakenne seuraa sovelluksen kojelautaa (apps/web/src/routes/index.tsx):
     huomiot, neljä tunnuslukua, tulot ja kulut, suurimmat erät, viimeisimmät, saldot. */
  function kortti(nimi, luku, tyyli) {
    return '<div class="demo-kortti' + (tyyli ? " " + tyyli : "") + '">' +
      '<div class="nimi">' + nimi + "</div>" +
      '<div class="luku">' + luku + "</div></div>";
  }

  function otsikko(teksti, maininta) {
    return '<div class="demo-otsake">' + teksti +
      (maininta ? '<span class="maininta">' + maininta + "</span>" : "") + "</div>";
  }

  function tulotJaKulut() {
    var kk = kuukaudet();
    var huippu = Math.max.apply(null, kk.map(function (x) { return Math.max(x.tulot, x.kulut); })) || 1;
    function korkeus(c) { return c ? Math.max(3, Math.round((c / huippu) * 100)) : 0; }
    return '<div class="demo-palkit">' + kk.map(function (x) {
      return '<div class="kk"><div class="parit">' +
        '<div class="tolppa tulo" style="height:' + korkeus(x.tulot) + '%" title="Tulot ' + raha(x.tulot) + ' €"></div>' +
        '<div class="tolppa kulu" style="height:' + korkeus(x.kulut) + '%" title="Kulut ' + raha(x.kulut) + ' €"></div>' +
        '</div><div class="nimi">' + x.nimi + "</div></div>";
    }).join("") + "</div>" +
      '<div class="demo-selite-rivi"><span><i class="tulo"></i>Tulot</span><span><i class="kulu"></i>Kulut</span></div>';
  }

  function suurimmat(laji, montako) {
    var tilit = TILIT.filter(function (t) { return t.laji === laji && saldoLuku(t.nro) > 0; })
      .sort(function (a, b) { return saldoLuku(b.nro) - saldoLuku(a.nro); }).slice(0, montako);
    var huippu = tilit.length ? saldoLuku(tilit[0].nro) : 1;
    return tilit.map(function (t) {
      var s = saldoLuku(t.nro);
      return '<div class="demo-era"><div class="rivi"><span>' + pakoon(t.nimi) + "</span><span>" +
        raha(s) + ' €</span></div><div class="ura"><i class="' + (laji === "tuotto" ? "tulo" : "kulu") +
        '" style="width:' + Math.round((s / huippu) * 100) + '%"></i></div></div>';
    }).join("");
  }

  function saldot() {
    var ryhmat = [
      { nimi: "Vastaavaa", nrot: [PANKKI, SAAMISET, ALV_OSTO] },
      { nimi: "Vastattavaa", nrot: [ALV_MYYNTI] }
    ];
    var rivit = ryhmat.map(function (r) {
      return '<tr class="ryhma"><td colspan="2">' + r.nimi + "</td></tr>" +
        r.nrot.map(function (n) {
          return '<tr><td><span class="nro">' + n + "</span> " + pakoon(tili(n).nimi) +
            '</td><td class="oikea">' + raha(saldoLuku(n)) + "</td></tr>";
        }).join("");
    }).join("");
    var tl = tulos().tulos;
    return '<table class="demo-saldot"><tbody>' + rivit +
      '<tr class="loppu"><td>Tilikauden tulos</td><td class="oikea' + (tl >= 0 ? " plus" : "") + '">' +
      raha(tl) + "</td></tr></tbody></table>";
  }

  function nakymaKojelauta() {
    var tl = tulos();
    var alv = saldoLuku(ALV_MYYNTI) - saldoLuku(ALV_OSTO);
    var huomio = KUITIT.length
      ? '<div class="demo-huomio-rivi">' + ikoni("kuitti") + '<div class="teksti"><b>' +
        KUITIT.length + " kuittia odottaa kirjausta</b><span>Penni lukee kuitit ja tekee niistä " +
        'luonnokset. Sinä hyväksyt.</span></div><button type="button" class="demo-linkki" ' +
        'data-toiminto="kuitteihin">Lue kuitit</button></div>'
      : "";

    return huomio +
      '<div class="demo-kortit">' +
        kortti("Tilikauden tulos", raha(tl.tulos) + " €", tl.tulos >= 0 ? "voitto" : "") +
        kortti("Pankki", raha(saldoLuku(PANKKI)) + " €") +
        kortti("Myyntisaatavat", raha(saldoLuku(SAAMISET)) + " €") +
        kortti("ALV-velka", raha(alv) + " €") +
      "</div>" +
      '<div class="demo-kahtia">' +
        '<div class="demo-paneeli">' + otsikko("Tulot ja kulut") + tulotJaKulut() + "</div>" +
        '<div class="demo-paneeli">' + otsikko("Suurimmat erät") +
          '<div class="demo-erat"><b>Tulot</b>' + suurimmat("tuotto", 1) +
          "<b>Kulut</b>" + suurimmat("kulu", 3) + "</div></div>" +
      "</div>" +
      '<div class="demo-kahtia vapaa">' +
        "<div>" + otsikko("Viimeisimmät tositteet") + tositeLista(TOSITTEET.slice(0, 6)) +
          '<button type="button" class="demo-linkki" data-nakyma="tositteet">Kaikki tositteet ' +
          ikoni("nuoli") + "</button></div>" +
        "<div>" + otsikko("Saldot 24.7.2026") + saldot() + "</div>" +
      "</div>";
  }

  /* ---------- tositteet ---------- */
  /* Kojelaudan tiivis lista: päivä, tyyppikuvake + selite, summa. */
  function tositeLista(lista) {
    return '<table class="demo-lista-taulu"><tbody>' + lista.map(function (t) {
      return '<tr><td class="pvm">' + t.pvm + '</td><td><span class="demo-solu-rivi">' +
        tyyppiMerkki(t.tyyppi) + t.tyyppi + " · " + pakoon(t.selite) + "</span></td>" +
        '<td class="oikea">' + raha(t.brutto) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }

  function tositeTaulukko(lista) {
    var rivit = lista.map(function (t) {
      return '<tr><td class="himmea">' + t.numero + '</td><td class="himmea">' + t.pvm + "</td>" +
        '<td class="kapea"><span class="demo-solu-rivi">' + tyyppiMerkki(t.tyyppi) + pakoon(t.selite) +
        (t.kuitti ? '<span class="demo-liite" title="1 liite">' + ikoni("liite") + "</span>" : "") +
        "</span></td>" +
        '<td class="oikea">' + raha(t.brutto) + "</td></tr>";
    }).join("");
    return '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr>' +
      "<th>Nro</th><th>Päivä</th><th>Selite</th>" +
      '<th class="oikea">Summa €</th></tr></thead><tbody>' + rivit + "</tbody></table></div>";
  }

  function kuittiKortti(k) {
    var lukee = luettava === k.id;
    return '<button type="button" class="demo-kuitti' + (lukee ? " luetaan" : "") +
      '" data-kuitti="' + k.id + '"' + (lukee ? " disabled" : "") + ">" +
      (lukee ? '<span class="viiva"></span>' : "") +
      '<span class="myyja">' + pakoon(k.myyja.toUpperCase()) + "</span>" +
      pakoon(k.paperi.join("\n")) +
      '<span class="lue">' + (lukee ? "Luetaan…" : "Lue kuitti →") + "</span></button>";
  }

  function nakymaTositteet() {
    var kuitit = KUITIT.length
      ? '<div class="demo-kuitit">' + KUITIT.map(kuittiKortti).join("") + "</div>"
      : '<div class="demo-tyhja-tila">Kaikki kuitit kirjattu.</div>';

    return '<div class="demo-paneeli"><div class="demo-otsake">Luettavana' +
        '<span class="maininta">' + (luettava ? "Luetaan kuittia…" :
          "Napsauta kuittia") + "</span></div>" +
        '<div class="demo-kuitti-kaare">' + kuitit + "</div></div>" +
      '<div><div class="demo-otsake">Tositteet 2026' +
        '<span class="maininta">' + TOSITTEET.length + " kpl</span></div>" +
        tositeTaulukko(TOSITTEET) + "</div>";
  }

  /* ---------- laskut ---------- */
  function nakymaLaskut() {
    var avoin = 0;
    LASKUT.forEach(function (l) {
      if (l.tila === "Erääntynyt" || l.tila === "Avoin") avoin += l.summa;
    });
    var luokat = { "Maksettu": "ok", "Avoin": "odottaa", "Erääntynyt": "myohassa", "Luonnos": "luonnos" };
    var rivit = LASKUT.map(function (l) {
      return "<tr><td>" + l.nro + "</td><td>" + pakoon(l.asiakas) + "</td><td>" + l.pvm +
        "</td><td>" + l.era + '</td><td class="oikea">' + raha(l.summa) + "</td>" +
        '<td><span class="demo-tunniste ' + luokat[l.tila] + '">' + l.tila + "</span></td></tr>";
    }).join("");
    var laskutettu = LASKUT.reduce(function (s, l) {
      return l.tila === "Luonnos" ? s : s + l.summa;
    }, 0);

    return '<div>' + otsikko("Myyntilaskut", "avoinna " + raha(avoin) + " € · laskutettu " +
        raha(laskutettu) + " €") +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr>' +
      "<th>Numero</th><th>Asiakas</th><th>Päivä</th><th>Eräpäivä</th>" +
      '<th class="oikea">Summa €</th><th>Tila</th></tr></thead><tbody>' + rivit +
      "</tbody></table></div></div>" +
      '<div class="demo-selite-teksti">Luonnos kirjataan vasta lähetettäessä, joten ' +
      "<b>2026-004</b> ei näy tuloslaskelmassa.</div>";
  }

  /* ---------- raportit ---------- */
  function nakymaRaportit() {
    var tl = tulos();
    var kulurivit = TILIT.filter(function (t) { return t.laji === "kulu" && saldoLuku(t.nro); })
      .map(function (t) {
        return "<tr><td>" + t.nro + " · " + pakoon(t.nimi) + '</td><td class="oikea">−' +
          raha(saldoLuku(t.nro)) + "</td></tr>";
      }).join("");

    var tuloslaskelma = '<div><div class="demo-otsake">Tuloslaskelma' +
      '<span class="maininta">1.1.–24.7.2026</span></div>' +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr><th>Erä</th>' +
      '<th class="oikea">€</th></tr></thead><tbody>' +
      '<tr class="valiotsikko"><td>Liikevaihto</td><td class="oikea"></td></tr>' +
      '<tr><td>3000 · Myynti</td><td class="oikea">' + raha(tl.tuotot) + "</td></tr>" +
      '<tr class="valiotsikko"><td>Liiketoiminnan kulut</td><td class="oikea"></td></tr>' +
      kulurivit +
      '<tr class="summa"><td>Tilikauden tulos</td><td class="oikea">' + raha(tl.tulos) +
      "</td></tr></tbody></table></div></div>";

    var vastaavaaNrot = [PANKKI, SAAMISET, ALV_OSTO];
    var vastaavaa = vastaavaaNrot.map(function (n) {
      return "<tr><td>" + n + " · " + pakoon(tili(n).nimi) + '</td><td class="oikea">' +
        raha(saldoLuku(n)) + "</td></tr>";
    }).join("");
    var vastaavaaSumma = vastaavaaNrot.reduce(function (s, n) { return s + saldoLuku(n); }, 0);
    var vastattavaaSumma = saldoLuku(ALV_MYYNTI) + saldoLuku("2871") + tl.tulos;

    var tase = '<div><div class="demo-otsake">Tase' +
      '<span class="maininta">24.7.2026</span></div>' +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr><th>Erä</th>' +
      '<th class="oikea">€</th></tr></thead><tbody>' +
      '<tr class="valiotsikko"><td>Vastaavaa</td><td class="oikea"></td></tr>' + vastaavaa +
      '<tr class="summa"><td>Vastaavaa yhteensä</td><td class="oikea">' + raha(vastaavaaSumma) + "</td></tr>" +
      '<tr class="valiotsikko"><td>Vastattavaa</td><td class="oikea"></td></tr>' +
      '<tr><td>2939 · Arvonlisäverovelka</td><td class="oikea">' + raha(saldoLuku(ALV_MYYNTI)) + "</td></tr>" +
      '<tr><td>2871 · Ostovelat</td><td class="oikea">' + raha(saldoLuku("2871")) + "</td></tr>" +
      '<tr class="automaatti"><td>Tilikauden tulos<span class="leima">laskettu</span></td>' +
      '<td class="oikea">' + raha(tl.tulos) + "</td></tr>" +
      '<tr class="summa"><td>Vastattavaa yhteensä</td><td class="oikea">' + raha(vastattavaaSumma) +
      "</td></tr></tbody></table></div></div>";

    return tuloslaskelma + tase +
      '<div class="demo-selite-teksti">Raportit päivittyvät heti tallennuksesta.</div>';
  }

  /* ---------- alv ---------- */
  function nakymaAlv() {
    var myynninAlv = saldoLuku(ALV_MYYNTI), ostojenAlv = saldoLuku(ALV_OSTO);
    return '<div class="demo-kortit">' +
        kortti("Myynnin ALV", raha(myynninAlv) + " €") +
        kortti("Vähennettävä ALV", raha(ostojenAlv) + " €") +
        kortti("Maksettava", raha(myynninAlv - ostojenAlv) + " €") +
        kortti("Eräpäivä", "12.8.2026") +
      "</div>" +
      "<div>" + otsikko("ALV-laskelma", "1.1.–24.7.2026") +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr><th>Erä</th>' +
      '<th class="oikea">€</th></tr></thead><tbody>' +
      '<tr><td>Myynnin arvonlisävero 25,5 %</td><td class="oikea">' + raha(myynninAlv) + "</td></tr>" +
      '<tr><td>Vähennettävä arvonlisävero</td><td class="oikea">−' + raha(ostojenAlv) + "</td></tr>" +
      '<tr class="summa"><td>Maksettava vero</td><td class="oikea">' + raha(myynninAlv - ostojenAlv) +
      "</td></tr></tbody></table></div></div>" +
      '<div class="demo-selite-teksti">Penni laskee ALV:n kirjauksista. Demo ei lähetä mitään ' +
      "Verohallinnolle.</div>";
  }

  /* ---------- kumppanit ---------- */
  function nakymaKumppanit() {
    var asiakkaat = [];
    LASKUT.forEach(function (l) {
      var a = asiakkaat.filter(function (x) { return x.nimi === l.asiakas; })[0];
      if (!a) asiakkaat.push(a = { nimi: l.asiakas, laskuja: 0, laskutettu: 0, avoinna: 0 });
      a.laskuja++;
      if (l.tila !== "Luonnos") a.laskutettu += l.summa;
      if (l.tila === "Avoin" || l.tila === "Erääntynyt") a.avoinna += l.summa;
    });
    var rivit = asiakkaat.map(function (a) {
      return "<tr><td>" + pakoon(a.nimi) + '</td><td class="himmea">Asiakas</td>' +
        '<td class="oikea">' + a.laskuja + '</td><td class="oikea">' + raha(a.laskutettu) + "</td>" +
        '<td class="oikea">' + (a.avoinna ? raha(a.avoinna) : '<span class="himmea">—</span>') +
        "</td></tr>";
    }).join("");
    return "<div>" + otsikko("Asiakkaat", asiakkaat.length + " kpl") +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr>' +
      '<th>Nimi</th><th>Rooli</th><th class="oikea">Laskuja</th><th class="oikea">Laskutettu €</th>' +
      '<th class="oikea">Avoinna €</th></tr></thead><tbody>' + rivit + "</tbody></table></div></div>" +
      nakymaLaskut();
  }

  /* ---------- ei demossa ---------- */
  function eiDemossa(teksti) {
    return function () {
      return '<div class="demo-tyhja-paneeli"><b>Ei mukana selaindemossa</b><span>' + teksti +
        "</span></div>";
    };
  }

  /* ---------- tilikartta ---------- */
  function nakymaTilikartta() {
    var lajit = { vastaavaa: "Vastaavaa", vastattavaa: "Vastattavaa", tuotto: "Tuotot", kulu: "Kulut" };
    var rivit = "";
    ["vastaavaa", "vastattavaa", "tuotto", "kulu"].forEach(function (laji) {
      rivit += '<tr class="valiotsikko" data-ryhma="1"><td colspan="4">' + lajit[laji] + "</td></tr>";
      TILIT.filter(function (t) { return t.laji === laji; }).forEach(function (t) {
        rivit += '<tr data-haku="' + pakoon((t.nro + " " + t.nimi).toLowerCase()) + '">' +
          "<td>" + t.nro + "</td><td>" + pakoon(t.nimi) + "</td>" +
          '<td class="oikea">' + (t.kanta == null ? "—" : kantaTeksti(t.kanta)) + "</td>" +
          '<td class="oikea">' + raha(saldoLuku(t.nro)) + "</td></tr>";
      });
    });
    return '<div><input class="demo-haku" id="demoHaku" type="search" ' +
      'placeholder="Etsi tiliä numerolla tai nimellä…" aria-label="Etsi tiliä" /></div>' +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr>' +
      '<th>Nro</th><th>Tili</th><th class="oikea">ALV</th><th class="oikea">Saldo €</th>' +
      "</tr></thead><tbody>" + rivit + "</tbody></table></div>";
  }

  /* ---------- tositteen muokkaus ---------- */
  function editoriKanta() {
    if (!editori) return 0;
    if (editori.kanta != null) return editori.kanta;
    return editori.tili ? editori.tili.kanta : 0;
  }
  function editoriValmis() { return !!(editori && editori.tili && editori.brutto); }

  function nakymaEditori() {
    var kanta = editoriKanta();
    var netto = editoriValmis() ? nettoOsa(editori.brutto, kanta) : 0;
    var alv = editoriValmis() ? editori.brutto - netto : 0;
    var selite = editori.selite.trim();
    var seliteSolu = selite ? "<td>" + pakoon(selite) + "</td>" : '<td class="tyhja">—</td>';
    var rivit = "";

    if (editori.vahvistettu) {
      rivit += "<tr><td>" + editori.tili.nro + " · " + pakoon(editori.tili.nimi) + "</td>" +
        seliteSolu +
        '<td class="oikea"><button type="button" class="demo-muokkaa">' + raha(netto) +
        '</button><span class="vihje">' +
        (editori.lahde === "kuitti" ? "kuitilta " : "yhteensä ") + raha(editori.brutto) + " €</span></td>" +
        '<td class="oikea tyhja">—</td>' +
        '<td class="oikea">' + kantaTeksti(kanta) + "</td></tr>";
      if (alv > 0) {
        rivit += '<tr class="automaatti"><td>' + ALV_OSTO + " · " + tili(ALV_OSTO).nimi +
          '<span class="leima">automaattinen</span></td>' +
          "<td>ALV " + kantaTeksti(kanta) +
          (editori.lahde === "kuitti" ? " · kuitilta" : "") + "</td>" +
          '<td class="oikea">' + raha(alv) + '</td><td class="oikea">—</td>' +
          '<td class="oikea">—</td></tr>';
      }
      rivit += "<tr><td>" + PANKKI + " · " + tili(PANKKI).nimi + "</td>" + seliteSolu +
        '<td class="oikea tyhja">—</td>' +
        '<td class="oikea">' + raha(editori.brutto) + "</td>" +
        '<td class="oikea tyhja">—</td></tr>';
    } else {
      rivit += '<tr><td class="demo-solu">' +
        '<input class="demo-syote" id="demoTili" autocomplete="off" placeholder="Tilinumero tai nimi…" ' +
        'role="combobox" aria-expanded="false" aria-controls="demoLista" aria-label="Tili" />' +
        '<ul class="demo-lista" id="demoLista" role="listbox" aria-label="Tiliehdotukset" hidden></ul>' +
        "</td>" + seliteSolu +
        '<td class="demo-solu oikea">' +
        '<input class="demo-syote oikea" id="demoSumma" inputmode="decimal" placeholder="0,00" ' +
        'aria-label="Loppusumma sis. ALV" /></td>' +
        '<td class="oikea tyhja">—</td>' +
        '<td class="oikea' + (editori.tili ? '">' : ' tyhja">') +
        (editori.tili ? kantaTeksti(kanta) : "—") + "</td></tr>";
    }

    var ylin = "";
    if (editori.kuitti) {
      var k = editori.kuitti;
      var eriKanta = tili(k.tili).kanta !== k.kanta;
      ylin = '<div class="demo-jako">' +
        '<div class="demo-kuitti" style="cursor:default">' +
          '<span class="myyja">' + pakoon(k.myyja.toUpperCase()) + "</span>" +
          pakoon(k.paperi.join("\n")) + "</div>" +
        '<div style="display:flex;flex-direction:column;gap:0.6rem">' +
          '<dl class="demo-poiminta">' +
            "<div><dt>Myyjä</dt><dd>" + pakoon(k.myyja) + "</dd></div>" +
            "<div><dt>Päivä</dt><dd>" + k.pvm + "</dd></div>" +
            "<div><dt>Loppusumma</dt><dd>" + raha(k.brutto) + " €</dd></div>" +
            "<div><dt>ALV-kanta</dt><dd>" + kantaTeksti(k.kanta) +
              (eriKanta ? '<span class="laatu">tilin oletus ' + kantaTeksti(tili(k.tili).kanta) +
                " · käytetään kuitin kantaa</span>" : "") + "</dd></div>" +
            "<div><dt>Menotiliehdotus</dt><dd>" + k.tili + " · " + pakoon(tili(k.tili).nimi) +
              '<span class="laatu">' + k.varmuus + " % varmuus" +
              (k.historia ? " · " + k.historia : "") + "</span></dd></div>" +
          "</dl>" +
          (k.uusi
            ? '<div class="demo-huomio"><b>Uusi myyjä.</b> Tarkista tili. ' +
              "Vaihda se napsauttamalla summaa.</div>"
            : "") +
        "</div></div>";
    }

    var tasmaa = editori.vahvistettu && !editori.tallennettu;
    var luokka = "demo-tase" + (editori.tallennettu ? " tallennettu" : tasmaa ? " tasmaa" : "");
    var viesti = editori.tallennettu
      ? "Tallennettu tositteeksi " + editori.tallennettu
      : editori.vahvistettu ? "Debet ja kredit täsmäävät"
      : editori.esikatselu ? editori.esikatselu
      : editori.tili ? "Kirjoita loppusumma (sis. ALV)."
      : "Valitse tili ja kirjoita loppusumma.";
    var summa = editori.vahvistettu ? editori.brutto : 0;

    return ylin +
      '<div class="demo-kentat">' +
        '<div class="demo-kentta"><label for="demoPvm">Päivä</label>' +
        '<input class="demo-syote" id="demoPvm" value="' + pakoon(editori.pvm) + '" inputmode="numeric" /></div>' +
        '<div class="demo-kentta"><label for="demoTyyppi">Tyyppi</label>' +
        '<span class="arvo" id="demoTyyppi">Meno</span></div>' +
        '<div class="demo-kentta"><label for="demoSelite">Selite</label>' +
        '<input class="demo-syote" id="demoSelite" value="' + pakoon(editori.selite) +
        '" placeholder="Esim. toimistotarvikkeet" /></div>' +
      "</div>" +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr>' +
        '<th style="width:34%">Tili</th><th>Selite</th><th class="oikea">Debet €</th>' +
        '<th class="oikea">Kredit €</th><th class="oikea">ALV</th>' +
      "</tr></thead><tbody>" + rivit + "</tbody></table></div>" +
      '<div class="' + luokka + '" role="status" aria-live="polite">' +
        '<span class="merkki">' + (editori.vahvistettu ? "✓" : "○") + "</span>" +
        "<span>" + pakoon(viesti) + "</span>" +
        '<span class="luku">Debet <b>' + raha(summa) + "</b></span>" +
        '<span class="luku">Kredit <b>' + raha(summa) + "</b></span>" +
      "</div>" +
      '<div class="demo-alarivi"><span>' +
        (editori.lahde === "kuitti"
          ? "Rivit tehtiin kuitista. Napsauta summaa, jos haluat vaihtaa tilin."
          : "Hae tili ja paina ⏎. Kirjoita summa ja paina ⏎, niin ALV jaetaan.") +
      '</span><span><kbd>Tab</kbd> siirtyy · <kbd>⏎</kbd> hyväksyy · <kbd>⌘S</kbd> tallentaa</span></div>';
  }

  /* ---------- piirto ---------- */
  var KIRJA = "Demokirjat Oy · Tilikausi 1.1.2026–31.12.2026";
  var NAKYMAT = {
    kojelauta:   { otsikko: "Kojelauta", tila: KIRJA, sisalto: nakymaKojelauta },
    tositteet:   { otsikko: "Tositteet", sisalto: nakymaTositteet },
    kumppanit:   { otsikko: "Kumppanit", tila: "Asiakkaat, toimittajat ja myyntilaskut", sisalto: nakymaKumppanit },
    raportit:    { otsikko: "Raportit", tila: "Päivittyvät kirjausten mukana", sisalto: nakymaRaportit },
    alv:         { otsikko: "ALV", tila: "Kuukausittain ilmoittava", sisalto: nakymaAlv },
    tilikartta:  { otsikko: "Tilikartta", tila: "Kitsas-yhteensopiva yritystilikartta", sisalto: nakymaTilikartta },
    tilinpaatos: { otsikko: "Tilinpäätös", tila: KIRJA, sisalto: eiDemossa(
      "Sovellus tekee tilinpäätöksen tilikauden lopussa ja lukitsee kauden. Tilikausi 2026 on vielä auki.") },
    asetukset:   { otsikko: "Asetukset", tila: "Demokirjat Oy", sisalto: eiDemossa(
      "Yrityksen tiedot, tositelajit ja ALV-asetukset muokataan sovelluksessa.") }
  };

  function piirra() {
    Array.prototype.forEach.call(juuri.querySelectorAll(".demo-nav"), function (b) {
      var auki = editori ? b.dataset.toiminto === "uusi" && !editori.kuitti
        : b.dataset.nakyma === nakyma;
      if (auki || (editori && editori.kuitti && b.dataset.nakyma === "tositteet")) {
        b.setAttribute("aria-current", "page");
      }
      else b.removeAttribute("aria-current");
      var vanha = b.querySelector(".pallukka");
      if (vanha) vanha.remove();
      if (b.dataset.nakyma === "tositteet" && KUITIT.length) {
        var merkki = document.createElement("span");
        merkki.className = "pallukka";
        merkki.textContent = KUITIT.length;
        b.appendChild(merkki);
      }
    });

    if (editori) {
      otsakeEl.textContent = editori.kuitti ? "Tosite kuitista" : "Uusi tosite";
      tilaEl.textContent = editori.tallennettu
        ? "Tallennettu · tosite " + editori.tallennettu
        : "Luonnos · numero annetaan tallennettaessa";
      toiminnotEl.innerHTML = editori.tallennettu
        ? nappi("listaan", "Takaisin listaan", true)
        : nappi("peruuta", "Peruuta") + nappi("tallenna", "Tallenna", true, !editori.vahvistettu);
      sisaltoEl.innerHTML = nakymaEditori();
      kytkeEditori();
      return;
    }

    var n = NAKYMAT[nakyma];
    otsakeEl.textContent = n.otsikko;
    tilaEl.textContent = n.tila ||
      (TOSITTEET.length + " tositetta · seuraava nro " + seuraavaNumero);
    toiminnotEl.innerHTML = nakyma === "kojelauta" || nakyma === "tositteet"
      ? nappi("uusi", "+ Uusi tosite", true) : "";
    sisaltoEl.innerHTML = n.sisalto();

    var haku = document.getElementById("demoHaku");
    if (haku) {
      haku.addEventListener("input", function () {
        var h = haku.value.trim().toLowerCase();
        Array.prototype.forEach.call(sisaltoEl.querySelectorAll("tbody tr"), function (tr) {
          if (tr.dataset.ryhma) return;
          tr.hidden = !!h && tr.dataset.haku.indexOf(h) < 0;
        });
      });
    }
  }

  /* ---------- editorin näppäimistö ---------- */
  function vahvista() {
    if (!editoriValmis()) return;
    editori.vahvistettu = true;
    editori.esikatselu = null;
    piirra();
    var t = toiminnotEl.querySelector('[data-toiminto="tallenna"]');
    if (t) t.focus();
  }

  function kytkeEditori() {
    var pvm = document.getElementById("demoPvm");
    if (pvm) pvm.addEventListener("input", function () { editori.pvm = pvm.value; });

    var selite = document.getElementById("demoSelite");
    if (selite) {
      selite.addEventListener("input", function () {
        editori.selite = selite.value;
        var teksti = editori.selite.trim();
        Array.prototype.forEach.call(sisaltoEl.querySelectorAll("tbody tr"), function (tr, i) {
          var solu = tr.children[1];
          if (!solu || (editori.vahvistettu && tr.classList.contains("automaatti"))) return;
          solu.textContent = teksti || "—";
          solu.classList.toggle("tyhja", !teksti);
        });
      });
    }

    var muokkaa = sisaltoEl.querySelector(".demo-muokkaa");
    if (muokkaa) {
      muokkaa.addEventListener("click", function () {
        editori.vahvistettu = false;
        editori.tallennettu = null;
        piirra();
        var s = document.getElementById("demoSumma");
        if (s) { s.value = raha(editori.brutto); s.focus(); s.select(); }
      });
      return;
    }

    var tiliSyote = document.getElementById("demoTili");
    var lista = document.getElementById("demoLista");
    var summaSyote = document.getElementById("demoSumma");
    if (!tiliSyote) return;

    if (editori.tili) tiliSyote.value = editori.tili.nro + " · " + editori.tili.nimi;
    if (editori.brutto && summaSyote) summaSyote.value = raha(editori.brutto);
    var osumat = [], valittu = -1;

    function sulje() {
      lista.hidden = true;
      tiliSyote.setAttribute("aria-expanded", "false");
      valittu = -1;
    }
    function avaa(haku) {
      var h = haku.trim().toLowerCase();
      osumat = menotilit().filter(function (t) {
        return !h || t.nro.indexOf(h) === 0 || t.nimi.toLowerCase().indexOf(h) >= 0;
      });
      if (!osumat.length) { sulje(); return; }
      lista.innerHTML = osumat.map(function (t, i) {
        return '<li role="option" data-i="' + i + '" aria-selected="' + (i === valittu) + '">' +
          "<span>" + t.nro + " · " + pakoon(t.nimi) + '</span><span class="kanta">ALV ' +
          kantaTeksti(t.kanta) + "</span></li>";
      }).join("");
      lista.hidden = false;
      tiliSyote.setAttribute("aria-expanded", "true");
    }
    function korosta(i) {
      valittu = i;
      Array.prototype.forEach.call(lista.children, function (li, j) {
        li.setAttribute("aria-selected", String(j === i));
      });
    }
    function valitse(t) {
      editori.tili = t;
      if (editori.lahde !== "kuitti") editori.kanta = null;
      tiliSyote.value = t.nro + " · " + t.nimi;
      sulje();
      var kantaSolu = tiliSyote.closest("tr").lastElementChild;
      kantaSolu.textContent = kantaTeksti(editoriKanta());
      kantaSolu.classList.remove("tyhja");
      if (summaSyote) summaSyote.focus();
    }

    tiliSyote.addEventListener("input", function () {
      editori.tili = null;
      avaa(tiliSyote.value);
      korosta(osumat.length ? 0 : -1);
    });
    tiliSyote.addEventListener("focus", function () {
      if (!editori.tili) { avaa(tiliSyote.value); korosta(osumat.length ? 0 : -1); }
    });
    tiliSyote.addEventListener("keydown", function (e) {
      if (lista.hidden && (e.key === "ArrowDown" || e.key === "Enter")) {
        avaa(tiliSyote.value); korosta(0); e.preventDefault(); return;
      }
      if (e.key === "ArrowDown") { korosta(Math.min(valittu + 1, osumat.length - 1)); e.preventDefault(); }
      else if (e.key === "ArrowUp") { korosta(Math.max(valittu - 1, 0)); e.preventDefault(); }
      else if (e.key === "Enter") { if (osumat[valittu]) { valitse(osumat[valittu]); e.preventDefault(); } }
      else if (e.key === "Escape") { sulje(); }
    });
    lista.addEventListener("mousedown", function (e) {
      var li = e.target.closest("li");
      if (li) { e.preventDefault(); valitse(osumat[Number(li.dataset.i)]); }
    });
    tiliSyote.addEventListener("blur", function () { window.setTimeout(sulje, 120); });

    if (summaSyote) {
      var tasePalkki = sisaltoEl.querySelector(".demo-tase");
      summaSyote.addEventListener("input", function () {
        editori.brutto = sentit(summaSyote.value);
        var teksti;
        if (editori.brutto && editori.tili) {
          var n = nettoOsa(editori.brutto, editoriKanta());
          teksti = "Netto " + raha(n) + " · ALV " + raha(editori.brutto - n) + " — paina ⏎";
        } else if (editori.brutto) {
          teksti = "Valitse vielä tili.";
        } else {
          teksti = "Valitse tili ja kirjoita loppusumma.";
        }
        editori.esikatselu = teksti;
        if (tasePalkki) tasePalkki.children[1].textContent = teksti;
      });
      summaSyote.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); vahvista(); }
      });
      summaSyote.addEventListener("blur", function () { if (editoriValmis()) vahvista(); });
    }
  }

  /* ---------- toiminnot ---------- */
  function avaaEditori(kuitti) {
    editori = {
      lahde: kuitti ? "kuitti" : "kasin",
      kuitti: kuitti || null,
      pvm: kuitti ? kuitti.pvm : "24.07.2026",
      selite: kuitti ? kuitti.selite : "",
      tili: kuitti ? tili(kuitti.tili) : null,
      kanta: kuitti ? kuitti.kanta : null,
      brutto: kuitti ? kuitti.brutto : null,
      vahvistettu: !!kuitti,
      tallennettu: null,
      esikatselu: null
    };
    nakyma = "tositteet";
    piirra();
    if (!kuitti) {
      var t = document.getElementById("demoTili");
      if (t) t.focus();
    }
  }

  function tallenna() {
    if (!editori || !editori.vahvistettu || editori.tallennettu) return;
    var numero = seuraavaNumero++;
    TOSITTEET.unshift(teeTosite({
      pvm: editori.pvm,
      laji: "meno",
      tili: editori.tili.nro,
      brutto: editori.brutto,
      kanta: editoriKanta(),
      selite: editori.selite.trim() || (editori.kuitti ? editori.kuitti.myyja : "Meno"),
      kuitti: !!editori.kuitti
    }, numero));
    if (editori.kuitti) {
      KUITIT = KUITIT.filter(function (k) { return k.id !== editori.kuitti.id; });
    }
    editori.tallennettu = numero;
    piirra();
  }

  juuri.addEventListener("click", function (e) {
    var nav = e.target.closest("[data-nakyma]");
    if (nav) { editori = null; nakyma = nav.dataset.nakyma; piirra(); return; }

    var kuitti = e.target.closest("[data-kuitti]");
    if (kuitti && !luettava) {
      var id = kuitti.dataset.kuitti;
      luettava = id;
      piirra();
      window.setTimeout(function () {
        var k = KUITIT.filter(function (x) { return x.id === id; })[0];
        luettava = null;
        if (k) avaaEditori(k); else piirra();
      }, 1100);
      return;
    }

    var toiminto = e.target.closest("[data-toiminto]");
    if (!toiminto) return;
    switch (toiminto.dataset.toiminto) {
      case "uusi":       avaaEditori(null); break;
      case "kuitteihin": editori = null; nakyma = "tositteet"; piirra(); break;
      case "peruuta":
      case "listaan":    editori = null; piirra(); break;
      case "tallenna":   tallenna(); break;
    }
  });

  juuri.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      tallenna();
    }
  });

  Array.prototype.forEach.call(juuri.querySelectorAll("[data-ikoni]"), function (b) {
    b.insertAdjacentHTML("afterbegin", ikoni(b.dataset.ikoni));
  });
  piirra();
})();
