"use strict";

const path = require("path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const { rcedit } = await import("rcedit");
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, "assets", "app-icon.ico");
  const version = context.packager.appInfo.version;
  const productName = context.packager.appInfo.productName;

  await rcedit(exePath, {
    icon: iconPath,
    "file-version": version,
    "product-version": version,
    "version-string": {
      CompanyName: "Kaka",
      FileDescription: productName,
      ProductName: productName,
      InternalName: exeName,
      OriginalFilename: exeName
    }
  });
};
