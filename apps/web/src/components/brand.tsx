import Link from "next/link";

export function Mark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 320 320"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="320" height="320" rx="62" fill="#131920" />
      <path
        d="M56 94H116Q140 94 153 120L174 159Q184 181 209 181H261"
        fill="none"
        stroke="#F4F5F6"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M56 223H116Q141 223 154 198L174 159Q184 137 209 137H261"
        fill="none"
        stroke="#8DABBB"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="174" cy="159" r="21" fill="#A76941" stroke="#131920" strokeWidth="7" />
    </svg>
  );
}

export function Wordmark({ href = "/", size = 28 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-md" aria-label="Spareline home">
      <Mark size={size} />
      <span className="text-[17px] font-semibold tracking-[-0.03em] text-ink">Spareline</span>
    </Link>
  );
}
