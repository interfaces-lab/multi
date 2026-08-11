/// <reference types="vite/client" />

import * as React from "react";
import { createRoot } from "react-dom/client";

import { StartupShell } from "./startup-shell";

const rootEl = document.getElementById("root");

if (rootEl === null) {
  throw new Error("index.html must provide #root");
}

const root = createRoot(rootEl);
const pathname = window.location.pathname;
const isDesktopWorkspace =
  document.documentElement.getAttribute("data-shell-platform") === "electron";

const loadApplication = (): void => {
  void import("./start-app").then(({ startApp }) => {
    void startApp(root);
  });
};

if (pathname === "/setup") {
  // First run paints onboarding from its own small chunk: no router, no
  // backend, no application graph. The full app loads on the next launch,
  // once setup marks itself complete and the window reopens on "/".
  void import("./onboarding-canvas").then(({ OnboardingCanvas }) => {
    root.render(<OnboardingCanvas />);
  });
} else if (isDesktopWorkspace) {
  root.render(<StartupShell />);
  // Leave one compositor opportunity between the permanent shell and the
  // authenticated application graph. This affects cold interactivity by at
  // most one frame and does not add work to steady-state rendering.
  requestAnimationFrame(loadApplication);
} else {
  loadApplication();
}
