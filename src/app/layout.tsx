import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Projection Control Plane",
  description: "Governed operational AI runtime — execution dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
