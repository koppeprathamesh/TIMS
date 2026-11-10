import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import AccessBoundary from "@/components/layout/AccessBoundary";
import { PageSkeleton } from "@/components/ui/Skeleton";

// One typeface for the whole product.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TIMS — Tool Inventory Management System",
  description: "Enterprise tool inventory, stock, and movement management.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<PageSkeleton />}>
          <AccessBoundary>{children}</AccessBoundary>
        </Suspense>
      </body>
    </html>
  );
}
