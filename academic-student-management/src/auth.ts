import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import * as bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().trim().email("أدخل بريداً إلكترونياً صحيحاً."),
  password: z.string().min(1, "أدخل كلمة المرور."),
});

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      name: "البريد الإلكتروني",
      credentials: {
        email: { label: "البريد الإلكتروني", type: "email" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(credentials) {
        const parsedCredentials = credentialsSchema.safeParse(credentials);

        if (!parsedCredentials.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsedCredentials.data.email.toLowerCase() },
        });

        if (!user || !user.isActive) return null;

        const passwordMatches = await bcrypt.compare(
          parsedCredentials.data.password,
          user.passwordHash,
        );

        if (!passwordMatches) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return { id: user.id, name: user.fullName, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = user.role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role!;
      }
      return session;
    },
  },
};
