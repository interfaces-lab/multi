import { router, Stack, usePathname } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import { CoreConnectionProvider, useCoreConnection } from "../src/core-connection";
import { useHonkTheme } from "../src/ui";

function PairingLinkNavigation(): null {
  const pathname = usePathname();
  const { pendingPairingUrl } = useCoreConnection();

  React.useEffect(() => {
    if (pendingPairingUrl !== null && pathname !== "/connect") router.navigate("/connect");
  }, [pathname, pendingPairingUrl]);

  return null;
}

function Navigator(): React.ReactElement {
  const honkTheme = useHonkTheme();
  const dark = useColorScheme() === "dark";
  const base = dark ? DarkTheme : DefaultTheme;
  const theme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      background: honkTheme.colors.bgBase,
      border: honkTheme.colors.borderBase,
      card: honkTheme.colors.bgBase,
      notification: honkTheme.colors.errFg,
      primary: honkTheme.colors.accent,
      text: honkTheme.colors.textPrimary,
    },
  };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: honkTheme.colors.bgBase },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: honkTheme.colors.bgBase },
          headerTintColor: honkTheme.colors.textPrimary,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerLargeTitle: true,
            headerLargeTitleShadowVisible: false,
            title: "Sessions",
          }}
        />
        <Stack.Screen name="connect" options={{ title: "Connect" }} />
        <Stack.Screen name="session/[sessionId]" options={{ title: "Session" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <KeyboardProvider>
          <CoreConnectionProvider>
            <PairingLinkNavigation />
            <Navigator />
          </CoreConnectionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
