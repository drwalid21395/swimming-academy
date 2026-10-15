import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth";
import { roleHome, type AppRole } from "@/lib/authorization";
import { getSiteBranding } from "@/lib/site-branding";

const features = [
  { title: "إدارة الطلاب", description: "ملفات الطلاب والرقم الجامعي والقسم والفرقة الدراسية." },
  { title: "الحضور والغياب", description: "تسجيل يومي وحساب النسب وتنبيهات انخفاض الحضور." },
  { title: "الامتحانات", description: "امتحانات إلكترونية بتصحيح موضوعي يدوي للمقالي." },
  { title: "بنك الأسئلة", description: "بنك مستقل لكل مادة مع توليد امتحانات تلقائي." },
  { title: "الأخبار", description: "منشورات وإعلانات مرتبطة بكل مادة دراسية." },
  { title: "التقارير", description: "تحليلات أكاديمية وتقارير مقارنة بين المواد." },
];

export default async function Home() {
  const [session, branding] = await Promise.all([
    getServerSession(authOptions),
    getSiteBranding(),
  ]);

  if (session?.user) {
    redirect(roleHome[session.user.role as AppRole] ?? "/sign-in");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
      <section className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-4">
          {branding.siteLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- inline base64 branding logo
            <img alt={`شعار ${branding.siteName}`} className="size-14 rounded-2xl object-cover" src={branding.siteLogo} />
          ) : (
            <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-soft text-2xl font-extrabold text-white">
              ع
            </span>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-50">
            {branding.siteName}
          </h1>
        </div>
        <p className="mt-4 max-w-2xl leading-8 text-slate-600 dark:text-slate-300">
          منصة جامعية متكاملة لإدارة الطلاب والمواد والحضور والامتحانات وبنوك الأسئلة، بواجهة عربية كاملة
          ودعم اتجاه من اليمين إلى اليسار.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
              key={feature.title}
            >
              <p className="font-semibold text-slate-800 dark:text-slate-100">{feature.title}</p>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{feature.description}</p>
            </div>
          ))}
        </div>

        <Link
          className="mt-8 inline-flex rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white transition hover:bg-blue-800"
          href="/sign-in"
        >
          تسجيل الدخول
        </Link>
      </section>
    </main>
  );
}
