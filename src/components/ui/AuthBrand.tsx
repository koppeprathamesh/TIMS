import Image from "next/image";

// Company mark shown above the sign-in style forms (login, forgot/reset password).
export function AuthBrand({ subtitle = "Tool Management System" }: { subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Image src="/logo.svg" alt="ET Group of Companies" width={180} height={127} priority unoptimized className="h-auto w-44" />
      <h1 className="page-heading mt-3 text-base font-medium text-[var(--color-text-muted)]">{subtitle}</h1>
    </div>
  );
}
