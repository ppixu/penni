import type { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // Sarakkeen lisätieto: oikealle = oikealle tasattu (luvut). Tyhjä TValue varjostetaan.
  interface ColumnMeta<TData extends RowData, TValue> {
    oikealle?: boolean;
  }
}
