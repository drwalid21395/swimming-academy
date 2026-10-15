import * as xlsxNamespace from "xlsx";

type CfbModule = (typeof import("xlsx"))["CFB"];

/**
 * SheetJS only exposes its CFB (zip container) helper through the CommonJS
 * build. Depending on how the bundler resolves the package the named export is
 * either on the namespace or on the default interop object, so both are checked
 * before giving up.
 */
function resolveCfb(): CfbModule {
  const namespace = xlsxNamespace as unknown as {
    CFB?: CfbModule;
    default?: { CFB?: CfbModule };
  };

  const cfb = namespace.CFB ?? namespace.default?.CFB;
  if (!cfb) {
    throw new Error("تعذر الوصول إلى وحدة CFB الخاصة بمكتبة xlsx.");
  }

  return cfb;
}

export const CFB = resolveCfb();
