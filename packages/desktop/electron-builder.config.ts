import type { Configuration } from "electron-builder";

function resolvePublishConfig(): Configuration["publish"] {
  const rawRepo =
    process.env.HONK_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepo) {
    return undefined;
  }

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) {
    return undefined;
  }

  return [
    {
      provider: "github",
      owner,
      repo,
      releaseType: "release",
    },
  ];
}

function resolveMacIdentity(): NonNullable<Configuration["mac"]>["identity"] {
  return process.env.HONK_DESKTOP_SKIP_MAC_SIGNING === "true" ? null : undefined;
}

type WindowsAzureSigningConfiguration = NonNullable<
  NonNullable<Configuration["win"]>["azureSignOptions"]
>;

function resolveWinAzureSignOptions(): WindowsAzureSigningConfiguration | undefined {
  const publisherName = process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME?.trim();
  const endpoint = process.env.AZURE_TRUSTED_SIGNING_ENDPOINT?.trim();
  const certificateProfileName = process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME?.trim();
  const codeSigningAccountName = process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME?.trim();

  if (!publisherName || !endpoint || !certificateProfileName || !codeSigningAccountName) {
    return undefined;
  }

  return {
    publisherName,
    endpoint,
    certificateProfileName,
    codeSigningAccountName,
  };
}

function resolveWinConfig(): NonNullable<Configuration["win"]> {
  const azureSignOptions = resolveWinAzureSignOptions();
  if (azureSignOptions) {
    return {
      target: ["nsis"],
      icon: "icon.ico",
      azureSignOptions,
    };
  }

  return {
    target: ["nsis"],
    icon: "icon.ico",
    signAndEditExecutable: false,
  };
}

export default {
  appId: "com.interfacesco.honk",
  productName: "Honk",
  artifactName: "Honk-${version}-${arch}.${ext}",
  directories: {
    buildResources: "resources",
    output: "dist",
  },
  // Honk's UI is English-only today. Keeping every Chromium translation added ~46 MiB to macOS.
  electronLanguages: ["en-US", "en"],
  files: [
    "out/main/**/*",
    "out/preload/**/*",
    "out/renderer/**/*",
    "!out/**/*.map",
    "resources/icon.png",
    "resources/icon.icns",
    "resources/icon.ico",
    "resources/dock-icon.png",
    "resources/app-icons/*.png",
  ],
  afterPack: "scripts/after-pack.mjs",
  publish: resolvePublishConfig(),
  mac: {
    target: ["dmg", "zip"],
    icon: "icon.icns",
    category: "public.app-category.developer-tools",
    identity: resolveMacIdentity(),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
  },
  dmg: {
    background: "dmg-background.png",
    contents: [
      { x: 166, y: 205, type: "file" },
      { x: 505, y: 205, type: "link", path: "/Applications" },
    ],
    sign: true,
  },
  linux: {
    target: ["AppImage"],
    executableName: "honk",
    icon: "icon.png",
    category: "Development",
    desktop: {
      entry: {
        StartupWMClass: "honk",
      },
    },
  },
  win: resolveWinConfig(),
} satisfies Configuration;
