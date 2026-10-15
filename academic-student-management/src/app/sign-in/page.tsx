import { GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { authOptions } from "@/auth";
import { getSiteBranding } from "@/lib/site-branding";

import { SignInForm } from "./sign-in-form";

const highlights = [
  { icon: GraduationCap, title: "ملفات الطلاب", description: "بيانات أكاديمية كاملة لكل طالب" },
  { icon: ShieldCheck, title: "صلاحيات دقيقة", description: "وصول مخصص لكل دور وظيفي" },
  { icon: Sparkles, title: "تجربة عصرية", description: "واجهة سريعة ومريحة بالكامل" },
];

export default async function SignInPage() {
  const [session, branding] = await Promise.all([
    getServerSession(authOptions),
    getSiteBranding(),
  ]);
  if (session) redirect("/");

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/4 size-[28rem] rounded-full bg-brand-500/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 size-[26rem] rounded-full bg-accent-400/20 blur-3xl" />
        <div className="absolute left-0 top-1/3 size-[22rem] rounded-full bg-violet-soft/20 blur-3xl" />
      </div>

      <div className="w-full max-w-5xl">
        <div className="mb-6 flex justify-end">
          <ThemeToggle />
        </div>

        <div className="grid items-center gap-8 lg:grid-cols-2">
          <section className="hidden flex-col gap-7 lg:flex">
            {branding.siteLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- inline base64 branding logo
              <img
                alt={`شعار ${branding.siteName}`}
                className="size-14 rounded-3xl object-cover shadow-[0_20px_45px_-20px_rgba(36,69,234,0.95)]"
                src={branding.siteLogo}
              />
            ) : (
              <span className="grid size-14 place-items-center rounded-3xl bg-gradient-to-br from-brand-500 to-violet-soft text-2xl font-extrabold text-white shadow-[0_20px_45px_-20px_rgba(36,69,234,0.95)]">
                ع
              </span>
            )}
            <div>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
                {branding.siteName}
              </h1>
              <p className="mt-3 max-w-md text-base leading-8 text-muted">
                نظام متكامل لإدارة الطلاب والمواد والحضور والامتحانات، بواجهة عصرية وبيانات دقيقة.
              </p>
            </div>

            <ul className="grid gap-3">
              {highlights.map((item) => (
                <li className="glass-panel flex items-center gap-3 rounded-2xl p-3.5" key={item.title}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                    <item.icon aria-hidden className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold">{item.title}</p>
                    <p className="text-xs text-muted">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-panel-strong animate-scale-in rounded-3xl p-7 sm:p-9">
            <p className="text-sm font-bold text-brand-600 dark:text-brand-300">تسجيل الدخول</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">أهلاً بعودتك</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              أدخل بيانات حسابك للوصول إلى خدماتك الأكاديمية.
            </p>
            <SignInForm />
          </section>
        </div>
      </div>
    </main>
  );
}
