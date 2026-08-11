// The new onboarding, at /setup, in the one Honk window.
//
// First run never reaches this module: main.tsx renders OnboardingCanvas from
// its own chunk before the application graph loads. This routed wrapper serves
// the command-menu replay, which navigates here inside the running app.
// spec/onboarding.md records the inventory the flow grows toward.

import { useNavigate, useSearch } from "@tanstack/react-router";
import type * as React from "react";

import { OnboardingCanvas } from "./onboarding-canvas";

/** The one address for onboarding. Desktop opens it directly on first run. */
export const ONBOARDING_PATH = "/setup";

export function OnboardingPage(): React.ReactElement {
  const navigate = useNavigate();
  const isReplay = useSearch({ from: ONBOARDING_PATH, select: (search) => search.replay });

  // A replay is a revisit, so Escape leaves it. First run stays: the flow
  // that finishes onboarding is not built yet.
  const leave = () => {
    void navigate({ to: "/", replace: true });
  };

  return <OnboardingCanvas onEscape={isReplay ? leave : undefined} />;
}
