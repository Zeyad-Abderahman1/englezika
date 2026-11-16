export type DrawerPathname = string | null;

export function isDrawerOpenForPathname(
  openedOnPathname: DrawerPathname,
  pathname: string
): boolean {
  return openedOnPathname === pathname;
}

export function drawerPathAfterToggle(
  openedOnPathname: DrawerPathname,
  pathname: string
): DrawerPathname {
  return isDrawerOpenForPathname(openedOnPathname, pathname) ? null : pathname;
}

export function drawerPathAfterNavigation(
  openedOnPathname: DrawerPathname,
  pathname: string
): DrawerPathname {
  if (openedOnPathname === null || openedOnPathname === pathname) return openedOnPathname;
  return null;
}
