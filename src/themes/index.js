import { darkTheme } from "./dark.js";
import { lightTheme } from "./light.js";

export const THEMES = {
  dark: darkTheme,
  light: lightTheme,
};

export function getTheme(themeId) {
  return THEMES[themeId] || THEMES.dark;
}

export function themeCssVars(theme) {
  const colors = theme.colors || {};
  return {
    "--bg": colors.bg,
    "--bgLight": colors.bgLight,
    "--gutter": colors.gutter,
    "--gutterText": colors.gutterText,
    "--gutterActive": colors.gutterActive,
    "--text": colors.text,
    "--cursor": colors.cursor,
    "--selection": colors.selection,
    "--selectionText": colors.selectionText,
    "--date": colors.date,
    "--desc": colors.desc,
    "--account": colors.account,
    "--amount": colors.amount,
    "--comment": colors.comment,
    "--error": colors.error,
    "--errorBg": colors.errorBg,
    "--warning": colors.warning,
    "--warningBg": colors.warningBg,
    "--border": colors.border,
    "--panelBg": colors.panelBg,
    "--accent": colors.accent,
    "--accentSoft": colors.accentSoft,
    "--banner": colors.banner,
    "--bannerBorder": colors.bannerBorder,
    "--overlay": colors.overlay,
  };
}
