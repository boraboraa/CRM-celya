export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-xl bg-celya-gradient shadow-glow"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
          <path
            d="M17 7.5A6.5 6.5 0 1 0 17 16.5"
            stroke="#0A0E1A"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M14 4.5h4.5V9"
            stroke="#0A0E1A"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="font-display text-lg font-semibold tracking-tight text-slate-50">
        Celya <span className="text-slate-500 font-medium">CRM</span>
      </span>
    </div>
  );
}
