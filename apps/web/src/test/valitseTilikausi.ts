import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Valitse sivupalkin tilikausi nimellä ("2025"). */
export async function valitseTilikausi(user: UserEvent, nimi: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^Tilikausi/ }));
  await user.click(screen.getByRole('option', { name: new RegExp(`^${nimi}`) }));
}
