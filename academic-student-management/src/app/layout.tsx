import { Cairo } from "next/font/google";
import type { Metadata } from "next";

import "./globals.css";

import { getSiteBranding } from "@/lib/site-branding";

/** The media type inside a `data:image/...;base64,` logo, or null when absent. */
function logoMediaType(siteLogo: string | null): string | null {
  if (!siteLogo) return null;

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,/i.exec(siteLogo.trim());
  if (!match) return null;

  const type = match[1].toLowerCase();
  return type === "image/jpg" ? "image/jpeg" : type;
}

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getSiteBranding();
  const mediaType = logoMediaType(branding.siteLogo);

  return {
    title: branding.siteName,
    description: "منصة أكاديمية متكاملة لإدارة الطلاب والمواد الدراسية.",
    // Only the icon that can actually be served is declared: an uploaded logo
    // takes priority, and the bundled mark is the fallback when there is none.
    icons: mediaType
      ? { icon: [{ url: "/api/site-icon", type: mediaType }] }
      : { icon: [{ url: "/default-icon.svg", type: "image/svg+xml" }] },
  };
}

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cairo",
  display: "swap",
});

const themeScript = `try{var stored=localStorage.getItem("theme");var dark=stored?stored==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",dark)}catch(error){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={cairo.variable} dir="rtl" lang="ar" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
