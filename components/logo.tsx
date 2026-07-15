// Instantal wordmark glyph: a bolt (instant) inside a rounded square. Used in
// the sidebar, login, and onboarding headers, and mirrors the generated
// favicon (app/icon.tsx) so the brand is consistent everywhere.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#4F46E5" />
      <path d="M13 3 4 13.5h7.2L10 21l9-10.5h-7.2L13 3Z" fill="white" />
    </svg>
  );
}

export function Logo({
  className,
  iconClassName = "size-5",
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className={iconClassName} />
      <span className="font-semibold tracking-tight">Instantal</span>
    </span>
  );
}
