import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MY TECH บัญชีและสต๊อก",
  description: "ระบบบัญชีและสต๊อก MY TECH สำหรับมือถือและคอมพิวเตอร์",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className="antialiased">{children}</body>
    </html>
  );
}
