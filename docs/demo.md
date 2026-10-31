# Selaindemo (demo.penni.pro)

Julkinen demo on **oikea Penni-sovellus** (`apps/web`) ajettuna kokonaan selaimessa
kuvitteellisella kirjanpidolla. Mitään ei tallenneta eikä lähetetä: kirja on muistissa ja
rakennetaan joka latauksella uudelleen samasta siemenestä, joten sivun lataus (tai sivupalkin
**Palauta demo**) palauttaa alkutilan.

## Mitä demossa on

`apps/web/src/demo/demoKirja.ts` rakentaa kirjan moottorin kautta (`KpClient`), joten
numerointi, ALV-viennit ja tilitykset syntyvät samoin kuin oikeassa kirjassa:

- **Demokirjat Oy**, tilikausi 2026, neljännesvuosi-ALV; tilinavaus 1.1.2026.
- Myyntilaskut tammi–lokakuu viidelle asiakkaalle, suoritukset; kolme avointa (kaksi erääntynyttä).
- Työpistevuokra ostolaskuina (PDF-lasku liitteenä), kuukausitilaukset ja satunnaiset kulut
  PDF-kuitteineen, kuukausipalkat ja OmaVero-maksut.
- Q1 ja Q2 tilitetty ja maksettu; Q3 odottaa ilmoitusta (eräpäivä 12.11.).
- Kuittilaatikossa kolme luettua luonnosta odottamassa kirjausta.
- **Tuo tiliote**: lokakuun tapahtumaluettelo ja kuittikansio (`demoTasmaysSilta.ts`) —
  kahdeksan riviä on jo kirjattu, kaksi täsmää kansion kuittiin, yhdeltä puuttuu kuitti.
- **Esimerkkikuitti** sivupalkissa: PDF, jonka voi pudottaa Uusi tosite -lomakkeelle; se
  luetaan tekstikerroksesta pdf.js:llä kuten oikeassa sovelluksessa.

Kaikki nimet, Y-tunnukset, IBAN ja summat ovat keksittyjä. Rahat ovat kokonaissentteinä.

Demossa pois: pilvisynkronointi ja kirjautuminen (paikallinen tila), Kysy (asetusosio
piilotettu), kuvakuittien näkömalli (vain PDF-kuitit luetaan), uuden kirjan luonti ja
kirjanvaihto.

## Ajo ja julkaisu

```bash
pnpm --filter @penni/web dev:demo     # kehityspalvelin demotilassa
pnpm demo:build                       # staattinen paketti: apps/web/dist-demo
pnpm --filter @penni/web preview:demo # paketin esikatselu
pnpm demo:deploy                      # build + wrangler pages deploy (projekti penni-demo)
```

Demotila kytkeytyy Viten moodista `demo` (tai `VITE_PENNI_DEMO=1`); tavallinen build ei
sisällä demokoodia lainkaan.

Kertaluonteinen Cloudflare-valmistelu ennen ensimmäistä julkaisua:

1. `wrangler pages project create penni-demo --production-branch main`
2. Cloudflaren hallinnassa: Pages → penni-demo → Custom domains → `demo.penni.pro`
   (luo CNAME-tietueen penni.pro-vyöhykkeeseen).

Pages tarjoilee yhden sivun sovelluksen `index.html`:n tuntemattomille poluille, kun paketissa
ei ole `404.html`:ää, joten syvälinkit (esim. `/alv`) toimivat ilman lisäasetuksia.
