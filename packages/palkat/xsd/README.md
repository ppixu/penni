# Tulorekisterin XSD-skeemat (testiaineisto)

Nämä tiedostot ovat Verohallinnon Tulorekisteriyksikön julkaisemia skeemoja. Niitä käytetään
vain testeissä (`src/tulorekisteri/*.test.ts`, `xmllint-wasm`): palkkatietoilmoituksen ja
työnantajan erillisilmoituksen XML:n on validoiduttava molempia paketteja vastaan. Tiedostot
eivät kuulu julkaistavaan pakettiin (`package.json` `files`) eikä niitä muokata.

Lähde: https://www.vero.fi/en/incomes-register/software-developers/documentation/
("Technical interface – ZIP file for application developers"). Tiedostot on kopioitu zip-paketeista
sellaisinaan (2027-paketin `PayerSummaryReportsToIRTypes.xsd` alkaa BOM-merkillä, kuten
alkuperäisessä).

| Hakemisto | Paketti | Julkaistu | zip SHA-256 |
|---|---|---|---|
| `2025/` | `tekninen-rajapinta-zip-sovelluskehittajalle-2025.zip` (https://www.vero.fi/globalassets/tulorekisteri/dokumentaatio-2025/tekninen-rajapinta-zip-sovelluskehittajalle-2025.zip) | 8.1.2025 | `ca9b8c322136f3a2087918c6e51fb5821ee47b046829821f5e9b2dd9d22ceaf8` |
| `2027/` | `tekninen-rajapinta-zip-sovelluskehittajalle-2027.zip` (https://www.vero.fi/globalassets/tulorekisteri/dokumentaatio-2027/tekninen-rajapinta-zip-sovelluskehittajalle-2027.zip), dokumentin versio 1.2 | 29.5.2026 | `affface54d4286195854d1ab613e23d989750e6cce9389e05467114da3fe3bc4` |

Vuoden 2026 paketin osoite palautti 404 (31.10.2026), joten testataan sitä edeltävää ja seuraavaa
pakettia. Paketit ladattiin 31.10.2026.

Kummastakin paketista on mukana kuusi tiedostoa:

- `WageReportsToIR.xsd`, `WageReportsToIRTypes.xsd` – palkkatietoilmoitus (DeliveryDataType 100)
- `PayerSummaryReportsToIR.xsd`, `PayerSummaryReportsToIRTypes.xsd` – erillisilmoitus (101)
- `IRCommonTypes.xsd`, `xmldsig-core-schema.xsd` – yhteiset tyypit

Erot 2025 → 2027: palkkatietoilmoitukseen uudet valinnaiset `DemandForRectificationIds` ja
`PlaceOfBusiness/StatisticsFinlandId` (`irct:String12`); erillisilmoituksessa `Transactions` muuttui
valinnaiseksi ja lisättiin `EmployeeGroups` (palkka-avoimuus).
