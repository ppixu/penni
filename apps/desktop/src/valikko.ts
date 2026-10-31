import { basename } from 'node:path';
import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface ValikkoToiminnot {
  uusiKirja: () => void;
  avaaKirja: () => void;
  avaaViimeisin: (polku: string) => void;
  tuoKitsas: () => void;
  varmuuskopioi: () => void;
  naytaVarmuuskopiot: () => void;
  viimeisimmat: () => string[];
}

/** Build and install the application menu. Finnish labels; macOS app menu first. */
export function rakennaValikko(toiminnot: ValikkoToiminnot): void {
  const viimeisimmat: MenuItemConstructorOptions[] = toiminnot.viimeisimmat().map((polku) => ({
    label: basename(polku),
    click: () => toiminnot.avaaViimeisin(polku),
  }));

  const valikko: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'Tiedosto',
      submenu: [
        { label: 'Uusi kirjanpito…', accelerator: 'CmdOrCtrl+N', click: toiminnot.uusiKirja },
        { label: 'Avaa…', accelerator: 'CmdOrCtrl+O', click: toiminnot.avaaKirja },
        {
          label: 'Avaa viimeisin',
          submenu:
            viimeisimmat.length > 0 ? viimeisimmat : [{ label: '(ei kirjoja)', enabled: false }],
        },
        { type: 'separator' },
        {
          label: 'Varmuuskopioi…',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: toiminnot.varmuuskopioi,
        },
        { label: 'Näytä varmuuskopiot', click: toiminnot.naytaVarmuuskopiot },
        { type: 'separator' },
        { label: 'Tuo Kitsas-kirjanpito…', click: toiminnot.tuoKitsas },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(valikko));
}
