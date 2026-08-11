import { resolveNativeTheme, type NativeTheme } from "@honk/ui/theme";
import { useColorScheme } from "react-native";

const nativeThemes = {
  dark: resolveNativeTheme("dark"),
  light: resolveNativeTheme("light"),
};

export const useHonkTheme = (): NativeTheme =>
  useColorScheme() === "dark" ? nativeThemes.dark : nativeThemes.light;
