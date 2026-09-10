/**
 * The last crumb, where the navigation tree cannot supply one.
 *
 * `crumbsOf` names a path from the drawer's own links, so `/users/usr_...` reads as "All
 * users" and the trail claims the person is on the list they just left. A page about one
 * record names itself here instead, and the breadcrumb puts it last.
 *
 * Cleared when the page's scope goes, so a name never trails behind the next screen.
 */
export function usePageCrumb(title: MaybeRefOrGetter<string>): void {
  const crumb = usePageCrumbValue();
  watchEffect(() => {
    crumb.value = toValue(title);
  });
  onScopeDispose(() => {
    crumb.value = "";
  });
}

/** What the breadcrumb reads. Empty for every page that names nothing. */
export function usePageCrumbValue(): Ref<string> {
  return useState<string>("page-crumb", () => "");
}
