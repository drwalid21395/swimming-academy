import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";

export type StudentProfile = {
  id: string;
  userId: string;
  fullName: string;
  universityId: string | null;
};

export async function getStudentProfile(): Promise<StudentProfile> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  if (session.user.role !== "STUDENT") redirect("/unauthorized");

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, userId: true, universityId: true, user: { select: { fullName: true } } },
  });

  if (!student) redirect("/unauthorized");

  return {
    id: student.id,
    userId: student.userId,
    fullName: student.user.fullName,
    universityId: student.universityId,
  };
}

export type AttemptActor = { studentId: string; userId: string; fullName: string };

export async function requireAttemptActor(): Promise<AttemptActor> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  if (session.user.role !== "STUDENT") redirect("/unauthorized");

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, userId: true, user: { select: { fullName: true } } },
  });

  if (!student) redirect("/unauthorized");

  return { studentId: student.id, userId: student.userId, fullName: student.user.fullName };
}
