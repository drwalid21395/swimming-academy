import { getSiteBranding } from "@/lib/site-branding";

/**
 * Serves the site logo as the browser tab icon.
 *
 * The logo is uploaded by an administrator and stored as a base64 data URL, so a
 * static `favicon.ico` in the app directory could never match it and would go
 * stale every time the branding changed. Reading it here means the tab icon
 * always follows whatever picture is currently in the sidebar.
 *
 * It has to be a route handler rather than `app/icon.tsx`: the branding lives in
 * the database, and the edge runtime cannot run Prisma.
 */
export const runtime = "nodejs";

/**
 * Always read on request. Next.js would otherwise prerender this at build time,
 * because nothing here touches `cookies` or `headers`, and the tab would keep
 * showing whatever logo happened to be in the database during the build.
 */
export const dynamic = "force-dynamic";

/** The browser cache is what keeps this off the hot path, not the server one. */

const CONTENT_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
};

export async function GET(request: Request) {
  const { siteLogo } = await getSiteBranding();

  // Resolve the fallback against the incoming request rather than a fixed host,
  // so the redirect stays on whichever origin the app is actually served from.
  const fallback = () => Response.redirect(new URL("/default-icon.svg", request.url), 307);

  if (!siteLogo) {
    // No logo has been uploaded yet, so fall back to the bundled mark rather than
    // leaving the tab with a broken image.
    return fallback();
  }

  const [header, encoded] = splitDataUrl(siteLogo);

  if (!encoded) {
    return fallback();
  }

  const contentType = CONTENT_TYPES[header];

  if (!contentType) {
    return fallback();
  }

  const bytes = Buffer.from(encoded, "base64");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      // A tab icon is re-requested on every navigation, so it is served from the
      // browser cache rather than hitting the database each time.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

/** Splits `data:image/png;base64,AAAA` into its media type and payload. */
function splitDataUrl(value: string): [string, string | null] {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/i.exec(value.trim());

  if (!match) return ["", null];

  return [match[1].toLowerCase(), match[2]];
}