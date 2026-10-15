// Checks that the tab icon route returns the administrator's uploaded logo with
// the right media type, and falls back safely when there is none.
const path = require("node:path");

const { loadTs } = require("./.verify/loader.cjs");
const load = (relative) => loadTs(path.join(process.cwd(), relative));

const { prisma } = load("src/lib/prisma.ts");
const { getSiteBranding } = load("src/lib/site-branding.ts");
const { GET } = load("src/app/api/site-icon/route.ts");

/**
 * The route resolves its fallback against the origin the request came in on, so
 * the verifier uses a distinctive host. If the fallback were built against a
 * fixed or invented host, the Location header would point the browser at a domain
 * that does not exist and the tab icon would break for every deployment.
 */
const ORIGIN = "http://icon-verify.test";
const iconRequest = () => new Request(`${ORIGIN}/api/site-icon`);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

// A 1x1 PNG, the smallest thing that can stand in for a real upload.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

async function withBranding(logo, run) {
  const existing = await prisma.siteSetting.findUnique({
    where: { id: 1 },
    select: { siteName: true, siteLogo: true },
  });

  await prisma.siteSetting.upsert({
    where: { id: 1 },
    create: { id: 1, siteName: existing?.siteName ?? "bench", siteLogo: logo },
    update: { siteLogo: logo },
  });

  try {
    return await run();
  } finally {
    await prisma.siteSetting.upsert({
      where: { id: 1 },
      create: { id: 1, siteName: existing?.siteName ?? "bench", siteLogo: existing?.siteLogo ?? null },
      update: { siteLogo: existing?.siteLogo ?? null },
    });
  }
}

async function main() {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  if (!actor) throw new Error("need a user to own the audit trail");

  console.log("the tab icon follows the administrator's logo");

  await withBranding(`data:image/png;base64,${PNG_BASE64}`, async () => {
    const response = await GET(iconRequest());
    const body = Buffer.from(await response.arrayBuffer());

    check("returns a successful response", response.ok || response.status === 307, String(response.status));
    check("content type is the logo's own type", response.headers.get("content-type") === "image/png", String(response.headers.get("content-type")));
    check("the bytes are the logo, not a placeholder", body.equals(Buffer.from(PNG_BASE64, "base64")), `${body.byteLength} bytes`);
    check("is cacheable", (response.headers.get("cache-control") ?? "").includes("max-age"), String(response.headers.get("cache-control")));
  });

  console.log("\nunsupported and missing logos fall back instead of erroring");

  await withBranding("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", async () => {
    const response = await GET(iconRequest());
    check("an svg upload is refused rather than served as a broken icon", response.status === 307, String(response.status));
    check("the fallback is the bundled mark", String(response.headers.get("location") ?? "").endsWith("/default-icon.svg"), String(response.headers.get("location")));
  });

  await withBranding(null, async () => {
    const response = await GET(iconRequest());
    check("no logo redirects to the bundled mark", response.status === 307, String(response.status));
    check("the fallback path is the svg", String(response.headers.get("location") ?? "").endsWith("/default-icon.svg"), String(response.headers.get("location")));
    check("the fallback stays on the site's own origin", String(response.headers.get("location") ?? "").startsWith(ORIGIN), String(response.headers.get("location")));
  });

  await withBranding("not-a-data-url", async () => {
    const response = await GET(iconRequest());
    check("garbage in the database does not crash the route", response.status === 307, String(response.status));
  });

  const branding = await getSiteBranding();
  check("branding still readable afterwards", typeof branding.siteName === "string", branding.siteName);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL SITE ICON CHECKS PASSED" : `\n${failures} SITE ICON CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });