import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "ORGANIZER" | "ADMIN";
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    // Upsert the user row on every sign in so our domain tables can FK to it.
    async signIn({ user }) {
      if (!user.email) return false;
      await db
        .insert(users)
        .values({
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            name: user.name ?? null,
            image: user.image ?? null,
            updatedAt: new Date(),
          },
        });
      return true;
    },
    async jwt({ token, user }) {
      // First call after signIn has `user`; later calls reuse the token.
      const email = user?.email ?? token.email;
      if (email && !token.uid) {
        const [row] = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (row) {
          token.uid = row.id;
          token.role = row.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id =
          (token.uid as string) ?? token.sub ?? "";
        (session.user as { role?: string }).role =
          (token.role as string) ?? "USER";
      }
      return session;
    },
  },
});
