// Donem secimi Maliye icinde korunur; sayfalar kendi tarih alanina gore suzer.
import { createContext, useContext } from "react";
import type { FinancePeriod } from "../../api/types";

export const FinancePeriodContext = createContext<FinancePeriod | null>(null);

export function useFinancePeriod() {
  return useContext(FinancePeriodContext);
}

export function inFinancePeriod(day: string | null, period: FinancePeriod | null): boolean {
  return period === null || day === null || (day >= period.from && day <= period.to);
}
