import { describe, expect, it } from 'vitest';
import { virheKoodiHttp } from './virheet.js';

describe('virheKoodiHttp', () => {
  it('maps resource error codes to HTTP statuses', () => {
    expect(virheKoodiHttp('EITOSITETTA')).toBe(404);
    expect(virheKoodiHttp('EIRAPORTTIA')).toBe(404);
    expect(virheKoodiHttp('PVMLUKITTU')).toBe(409);
    expect(virheKoodiHttp('EIVALMISTU')).toBe(422);
    expect(virheKoodiHttp('EITILIKAUTTA')).toBe(400);
    expect(virheKoodiHttp('JOKINMUU')).toBe(400);
  });
});
