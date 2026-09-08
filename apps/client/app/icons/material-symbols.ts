import { h } from "vue";
import type { IconAliases, IconSet } from "vuetify";
import { Icon } from "#components";

/**
 * Material Symbols as a Vuetify icon set, drawn by `@nuxt/icon`.
 *
 * This is what makes `<v-icon>` and `<Icon>` one icon system rather than two. Vuetify 4
 * does ship an `ms` set of its own and it is unusable here: it emits UnoCSS class names
 * (`i-material-symbols:menu`) that nothing in this build generates. Handing the name to
 * `<Icon>` instead means one collection, one bundle and one place to look.
 *
 * The webfont was the other option and costs 4 MB: `material-symbols` ships one variable
 * font covering all 24,000 glyphs with no practical way to subset it in a build nobody
 * maintains. Icons here are compiled in one at a time, and nothing touches
 * fonts.googleapis.com, which PROJECT.md 10.3 forbids on this panel.
 *
 * The cost is that an icon has to be bundled to exist: a name assembled at runtime draws
 * nothing and reports nothing, because there is no API to fall back to. Names written out
 * under `app/` are scanned and bundled; anything else needs adding to
 * `icon.clientBundle.icons` in nuxt.config.ts.
 */
export const materialSymbols: IconSet = {
  component: (props) => h(Icon, { name: String(props.icon) }),
};

/**
 * Vuetify's internal icons: what a checkbox, a sort arrow or a chip's close button draw.
 * Transcribed from Vuetify's own `ms` set so a component looks the way its author meant,
 * with every name checked against the Material Symbols set rather than guessed.
 */
export const aliases: IconAliases = {
  collapse: "material-symbols:keyboard-arrow-up",
  complete: "material-symbols:check",
  cancel: "material-symbols:cancel",
  close: "material-symbols:close",
  delete: "material-symbols:cancel",
  clear: "material-symbols:cancel",
  success: "material-symbols:check-circle",
  info: "material-symbols:info",
  warning: "material-symbols:warning",
  error: "material-symbols:error",
  prev: "material-symbols:chevron-left",
  next: "material-symbols:chevron-right",
  checkboxOn: "material-symbols:check-box",
  checkboxOff: "material-symbols:check-box-outline-blank",
  checkboxIndeterminate: "material-symbols:indeterminate-check-box",
  delimiter: "material-symbols:circle",
  sortAsc: "material-symbols:arrow-upward",
  sortDesc: "material-symbols:arrow-downward",
  expand: "material-symbols:keyboard-arrow-down",
  menu: "material-symbols:menu",
  subgroup: "material-symbols:arrow-drop-down",
  dropdown: "material-symbols:arrow-drop-down",
  radioOn: "material-symbols:radio-button-checked",
  radioOff: "material-symbols:radio-button-unchecked",
  edit: "material-symbols:edit",
  ratingEmpty: "material-symbols:star-outline",
  ratingFull: "material-symbols:star",
  ratingHalf: "material-symbols:star-half",
  loading: "material-symbols:cached",
  first: "material-symbols:first-page",
  last: "material-symbols:last-page",
  unfold: "material-symbols:unfold-more",
  file: "material-symbols:attach-file",
  plus: "material-symbols:add",
  minus: "material-symbols:remove",
  calendar: "material-symbols:calendar-today",
  treeviewCollapse: "material-symbols:arrow-drop-down",
  treeviewExpand: "material-symbols:arrow-right",
  tableGroupExpand: "material-symbols:chevron-right",
  tableGroupCollapse: "material-symbols:keyboard-arrow-down",
  eyeDropper: "material-symbols:colorize",
  upload: "material-symbols:upload",
  color: "material-symbols:palette",
  command: "material-symbols:keyboard-command-key",
  ctrl: "material-symbols:keyboard-control-key",
  space: "material-symbols:space-bar",
  shift: "material-symbols:shift",
  alt: "material-symbols:keyboard-option-key",
  enter: "material-symbols:keyboard-return",
  arrowup: "material-symbols:arrow-upward",
  arrowdown: "material-symbols:arrow-downward",
  arrowleft: "material-symbols:arrow-back",
  arrowright: "material-symbols:arrow-forward",
  backspace: "material-symbols:backspace-outline",
  play: "material-symbols:play-arrow",
  pause: "material-symbols:pause",
  fullscreen: "material-symbols:fullscreen",
  fullscreenExit: "material-symbols:fullscreen-exit",
  volumeHigh: "material-symbols:volume-up",
  volumeMedium: "material-symbols:volume-down",
  volumeLow: "material-symbols:volume-mute",
  volumeOff: "material-symbols:volume-off",
  search: "material-symbols:search",
};
