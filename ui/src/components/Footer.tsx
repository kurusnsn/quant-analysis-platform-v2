import Link from "next/link";

const POLICY_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/refund", label: "Refund Policy" },
];

export function Footer() {
  return (
    <footer className="border-t border-border-color bg-surface mt-auto">
      <div className="max-w-[1550px] mx-auto w-full px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-[11px] text-muted">
          {new Date().getFullYear()} QuantPlatform. All rights reserved.
        </p>
        <nav className="flex flex-wrap items-center gap-4">
          {POLICY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[11px] text-muted hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
