/**
 * JPEG:n EXIF-orientaatio (tagi 0x0112). Puhelinkuvat tallennetaan anturin suunnassa ja
 * orientaatio kulkee vain tagissa; ilman sen soveltamista malli saa kuvan sivuttain
 * (VLM-piikin löydös §3c).
 */

/**
 * Orientaatio 1…8 (EXIF-määritys); 1 = ei kiertoa. Muu kuin JPEG, ei tagia tai mikä tahansa
 * katkennut/rikkinäinen syöte → 1 (ei koskaan heitä). Pure.
 */
export function exifOrientaatio(tavut: Uint8Array): number {
  try {
    return lueOrientaatio(tavut);
  } catch {
    return 1;
  }
}

function lueOrientaatio(tavut: Uint8Array): number {
  if (tavut.length < 4 || tavut[0] !== 0xff || tavut[1] !== 0xd8) return 1;
  const dv = new DataView(tavut.buffer, tavut.byteOffset, tavut.byteLength);
  let paikka = 2;
  while (paikka + 4 <= tavut.length) {
    if (tavut[paikka] !== 0xff) return 1;
    const merkki = tavut[paikka + 1] ?? 0;
    if (merkki === 0xff) {
      paikka += 1; // täytetavu
      continue;
    }
    if (merkki === 0xda || merkki === 0xd9) return 1; // pakattu data alkaa → ei EXIF:iä
    const pituus = dv.getUint16(paikka + 2);
    if (merkki === 0xe1 && pituus >= 16) {
      const o = lueTiff(tavut, dv, paikka + 4, paikka + 2 + pituus);
      if (o !== undefined) return o;
    }
    paikka += 2 + pituus;
  }
  return 1;
}

/**
 * APP1-segmentin sisältö (alkaa "Exif\0\0") → orientaatio tai undefined. `loppu` on segmentin
 * (julistettu) loppu; se katkaistaan puskurin todelliseen pituuteen, koska katkennut tiedosto voi
 * julistaa pidemmän segmentin kuin on olemassa.
 */
function lueTiff(
  tavut: Uint8Array,
  dv: DataView,
  alku: number,
  julistettuLoppu: number,
): number | undefined {
  const loppu = Math.min(julistettuLoppu, tavut.length);
  if (alku + 6 > loppu) return undefined;
  const tunniste = String.fromCharCode(...tavut.subarray(alku, alku + 4));
  if (tunniste !== 'Exif' || tavut[alku + 4] !== 0 || tavut[alku + 5] !== 0) return undefined;
  const tiff = alku + 6;
  const little = tavut[tiff] === 0x49; // 'II'
  if (!little && tavut[tiff] !== 0x4d) return undefined;
  if (tiff + 8 > loppu) return undefined;
  const ifd = tiff + dv.getUint32(tiff + 4, little);
  if (ifd + 2 > loppu) return undefined;
  const lkm = dv.getUint16(ifd, little);
  for (let i = 0; i < lkm; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > loppu) return undefined;
    if (dv.getUint16(e, little) === 0x0112) {
      const arvo = dv.getUint16(e + 8, little);
      return arvo >= 1 && arvo <= 8 ? arvo : 1;
    }
  }
  return undefined;
}

/**
 * Palauttaa JPEGin jossa on (ainoana) EXIF-segmenttinä orientaatiotagi. Fikstuurigeneraattoria
 * ja testejä varten — oikeat puhelinkuvat saavat tagin kamerasta. Vanha EXIF-segmentti poistetaan.
 */
export function asetaExifOrientaatio(jpeg: Uint8Array, orientaatio: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('ei JPEG');
  // TIFF big-endian: otsake (8) + IFD (2 + 12 + 4).
  const tiff = Uint8Array.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // otsake, IFD0 offset 8
    0x00,
    0x01, // yksi merkintä
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientaatio,
    0x00,
    0x00, // 0x0112 SHORT 1
    0x00,
    0x00,
    0x00,
    0x00, // ei seuraavaa IFD:tä
  ]);
  const runko = Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]);
  const segmentti = Uint8Array.from([
    0xff,
    0xe1,
    (runko.length + 2) >> 8,
    (runko.length + 2) & 0xff,
    ...runko,
  ]);

  // Kopioi segmentit; pudota vanhat EXIF-APP1:t, lisää uusi heti mahdollisen JFIF-APP0:n jälkeen.
  const dv = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  const ulos: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  let paikka = 2;
  let lisatty = false;
  const lisaa = (): void => {
    if (!lisatty) ulos.push(segmentti);
    lisatty = true;
  };
  while (paikka + 4 <= jpeg.length) {
    const merkki = jpeg[paikka + 1] ?? 0;
    if (jpeg[paikka] !== 0xff || merkki === 0xda) break;
    const pituus = dv.getUint16(paikka + 2);
    const seg = jpeg.subarray(paikka, paikka + 2 + pituus);
    const onExif = merkki === 0xe1 && String.fromCharCode(...seg.subarray(4, 8)) === 'Exif';
    if (!onExif) {
      if (merkki !== 0xe0) lisaa();
      ulos.push(seg);
    }
    paikka += 2 + pituus;
  }
  lisaa();
  ulos.push(jpeg.subarray(paikka));
  return Uint8Array.from(Buffer.concat(ulos));
}
