export const REAL_MENU = {
  Hamburguesas: ['Cheeseburger', 'Cheesebacon', 'Criolla', 'De la semana'],
  Extras: ['Papas', 'Boniatos', 'Nuggets'],
  Dips: ['Dip cheddar', 'Dip alioli', 'Dip barbacoa'],
  Bebidas: ['Gaseosa lata', 'Gaseosa 1.5L', 'Agua mineral 1.5L', 'Miller', 'Heineken', 'Budweiser'],
} as const;

export const REAL_MENU_CATEGORY_NAMES = Object.keys(REAL_MENU);
export const REAL_MENU_PRODUCT_NAMES = Object.values(REAL_MENU).flat();
export const REAL_MENU_CATEGORY_SET = new Set<string>(REAL_MENU_CATEGORY_NAMES);
export const REAL_MENU_PRODUCT_SET = new Set<string>(REAL_MENU_PRODUCT_NAMES);
