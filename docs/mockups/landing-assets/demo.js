
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
  function kertyma() {
    var nimet = ["Tammi", "Helmi", "Maalis", "Huhti", "Touko", "Kesä", "Heinä"];
    var summa = 0, ulos = [];
    for (var m = 1; m <= nimet.length; m++) {
      (function (kuu) {
        TOSITTEET.forEach(function (t) {
          if (Number(t.pvm.slice(3, 5)) !== kuu) return;
          t.rivit.forEach(function (r) {
            var ti = tili(r.tili);
            if (ti.laji === "tuotto") summa += (r.kredit || 0) - (r.debet || 0);
            if (ti.laji === "kulu") summa -= (r.debet || 0) - (r.kredit || 0);
          });
        });
      })(m);
      ulos.push({ nimi: nimet[m - 1], arvo: summa });
    }
    return ulos;
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
  function kortti(nimi, luku, lisa, tyyli) {
    return '<div class="demo-kortti' + (tyyli ? " " + tyyli : "") + '">' +
      '<div class="nimi">' + nimi + "</div>" +
      '<div class="luku">' + luku + "</div>" +
      '<div class="lisa">' + lisa + "</div></div>";
  }

  function nakymaKojelauta() {
    var tl = tulos();
    var alv = saldoLuku(ALV_MYYNTI) - saldoLuku(ALV_OSTO);
    var kk = kertyma();
    var huippu = Math.max.apply(null, kk.map(function (x) { return x.arvo; })) || 1;
    var palkit = kk.map(function (x) {
      return '<div class="kk"><div class="tolppa" style="height:' +
        Math.max(2, Math.round((x.arvo / huippu) * 100)) + '%" title="' + x.nimi + " " +
        raha(x.arvo) + ' €"></div><div class="nimi">' + x.nimi + "</div></div>";
    }).join("");

    return '<div class="demo-kortit">' +
        kortti("Tilikauden tulos", raha(tl.tulos) + " €", "Liikevaihto " + raha(tl.tuotot) + " €", "voitto") +
        kortti("Pankkitili", raha(saldoLuku(PANKKI)) + " €", "tili 1910", "") +
        kortti("Maksettava ALV", raha(alv) + " €", "eräpäivä 12.8.2026", "varoitus") +
        kortti("Myyntisaamiset", raha(saldoLuku(SAAMISET)) + " €", "1 lasku erääntynyt", "") +
      "</div>" +
      (KUITIT.length
        ? '<div class="demo-paneeli"><div class="demo-otsake">Saapuneet kuitit' +
          '<span class="maininta">' + KUITIT.length + " odottaa</span></div>" +
          '<div class="demo-selite-teksti">Penni lukee kuitit ja tekee niistä luonnokset. ' +
          "<b>Sinä hyväksyt.</b></div>" +
          '<div style="margin-top:0.7rem">' + nappi("kuitteihin", "Lue kuitit", true) + "</div></div>"
        : "") +
      '<div class="demo-paneeli"><div class="demo-otsake">Tuloksen kertymä' +
        '<span class="maininta">tammi–heinäkuu 2026</span></div>' +
        '<div class="demo-palkit">' + palkit + "</div></div>" +
      '<div><div class="demo-otsake">Viimeisimmät tositteet</div>' +
        tositeTaulukko(TOSITTEET.slice(0, 5)) + "</div>";
  }

  /* ---------- tositteet ---------- */
  function tositeTaulukko(lista) {
    var rivit = lista.map(function (t) {
      return "<tr><td>" + t.numero + "</td><td>" + t.pvm + "</td><td>" + t.tyyppi + "</td>" +
        '<td class="kapea">' + pakoon(t.selite) +
        (t.kuitti ? ' <span class="demo-tunniste luonnos">kuitti</span>' : "") + "</td>" +
        '<td class="oikea">' + raha(t.brutto) + "</td></tr>";
    }).join("");
    return '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr>' +
      "<th>Nro</th><th>Päivä</th><th>Tyyppi</th><th>Selite</th>" +
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
    var avoin = 0, myohassa = 0;
    LASKUT.forEach(function (l) {
      if (l.tila === "Erääntynyt") { avoin += l.summa; myohassa += l.summa; }
      else if (l.tila === "Avoin") avoin += l.summa;
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

    return '<div class="demo-kortit">' +
        kortti("Avoinna", raha(avoin) + " €", LASKUT.length + " laskua yhteensä", "") +
        kortti("Erääntynyt", raha(myohassa) + " €", "2026-003 · 10 päivää myöhässä", "varoitus") +
        kortti("Laskutettu 2026", raha(laskutettu) + " €", "sis. ALV", "") +
      "</div>" +
      '<div><div class="demo-otsake">Myyntilaskut</div>' +
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

    var myynninAlv = saldoLuku(ALV_MYYNTI), ostojenAlv = saldoLuku(ALV_OSTO);
    var alv = '<div><div class="demo-otsake">ALV-laskelma' +
      '<span class="maininta">tilikauden kertymä</span></div>' +
      '<div class="demo-taulukko-kaare"><table class="demo-taulukko"><thead><tr><th>Erä</th>' +
      '<th class="oikea">€</th></tr></thead><tbody>' +
      '<tr><td>Myynnin arvonlisävero</td><td class="oikea">' + raha(myynninAlv) + "</td></tr>" +
      '<tr><td>Vähennettävä arvonlisävero</td><td class="oikea">−' + raha(ostojenAlv) + "</td></tr>" +
      '<tr class="summa"><td>Maksettava</td><td class="oikea">' + raha(myynninAlv - ostojenAlv) +
      "</td></tr></tbody></table></div></div>";

    return tuloslaskelma + tase + alv +
      '<div class="demo-selite-teksti">Raportit päivittyvät heti tallennuksesta. Demo ei ' +
      "lähetä mitään Verohallinnolle.</div>";
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
  var NAKYMAT = {
    kojelauta:  { otsikko: "Kojelauta", tila: "Tilikausi 1.1.–31.12.2026", sisalto: nakymaKojelauta },
    tositteet:  { otsikko: "Tositteet", sisalto: nakymaTositteet },
    laskut:     { otsikko: "Myyntilaskut", tila: "Tilikausi 2026", sisalto: nakymaLaskut },
    raportit:   { otsikko: "Raportit", tila: "Päivittyvät kirjausten mukana", sisalto: nakymaRaportit },
    tilikartta: { otsikko: "Tilikartta", tila: "Yrityksen vakiotilikartta", sisalto: nakymaTilikartta }
  };

  function piirra() {
    Array.prototype.forEach.call(juuri.querySelectorAll("[data-nakyma]"), function (b) {
      if (b.dataset.nakyma === nakyma) b.setAttribute("aria-current", "page");
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
    toiminnotEl.innerHTML = nakyma === "tositteet" ? nappi("uusi", "Uusi tosite") : "";
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

  piirra();
})();
