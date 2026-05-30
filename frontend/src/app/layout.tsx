import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NextGen Mentor - AI Virtual Mentor",
  description: "AI-powered virtual mentor for onboarding training and knowledge Q&A",
  icons: {
    icon: "/azure-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
