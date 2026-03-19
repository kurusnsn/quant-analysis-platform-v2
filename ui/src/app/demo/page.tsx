"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function DemoSignIn() {
    const searchParams = useSearchParams();
    const [error, setError] = useState(false);

    useEffect(() => {
        const token = searchParams.get("token");
        if (!token) {
            setError(true);
            return;
        }
        signIn("demo", { token, redirect: false }).then((result) => {
            if (result?.ok) {
                window.location.replace("/home");
            } else {
                setError(true);
            }
        });
    }, [searchParams]);

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-center space-y-2">
                    <p className="text-lg font-semibold text-foreground">Invalid demo link.</p>
                    <p className="text-sm text-muted-foreground">This link may have expired or is incorrect.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="text-center space-y-3">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
                <p className="text-sm text-muted-foreground">Loading demo…</p>
            </div>
        </div>
    );
}

export default function DemoPage() {
    return (
        <Suspense>
            <DemoSignIn />
        </Suspense>
    );
}
