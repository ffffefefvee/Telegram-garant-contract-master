/** Use mock data when API is empty or in dev demo mode */
export const USE_UI_MOCKS =
  import.meta.env.VITE_USE_UI_MOCKS === 'true' || import.meta.env.DEV;
