import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

const nextAuth = NextAuth({
    trustHost: true,
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID ?? "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        }),
        Credentials({
            name: "Email",
            credentials: {
                email: { label: "Email", type: "email", placeholder: "you@example.com" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                const email = credentials?.email as string | undefined;
                const password = credentials?.password as string | undefined;

                if (!email || !password) return null;

                try {
                    // Validate against Supabase Auth
                    const supabase = createClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                    );
                    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                    if (error || !data.user) return null;

                    return {
                        id: data.user.id,
                        email: data.user.email!,
                        name: data.user.user_metadata?.name ?? data.user.email!.split("@")[0],
                        image: data.user.user_metadata?.avatar_url ?? null,
                    };
                } catch {
                    return null;
                }
            },
        }),
    ],
    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },
    pages: {
        signIn: "/signin",
        error: "/signin",
    },
    callbacks: {
        async signIn({ user, account }) {
            // Sync Google OAuth users into Supabase so all identities live in one place
            if (account?.provider === "google" && user.email) {
                try {
                    const admin = supabaseAdmin();
                    await admin.auth.admin.createUser({
                        email: user.email,
                        email_confirm: true,
                        user_metadata: {
                            name: user.name ?? "",
                            avatar_url: user.image ?? "",
                            provider: "google",
                        },
                    });
                    // Error intentionally ignored — user likely already exists
                } catch {
                    // Non-fatal: Google sign-in still proceeds
                }
            }
            return true;
        },
        jwt({ token, user, profile }) {
            if (profile) {
                // Google sign-in
                token.sub = profile.sub ?? undefined;
                token.name = profile.name;
                token.email = profile.email;
                token.picture = (profile as Record<string, unknown>).picture as string | undefined;
            } else if (user) {
                // Credentials sign-in (sub = Supabase UUID)
                token.sub = user.id ?? undefined;
                token.name = user.name;
                token.email = user.email;
                token.picture = user.image ?? undefined;
            }
            return token;
        },
        session({ session, token }) {
            if (session.user && token.sub) {
                (session.user as unknown as Record<string, unknown>).id = token.sub;
                session.user.image = token.picture as string | null;
            }
            return session;
        },
    },
});

export const { handlers, auth, signIn, signOut } = nextAuth;
export const { GET, POST } = handlers;
